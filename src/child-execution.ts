import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  createCodemodeExtension,
  createExtensionRuntime,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionToolContext,
  type ResourceLoader,
  type Skill,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Validator } from "@earendil-works/pi-schema";
import { submissionParameters, saveOutcomeArtifact } from "./outcomes.ts";
import { validateModelSelection, type ModelSelection } from "./model-policy.ts";
import { parentModelRuntime } from "./model-adapter.ts";
import { workspaceArguments } from "./workspace.ts";
import type { BuiltinTool } from "./profiles.ts";
import type { ChildSnapshot, StartTask } from "./delegation-types.ts";

/** Shared live execution fields; lifecycle ownership stays with the coordinator. */
export type ExecutionRecord = {
  validator?: Validator;
  input: StartTask;
  selection: Pick<
    ExtensionToolContext,
    "model" | "modelRegistry" | "scopedModels" | "thinkingLevel" | "cwd"
  >;
  state: ChildSnapshot;
  timer?: ReturnType<typeof setTimeout>;
  run?: Promise<void>;
  session?: AgentSession;
  unsubscribe?: () => void;
  paused?: boolean;
  prompt?: (text: string) => Promise<void>;
  resumeText?: string;
  prompted?: boolean;
  cancelled: boolean;
};

/** Operations bound to the exact admitted entry, never a later generation with its ID. */
export interface ExecutionOwner {
  readonly closing: boolean;
  update(patch: Partial<ChildSnapshot>, event?: AgentSessionEvent): void;
  revalidateModel(selected: ModelSelection, requirePrewalk: boolean): Promise<void>;
  authorizeTool(name: string, builtin: boolean): Promise<void>;
  assertTool(name: string, builtin: boolean, signal?: AbortSignal): void;
  chargeRequest(): void;
  chargeToolCall(): void;
  observeUserMessage(text: string): void;
  drainDescendants(): Promise<void>;
  dispose(): void;
}

export function childResources(prompt: string, skills: Skill[] = []): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills, diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      prompt +
      "\nYou are a delegated child. Complete only this assignment; use only explicitly granted tools and spawn roles.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export async function createChildExecution(
  root: string,
  entry: ExecutionRecord,
  owner: ExecutionOwner,
): Promise<void> {
  const { input, selection } = entry;
  try {
    await mkdir(root, { recursive: true });
    const taskDir = join(
      root,
      entry.state.generation === 1
        ? entry.state.id
        : `${entry.state.id}-g${entry.state.generation}`,
    );
    await mkdir(taskDir, { mode: 0o700 }); // exclusive ownership: never reuse an existing task record
    const agentDir = join(taskDir, "agent");
    await mkdir(agentDir, { mode: 0o700 });
    const transcriptDir = join(taskDir, "transcripts");
    await mkdir(transcriptDir, { mode: 0o700 });
    const target =
      entry.state.prewalk?.status === "armed"
        ? validateModelSelection(input.context, entry.state.prewalk.target)
        : undefined;
    let policyError: string | undefined;
    let completedMutation = false;
    const inheritCodemode = !!input.codemodeEnabled?.();
    if (!inheritCodemode) input.codemodeEnabled = () => false;
    const effective = (): ModelSelection => ({
      ...entry.state.model,
      effort: entry.state.effort as ModelSelection["effort"],
    });
    const runtime = await parentModelRuntime(
      selection,
      agentDir,
      () => {
        if (policyError) throw new Error(policyError);
        owner.chargeRequest();
      },
      target ? [target] : [],
    );
    const resources = childResources(
      input.profile.prompt +
        (target
          ? "\nPrewalk: investigate and plan using only granted context/tools. After the first completed edit or write the same conversation switches once to the explicitly granted implementation target; all normal budgets still apply."
          : "") +
        `\nYour delegation identity is ${entry.state.id} generation ${entry.state.generation}; parent ${entry.state.parentId}. Coordination, if granted, is limited to family identities explicitly supplied to you.` +
        (entry.validator
          ? "\nThis assignment requires a structured result. Call submit_result with the actual value; final prose is not a submission."
          : ""),
      input.skills,
    );
    const loader = new DefaultResourceLoader({
      cwd: selection.cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        ...(inheritCodemode ? [createCodemodeExtension({ models: false })] : []),
        (pi) => {
          pi.on("tool_call", (event, ctx) => {
            if (event.toolName !== "codemode") return;
            if (entry.cancelled || entry.paused || owner.closing)
              throw new Error("Delegation cancelled");
            ctx.signal?.throwIfAborted();
            owner.chargeToolCall();
            if (!input.codemodeEnabled?.())
              return { block: true, reason: "Parent codemode is no longer enabled" };
          });
          pi.on("turn_start", async () => {
            try {
              await owner.revalidateModel(effective(), entry.state.prewalk?.status === "armed");
              policyError = undefined;
            } catch (error) {
              policyError = String(error);
            }
          });
          pi.on("turn_end", async (event) => {
            if (
              !entry.cancelled &&
              !entry.paused &&
              !owner.closing &&
              entry.state.prewalk?.status === "armed" &&
              (completedMutation ||
                event.toolResults.some(
                  (result) =>
                    !result.isError &&
                    (result.toolName === "edit" || result.toolName === "write") &&
                    input.profile.tools.includes(result.toolName),
                ))
            ) {
              try {
                const next = entry.state.prewalk.target;
                await owner.revalidateModel(next, true);
                if (entry.cancelled || entry.paused || owner.closing) return;
                await entry.session!.setModel(target!);
                entry.session!.setThinkingLevel(next.effort);
                if (entry.session!.thinkingLevel !== next.effort)
                  throw new Error("SDK coerced prewalk effort");
                owner.update({
                  model: { provider: next.provider, id: next.id },
                  effort: next.effort,
                  prewalk: { target: next, status: "handed-off" },
                });
              } catch (error) {
                policyError = String(error);
              }
            }
          });
        },
      ],
    });
    await loader.reload();
    resources.getExtensions = () => loader.getExtensions();
    const tools: ToolDefinition[] = [
      ...input.profile.tools,
      ...(input.profile.leafTools ?? []),
    ].map((name) => {
      const tool = input.context.tools.find((tool) => tool.name === name);
      if (!tool) throw new Error(`Admitted parent tool is no longer callable: ${name}`);
      return {
        name,
        label: name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (_id, args, signal, onUpdate) => {
          if (entry.cancelled || entry.paused || owner.closing)
            throw new Error("Delegation cancelled");
          if (!input.context.tools.some((tool) => tool.name === name))
            throw new Error(`Admitted parent tool is no longer callable: ${name}`);
          const builtin = input.profile.tools.includes(name as BuiltinTool);
          await owner.authorizeTool(name, builtin);
          owner.assertTool(name, builtin, signal);
          // The public parent dispatcher preserves validation and permission hooks. Do not
          // call a raw create*Tool.execute here: that would bypass operator policy.
          const outcome = await input.context.executeTool(
            name,
            builtin
              ? workspaceArguments(name as BuiltinTool, args, selection.cwd, input.context.cwd)
              : args,
            { signal, onUpdate },
          );
          // SDK turn results contain only the outer codemode call, not its nested edits.
          if (!outcome.isError && builtin && (name === "edit" || name === "write"))
            completedMutation = true;
          return { ...outcome.result, isError: outcome.isError };
        },
      };
    });
    if (entry.validator) {
      const submission: ToolDefinition<typeof submissionParameters> = {
        name: "submit_result",
        label: "Submit result",
        exposure: "model-only",
        description: `Submit the assignment's required structured JSON value exactly once. Invalid values return errors and can be corrected within normal limits. Submission is provisional until prompt/tools/descendants drain; it never overrides cancellation or failure. Required schema: ${JSON.stringify(input.resultSchema)}`,
        parameters: submissionParameters,
        execute: async (_id, args, signal) => {
          signal?.throwIfAborted();
          if (
            entry.cancelled ||
            owner.closing ||
            entry.state.disposed ||
            entry.state.status !== "running"
          )
            throw new Error("Submission identity is no longer running");
          const outcome = entry.state.outcome!;
          if (outcome.validation === "submitted")
            throw new Error("A result was already submitted; duplicate submission rejected");
          const checked = entry.validator!.validate(args.value);
          if (!checked.ok) {
            const errors = checked.errors
              .map((error) => `${error.path || "/"}: ${error.message}`)
              .slice(0, 32);
            owner.update({
              outcome: {
                validation: "invalid",
                attempts: outcome.attempts + 1,
                errors,
                finalized: false,
              },
            });
            throw new Error(
              "Invalid structured result; correct and resubmit: " + errors.join("; "),
            );
          }
          owner.update({
            outcome: {
              validation: "submitted",
              attempts: outcome.attempts + 1,
              errors: [],
              value: structuredClone(args.value),
              finalized: false,
            },
          });
          return {
            content: [
              {
                type: "text",
                text: "Structured value submitted; final outcome awaits prompt/tool/descendant drain.",
              },
            ],
            details: {},
          };
        },
      };
      tools.push(submission);
    }
    if (input.profile.coordination?.length && input.coordinationTools)
      tools.push(
        ...input.coordinationTools({ id: entry.state.id, generation: entry.state.generation }),
      );
    if (input.profile.spawn?.length && input.nestedTool) tools.push(input.nestedTool(entry.state));
    for (const tool of tools) {
      const execute = tool.execute;
      tool.execute = async (...args) => {
        if (entry.cancelled || entry.paused || owner.closing)
          throw new Error("Delegation cancelled");
        owner.chargeToolCall();
        return execute(...args);
      };
    }
    const { session, modelFallbackMessage } = await createAgentSession({
      cwd: selection.cwd,
      agentDir,
      modelRuntime: runtime,
      model: selection.model,
      thinkingLevel: selection.thinkingLevel,
      scopedModels: [
        { model: selection.model!, thinkingLevel: selection.thinkingLevel },
        ...(target ? [{ model: target, thinkingLevel: input.profile.prewalk!.effort }] : []),
      ],
      resourceLoader: resources,
      tools: [...tools.map((tool) => tool.name), ...(inheritCodemode ? ["codemode"] : [])],
      customTools: tools,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
      sessionManager: SessionManager.create(selection.cwd, transcriptDir),
    });
    entry.session = session;
    if (session.thinkingLevel !== selection.thinkingLevel)
      throw new Error("SDK did not preserve selected effort");
    if (
      modelFallbackMessage ||
      session.model?.id !== selection.model?.id ||
      session.model?.provider !== selection.model?.provider
    )
      throw new Error("SDK did not preserve selected model");
    let markStarted = () => {};
    entry.unsubscribe = session.subscribe((event) => {
      const patch: { -readonly [K in keyof ChildSnapshot]?: ChildSnapshot[K] } = {};
      if (event.type === "agent_start") {
        patch.status = entry.cancelled ? "draining" : entry.paused ? "pausing" : "running";
        markStarted();
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        patch.progress = (entry.state.progress + event.assistantMessageEvent.delta).slice(-4096);
        patch.activity = patch.progress;
      }
      if (event.type === "message_end" && event.message.role === "user") {
        const text =
          typeof event.message.content === "string"
            ? event.message.content
            : event.message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
        owner.observeUserMessage(text);
      }
      if (event.type === "tool_execution_start") patch.activity = `Tool: ${event.toolName}`;
      if (event.type === "message_end" && event.message.role === "assistant") {
        const stats = session.getSessionStats();
        patch.telemetry = {
          ...entry.state.telemetry,
          tokens: stats.tokens,
          cost: stats.cost,
          context: session.getContextUsage() ?? null,
        };
      }
      owner.update(patch, event);
    });
    owner.update({ transcript: session.sessionFile });
    if (owner.closing || entry.cancelled) {
      owner.update({ status: "cancelled" });
      owner.dispose();
      return;
    }
    entry.prompt = (text) => {
      if (!entry.prompted) {
        text = entry.resumeText ? input.assignment + "\n\n" + entry.resumeText : input.assignment;
        entry.prompted = true;
      }
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      entry.run = session
        .prompt(text, { expandPromptTemplates: false })
        .then(async () => {
          if (entry.paused && !entry.cancelled && !owner.closing) return;
          await owner.drainDescendants();
          if (entry.paused && !entry.cancelled && !owner.closing) return;
          clearTimeout(entry.timer); // Work has drained; artifact publication is finalization.
          const last = session.messages.filter((message) => message.role === "assistant").at(-1);
          const failed = !last || last.stopReason === "error";
          const stats = session.getSessionStats();
          owner.update({ status: "draining", activity: "Finalizing outcome artifacts" });
          const result = session.getLastAssistantText() ?? "";
          const artifacts: NonNullable<ChildSnapshot["artifacts"]> = {};
          try {
            artifacts.text = await saveOutcomeArtifact(
              taskDir,
              "result.txt",
              last?.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("") ?? "",
            );
            if (entry.state.outcome?.validation === "submitted")
              artifacts.structured = await saveOutcomeArtifact(
                taskDir,
                "structured.json",
                JSON.stringify(entry.state.outcome.value),
              );
          } catch (error) {
            artifacts.error = `Outcome artifact persistence failed: ${String(error)}`;
          }
          const missing = entry.validator && entry.state.outcome?.validation !== "submitted";
          owner.update({
            artifacts,
            outcome: entry.state.outcome ? { ...entry.state.outcome, finalized: true } : undefined,
            status:
              entry.cancelled || last?.stopReason === "aborted"
                ? "cancelled"
                : failed || missing || artifacts.error
                  ? "failed"
                  : "settled",
            result,
            error: entry.state.limitReason
              ? entry.state.error
              : failed
                ? (last?.errorMessage ?? "No final assistant outcome")
                : missing
                  ? "Required structured result was not submitted successfully"
                  : artifacts.error,
            activity: "Prompt completed",
            telemetry: {
              requests: entry.state.telemetry.requests,
              tokens: stats.assistantMessages ? stats.tokens : null,
              cost: stats.assistantMessages ? stats.cost : null,
              context: session.getContextUsage() ?? null,
            },
          });
        })
        .catch(async (error) => {
          if (entry.paused && !entry.cancelled && !owner.closing) return;
          await owner.drainDescendants();
          owner.update({
            status: entry.cancelled ? "cancelled" : "failed",
            error: entry.state.limitReason ? entry.state.error : String(error),
          });
        })
        .finally(() => {
          if (!entry.paused || entry.cancelled || owner.closing) owner.dispose();
        });
      // Prompt preparation precedes abort-signal ownership in every execution window.
      return Promise.race([started, entry.run]);
    };
    if (entry.paused) return;
    await entry.prompt(entry.resumeText ?? input.assignment);
  } catch (error) {
    owner.update({
      status: entry.cancelled || owner.closing ? "cancelled" : "failed",
      error: String(error),
    });
    owner.dispose();
    throw error;
  }
}
