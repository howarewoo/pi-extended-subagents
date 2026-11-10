import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession, createExtensionRuntime, SessionManager, SettingsManager,
  type AgentSession, type AgentSessionEvent, type ExtensionToolContext, type ResourceLoader, type Skill, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { resultValidator, submissionParameters, saveOutcomeArtifact, type StructuredOutcome } from "./outcomes.ts";
import type { Validator } from "@earendil-works/pi-schema";
import { parentModelRuntime } from "./model-adapter.ts";
import { DEFAULT_POLICY, narrowLimits, validatePolicy, type ExecutionLimits, type SchedulingPolicy } from "./scheduling.ts";
import { isWriter, READ_TOOLS, type Profile } from "./profiles.ts";

export type ChildRef = Readonly<{ id: string; generation: number }>;
export type ChildSnapshot = Readonly<ChildRef & {
  parentId: string;
  depth: number;
  writerLease: boolean;
  limits: ExecutionLimits;
  limitReason?: string;
  toolCalls: number;
  status: "queued" | "setup" | "running" | "draining" | "settled" | "failed" | "cancelled";
  profile: string;
  assignment: string;
  activity: string;
  progress: string;
  result: string;
  model: { provider: string; id: string };
  effort: string | null;
  telemetry: { requests: number | null; tokens: ReturnType<AgentSession["getSessionStats"]>["tokens"] | null; cost: number | null; context: ReturnType<AgentSession["getContextUsage"]> | null };
  outcome?: StructuredOutcome;
  artifacts?: { text?: string; structured?: string; error?: string };
  error?: string;
  transcript?: string;
  disposed: boolean;
}>;
export type RegistryEvent = Readonly<{ type: "changed" | "sdk"; child: ChildSnapshot; event?: AgentSessionEvent }>;
export type StartTask = { resultSchema?: unknown; assignment: string; profile: Profile; skills: Skill[]; context: ExtensionToolContext; callerId: string; parent?: ChildRef; limits?: Partial<ExecutionLimits>; nestedTool?: (parent: ChildRef) => ToolDefinition };
type ChildSelection = Pick<ExtensionToolContext, "model" | "modelRegistry" | "scopedModels" | "thinkingLevel" | "cwd">;
type Entry = { validator?: Validator; input: StartTask; selection: ChildSelection; done: Promise<void>; finish: () => void; timer?: ReturnType<typeof setTimeout>; spawned: number; state: ChildSnapshot; setup?: Promise<void>; run?: Promise<void>; session?: AgentSession; unsubscribe?: () => void; cancelled: boolean; callerId: string };

export function childResources(prompt: string, skills: Skill[] = []): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills, diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => prompt + "\nYou are a delegated child. Complete only this assignment; use only explicitly granted tools and spawn roles.",
    getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
}

/** Authoritative parent-lifetime registry. IDs are never reused; controls require their generation. */
export class DelegationCoordinator {
  private entries = new Map<string, Entry>();
  private listeners = new Set<(event: RegistryEvent) => void>();
  private parentMutations = new Set<string>();
  private writer?: string;
  private closing = false;
  private shutdownPromise?: Promise<void>;
  readonly root: string;
  readonly parentId: string;
  constructor(root: string, parentId: string) { this.root = root; this.parentId = parentId; }
  private policy: SchedulingPolicy = { ...DEFAULT_POLICY };
  configure(policy: SchedulingPolicy): void { this.policy = validatePolicy(policy); this.pump(); }
  list(): ChildSnapshot[] { return [...this.entries.values()].map(entry => structuredClone(entry.state)); }
  snapshot(ref?: ChildRef): ChildSnapshot | undefined {
    const entry = ref ? this.entry(ref) : [...this.entries.values()].at(-1);
    return entry && structuredClone(entry.state);
  }
  private entry(ref: ChildRef): Entry {
    const entry = this.entries.get(ref.id);
    if (!entry || entry.state.generation !== ref.generation) throw new Error("Unknown or stale delegation identity");
    return entry;
  }
  subscribe(listener: (event: RegistryEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private update(entry: Entry, patch: Partial<ChildSnapshot>, event?: AgentSessionEvent): void {
    entry.state = { ...entry.state, ...patch };
    for (const listener of this.listeners) {
      // Observers must never own execution or turn a successful run into failure.
      try { listener({ type: event ? "sdk" : "changed", child: structuredClone(entry.state), event }); } catch { /* observer isolated */ }
    }
  }
  /** Reserve at preflight, release on every finalized call (including blocked calls). */
  parentToolStart(id: string, name: string, readOnly = READ_TOOLS.includes(name as typeof READ_TOOLS[number])): void {
    if (readOnly || name === "delegate_task") return;
    const child = this.writer ? this.entries.get(this.writer) : undefined;
    if (this.writer && (!child || !id.startsWith(child.callerId + "/"))) throw new Error(`Shared checkout writer is held by ${this.writer}; stop or wait for that task`);
    this.parentMutations.add(id);
  }
  parentToolEnd(id: string): void { this.parentMutations.delete(id); this.pump(); }
  private active(): Entry[] { return [...this.entries.values()].filter(entry => !entry.state.disposed && entry.state.status !== "queued"); }
  private validate(input: StartTask): ChildSelection {
    if (this.closing) throw new Error("Parent shut down");
    if (!input.assignment.trim()) throw new Error("A nonempty assignment is required");
    const selection = { model: input.context.model, modelRegistry: input.context.modelRegistry,
      scopedModels: input.context.scopedModels, thinkingLevel: input.context.thinkingLevel, cwd: input.context.cwd };
    if (!selection.model) throw new Error("A selected parent model is required");
    for (const name of input.profile.tools) if (!input.context.tools.some(tool => tool.name === name)) throw new Error(`Parent tool grant unavailable: ${name}`);
    const writer = this.writer ? this.entries.get(this.writer) : undefined;
    if (isWriter(input.profile) && [...this.parentMutations].some(id => !writer || !id.startsWith(writer.callerId + "/"))) throw new Error("Shared checkout writer conflict: in-flight parent mutation");
    if (input.parent) {
      const parent = this.entry(input.parent);
      if (parent.cancelled || parent.state.disposed) throw new Error("Delegating parent is no longer active");
      if (!parent.input.profile.spawn?.includes(input.profile.name)) throw new Error("Ancestor spawn role denied");
      if (parent.state.depth >= Math.min(this.policy.depth, parent.state.limits.depth)) throw new Error("Delegation depth limit");
      if (input.profile.tools.some(tool => !parent.input.profile.tools.includes(tool)) || input.profile.skills.some(skill => !parent.input.profile.skills.includes(skill)) || input.profile.spawn?.some(role => !parent.input.profile.spawn?.includes(role))) throw new Error("Descendant cannot broaden ancestor grants");
      let ancestor: Entry | undefined = parent;
      while (ancestor) {
        if (isWriter(input.profile) && isWriter(ancestor.input.profile)) throw new Error("Nested writer under writer ancestor is unsupported");
        ancestor = this.entries.get(ancestor.state.parentId);
      }
    }
    return selection;
  }
  /** Whole-batch synchronous validation precedes registry insertion, disk setup or dispatch. */
  admit(inputs: StartTask[]): ChildRef[] {
    if (!inputs.length || inputs.length > this.policy.batch) throw new Error("Batch size limit");
    const selections = inputs.map(input => this.validate(input));
    const validators = inputs.map(input => input.resultSchema === undefined ? undefined : resultValidator(input.resultSchema));
    const limits = inputs.map(input => {
      const maximum: ExecutionLimits = { deadlineMs: this.policy.deadlineMs, requests: this.policy.requests,
        tools: this.policy.tools, depth: this.policy.depth, spawns: this.policy.spawns };
      if (input.parent) {
        const inherited = this.entry(input.parent).state.limits;
        for (const key of Object.keys(maximum) as (keyof ExecutionLimits)[]) maximum[key] = Math.min(maximum[key], inherited[key]);
      }
      return narrowLimits(maximum, input.limits ?? {});
    });
    const queued = [...this.entries.values()].filter(entry => entry.state.status === "queued" && !entry.state.disposed).length;
    const pending = [...this.entries.values()].filter(entry => entry.state.status === "queued" && !entry.state.disposed).map(entry => entry.input).concat(inputs);
    let slots = Math.max(0, this.policy.concurrency - this.active().length);
    let writerBusy = !!this.writer || !!this.parentMutations.size;
    let dispatchable = 0;
    for (const input of pending) {
      if (!slots || (isWriter(input.profile) && writerBusy)) break;
      slots--; dispatchable++;
      if (isWriter(input.profile)) writerBusy = true;
    }
    if (pending.length - dispatchable > this.policy.queue) throw new Error("Delegation queue capacity limit");
    const parents = new Map<Entry, number>();
    for (const input of inputs) if (input.parent) { const parent = this.entry(input.parent); parents.set(parent, (parents.get(parent) ?? 0) + 1); }
    for (const [parent, count] of parents) {
      if (parent.spawned + count > Math.min(this.policy.spawns, parent.state.limits.spawns)) throw new Error("Delegation spawn limit");
      // Waiting sessions retain their permits: no lending or hidden overcommit. Refuse
      // nested waits that cannot start immediately instead of queuing a deadlock.
      if (queued || this.active().length + inputs.length > this.policy.concurrency || (inputs.some(input => isWriter(input.profile)) && (this.writer || inputs.filter(input => isWriter(input.profile)).length > 1))) throw new Error("Nested capacity unavailable; no permit lending");
    }
    const entries = inputs.map((input, index) => {
      const selection = selections[index];
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      const entry: Entry = { validator: validators[index], input, selection, done, finish, spawned: 0, cancelled: false, callerId: input.callerId, state: {
        id: randomUUID(), generation: 1, parentId: input.parent?.id ?? this.parentId,
        depth: input.parent ? this.entry(input.parent).state.depth + 1 : 1,
        status: "queued", writerLease: false, limits: limits[index], toolCalls: 0, profile: input.profile.name,
        outcome: validators[index] ? { validation: "awaiting", attempts: 0, errors: [], finalized: false } : undefined,
        assignment: input.assignment, activity: "Queued for capacity / writer admission", progress: "", result: "", disposed: false,
        model: { provider: selection.model!.provider, id: selection.model!.id }, effort: selection.thinkingLevel ?? null,
        telemetry: { requests: null, tokens: null, cost: null, context: null },
      } };
      return entry;
    });
    for (const [parent, count] of parents) parent.spawned += count;
    for (const entry of entries) this.entries.set(entry.state.id, entry);
    for (const entry of entries) {
      entry.timer = setTimeout(() => { this.limit(entry, "deadline"); }, entry.state.limits.deadlineMs);
    }
    for (const entry of entries) if (!entry.state.disposed) this.update(entry, {});
    this.pump();
    return entries.map(entry => ({ id: entry.state.id, generation: entry.state.generation }));
  }
  async start(input: StartTask): Promise<ChildRef> {
    const [ref] = this.admit([input]);
    await this.entry(ref).setup;
    return ref;
  }
  private pump(): void {
    if (this.closing) return;
    for (const entry of this.entries.values()) {
      if (entry.cancelled || entry.state.disposed || entry.state.status !== "queued") continue;
      if (this.active().length >= this.policy.concurrency) break;
      const writer = isWriter(entry.input.profile);
      if (writer && (this.writer || this.parentMutations.size)) break; // strict FIFO
      if (writer) this.writer = entry.state.id;
      entry.state = { ...entry.state, status: "setup", writerLease: writer, activity: "Preparing SDK child" };
      entry.setup = this.create(entry, entry.input, entry.selection);
      this.update(entry, {});
      void entry.setup.catch(() => {});
    }
  }
  private limit(entry: Entry, reason: string): void {
    if (entry.cancelled || entry.state.disposed || entry.state.limitReason || ["settled", "failed", "cancelled"].includes(entry.state.status)) return;
    this.update(entry, { limitReason: reason, error: `Execution limit: ${reason}` });
    void this.stop(entry.state);
  }
  private async create(entry: Entry, input: StartTask, selection: ChildSelection): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true });
      const taskDir = join(this.root, entry.state.id);
      await mkdir(taskDir); // exclusive ownership: never reuse an existing task record
      const agentDir = join(taskDir, "agent");
      await mkdir(agentDir);
      const runtime = await parentModelRuntime(selection, agentDir, () => {
        if (entry.cancelled || this.closing) throw new Error("Delegation cancelled");
        if ((entry.state.telemetry.requests ?? 0) >= entry.state.limits.requests) { this.limit(entry, "requests"); throw new Error("Direct request limit"); }
        this.update(entry, { telemetry: { ...entry.state.telemetry, requests: (entry.state.telemetry.requests ?? 0) + 1 } });
      });
      const tools: ToolDefinition[] = input.profile.tools.map(name => {
        const tool = input.context.tools.find(tool => tool.name === name)!;
        return { name, label: name, description: tool.description, parameters: tool.parameters,
          execute: async (_id, args, signal, onUpdate) => {
            if (entry.cancelled || this.closing) throw new Error("Delegation cancelled");
            // The public parent dispatcher preserves validation and permission hooks. Do not
            // call a raw create*Tool.execute here: that would bypass operator policy.
            const outcome = await input.context.executeTool(name, args, { signal, onUpdate });
            return { ...outcome.result, isError: outcome.isError };
          } };
      });
      if (entry.validator) {
        const submission: ToolDefinition<typeof submissionParameters> = {
          name: "submit_result", label: "Submit result", exposure: "model-only",
          description: `Submit the assignment's required structured JSON value exactly once. Invalid values return errors and can be corrected within normal limits. Submission is provisional until prompt/tools/descendants drain; it never overrides cancellation or failure. Required schema: ${JSON.stringify(input.resultSchema)}`,
          parameters: submissionParameters,
          execute: async (_id, args, signal) => {
            signal?.throwIfAborted();
            if (entry.cancelled || this.closing || entry.state.disposed || entry.state.status !== "running") throw new Error("Submission identity is no longer running");
            const outcome = entry.state.outcome!;
            if (outcome.validation === "submitted") throw new Error("A result was already submitted; duplicate submission rejected");
            const checked = entry.validator!.validate(args.value);
            if (!checked.ok) {
              const errors = checked.errors.map(error => `${error.path || "/"}: ${error.message}`).slice(0, 32);
              this.update(entry, { outcome: { validation: "invalid", attempts: outcome.attempts + 1, errors, finalized: false } });
              throw new Error("Invalid structured result; correct and resubmit: " + errors.join("; "));
            }
            this.update(entry, { outcome: { validation: "submitted", attempts: outcome.attempts + 1, errors: [], value: structuredClone(args.value), finalized: false } });
            return { content: [{ type: "text", text: "Structured value submitted; final outcome awaits prompt/tool/descendant drain." }], details: {} };
          },
        };
        tools.push(submission);
      }
      if (input.profile.spawn?.length && input.nestedTool) tools.push(input.nestedTool(entry.state));
      for (const tool of tools) {
        const execute = tool.execute;
        tool.execute = async (...args) => {
          if (entry.cancelled || this.closing) throw new Error("Delegation cancelled");
          if (entry.state.toolCalls >= entry.state.limits.tools) { this.limit(entry, "tools"); throw new Error("Tool call limit"); }
          this.update(entry, { toolCalls: entry.state.toolCalls + 1 });
          return execute(...args);
        };
      }
      const { session, modelFallbackMessage } = await createAgentSession({
        cwd: selection.cwd, agentDir, modelRuntime: runtime, model: selection.model,
        thinkingLevel: selection.thinkingLevel, scopedModels: [{ model: selection.model!, thinkingLevel: selection.thinkingLevel }],
        resourceLoader: childResources(input.profile.prompt + (entry.validator ? "\nThis assignment requires a structured result. Call submit_result with the actual value; final prose is not a submission." : ""), input.skills), tools: tools.map(tool => tool.name), customTools: tools,
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
        sessionManager: SessionManager.create(selection.cwd, join(this.root, entry.state.id, "transcripts")),
      });
      entry.session = session;
      if (modelFallbackMessage || session.model?.id !== selection.model?.id || session.model?.provider !== selection.model?.provider) throw new Error("SDK did not preserve selected model");
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      entry.unsubscribe = session.subscribe(event => {
        const patch: { -readonly [K in keyof ChildSnapshot]?: ChildSnapshot[K] } = {};
        if (event.type === "agent_start") { patch.status = entry.cancelled ? "draining" : "running"; markStarted(); }
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          patch.progress = (entry.state.progress + event.assistantMessageEvent.delta).slice(-4096);
          patch.activity = patch.progress;
        }
        if (event.type === "tool_execution_start") patch.activity = `Tool: ${event.toolName}`;
        if (event.type === "message_end" && event.message.role === "assistant") {
          const stats = session.getSessionStats();
          patch.telemetry = { ...entry.state.telemetry, tokens: stats.tokens, cost: stats.cost, context: session.getContextUsage() ?? null };
        }
        this.update(entry, patch, event);
      });
      this.update(entry, { transcript: session.sessionFile });
      if (this.closing || entry.cancelled) { this.update(entry, { status: "cancelled" }); this.dispose(entry); return; }
      entry.run = session.prompt(input.assignment, { expandPromptTemplates: false }).then(async () => {
        await this.stopMany(this.children(entry).map(child => child.state));
        const last = session.messages.filter(message => message.role === "assistant").at(-1);
        const failed = !last || last.stopReason === "error";
        const stats = session.getSessionStats();
        this.update(entry, { status: "draining", activity: "Finalizing outcome artifacts" });
        const result = session.getLastAssistantText() ?? "";
        const artifacts: NonNullable<ChildSnapshot["artifacts"]> = {};
        try {
          artifacts.text = await saveOutcomeArtifact(taskDir, "result.txt", last?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "");
          if (entry.state.outcome?.validation === "submitted") artifacts.structured = await saveOutcomeArtifact(taskDir, "structured.json", JSON.stringify(entry.state.outcome.value));
        } catch (error) { artifacts.error = `Outcome artifact persistence failed: ${String(error)}`; }
        const missing = entry.validator && entry.state.outcome?.validation !== "submitted";
        this.update(entry, {
          artifacts,
          outcome: entry.state.outcome ? { ...entry.state.outcome, finalized: true } : undefined,
          status: entry.cancelled || last?.stopReason === "aborted" ? "cancelled" : failed || missing || artifacts.error ? "failed" : "settled",
          result,
          error: entry.state.limitReason ? entry.state.error : failed ? last?.errorMessage ?? "No final assistant outcome" : missing ? "Required structured result was not submitted successfully" : artifacts.error,
          activity: "Prompt completed",
          telemetry: { requests: entry.state.telemetry.requests, tokens: stats.assistantMessages ? stats.tokens : null,
            cost: stats.assistantMessages ? stats.cost : null, context: session.getContextUsage() ?? null },
        });
      }).catch(async error => {
        await this.stopMany(this.children(entry).map(child => child.state));
        this.update(entry, { status: entry.cancelled ? "cancelled" : "failed", error: entry.state.limitReason ? entry.state.error : String(error) });
      })
        .finally(() => this.dispose(entry));
      // prompt preparation precedes abort-signal ownership; acknowledge only abortable work.
      await Promise.race([started, entry.run]);
    } catch (error) {
      this.update(entry, { status: entry.cancelled || this.closing ? "cancelled" : "failed", error: String(error) });
      this.dispose(entry);
      throw error;
    }
  }
  private dispose(entry: Entry): void {
    if (entry.state.disposed) return;
    clearTimeout(entry.timer);
    entry.unsubscribe?.(); entry.session?.dispose();
    if (this.writer === entry.state.id) this.writer = undefined;
    this.update(entry, { disposed: true, writerLease: false, outcome: entry.state.outcome ? { ...entry.state.outcome, finalized: true } : undefined });
    entry.finish();
    this.pump();
  }
  taskInputRead(ref: ChildRef): void {
    const entry = this.entry(ref);
    if (entry.cancelled || entry.state.disposed || this.closing || !entry.input.profile.tools.includes("read")) throw new Error("Delegating parent has no active read grant");
    if (entry.state.toolCalls >= entry.state.limits.tools) { this.limit(entry, "tools"); throw new Error("Tool call limit"); }
    this.update(entry, { toolCalls: entry.state.toolCalls + 1 });
  }
  async steer(ref: ChildRef, text: string): Promise<"queued" | "handled"> {
    const entry = this.entry(ref);
    if (!text.trim()) throw new Error("Nonempty steering text is required");
    if (entry.state.status !== "running" || entry.cancelled) throw new Error("No running child");
    return entry.session!.steer(text);
  }
  private children(entry: Entry): Entry[] { return [...this.entries.values()].filter(child => child.state.parentId === entry.state.id && !child.state.disposed); }
  async stopMany(refs: readonly ChildRef[]): Promise<void> {
    const entries = refs.map(ref => this.entry(ref));
    // Mark the whole cancellation set before any disposal can dequeue a sibling.
    for (const entry of entries) if (!entry.state.disposed) entry.cancelled = true;
    await Promise.all(entries.map(entry => this.stop(entry.state)));
  }
  async stop(ref: ChildRef): Promise<void> {
    const entry = this.entry(ref);
    if (entry.state.disposed) return;
    entry.cancelled = true;
    if (entry.state.status === "queued") { this.update(entry, { status: "cancelled", activity: "Cancelled before setup" }); this.dispose(entry); return; }
    this.update(entry, { status: "draining", activity: "Cancelling and draining" });
    // Start subtree cancellation without waiting for tools queued behind this session.
    const descendants = this.stopMany(this.children(entry).map(child => child.state));
    await entry.setup?.catch(() => {});
    await Promise.all([descendants, entry.state.disposed ? undefined : entry.session?.abort()]);
    if (entry.state.disposed) return;
    await entry.run;
    this.dispose(entry);
  }
  async wait(ref: ChildRef): Promise<ChildSnapshot> { const entry = this.entry(ref); await entry.done; return this.snapshot(ref)!; }
  reopenTranscript(ref: ChildRef) { const path = this.entry(ref).state.transcript; if (!path) throw new Error("No transcript yet"); return SessionManager.open(path).buildSessionContext(); }
  shutdown(): Promise<void> {
    this.closing = true;
    this.shutdownPromise ??= (async () => { await Promise.all(this.list().map(ref => this.stop(ref))); this.listeners.clear(); })();
    return this.shutdownPromise;
  }
}
