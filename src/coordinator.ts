import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession, createExtensionRuntime, SessionManager, SettingsManager,
  type AgentSession, type AgentSessionEvent, type ExtensionToolContext, type ResourceLoader, type Skill, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { parentModelRuntime } from "./model-adapter.ts";
import { isWriter, READ_TOOLS, type Profile } from "./profiles.ts";

export type ChildRef = Readonly<{ id: string; generation: number }>;
export type ChildSnapshot = Readonly<ChildRef & {
  parentId: string;
  status: "setup" | "running" | "settled" | "failed" | "cancelled";
  profile: string;
  assignment: string;
  activity: string;
  progress: string;
  result: string;
  model: { provider: string; id: string };
  effort: string | null;
  telemetry: { requests: number | null; tokens: ReturnType<AgentSession["getSessionStats"]>["tokens"] | null; cost: number | null; context: ReturnType<AgentSession["getContextUsage"]> | null };
  error?: string;
  transcript?: string;
  disposed: boolean;
}>;
export type RegistryEvent = Readonly<{ type: "changed" | "sdk"; child: ChildSnapshot; event?: AgentSessionEvent }>;
export type StartTask = { assignment: string; profile: Profile; skills: Skill[]; context: ExtensionToolContext; callerId: string };
type ChildSelection = Pick<ExtensionToolContext, "model" | "modelRegistry" | "scopedModels" | "thinkingLevel" | "cwd">;
type Entry = { state: ChildSnapshot; setup?: Promise<void>; run?: Promise<void>; session?: AgentSession; unsubscribe?: () => void; cancelled: boolean; callerId: string };

export function childResources(prompt: string, skills: Skill[] = []): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills, diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => prompt + "\nYou are a delegated child. Complete only this assignment; nested delegation is unavailable.",
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
    const child = [...this.entries.values()].find(entry => id.startsWith(entry.callerId + "/") && !entry.state.disposed);
    if (this.writer && (!child || this.writer !== child.state.id)) throw new Error(`Shared checkout writer is held by ${this.writer}; stop or wait for that task`);
    this.parentMutations.add(id);
  }
  parentToolEnd(id: string): void { this.parentMutations.delete(id); }
  async start(input: StartTask): Promise<ChildRef> {
    if (this.closing) throw new Error("Parent shut down");
    if (!input.assignment.trim()) throw new Error("A nonempty assignment is required");
    const selection = { model: input.context.model, modelRegistry: input.context.modelRegistry,
      scopedModels: input.context.scopedModels, thinkingLevel: input.context.thinkingLevel, cwd: input.context.cwd };
    if (!selection.model) throw new Error("A selected parent model is required");
    for (const name of input.profile.tools) if (!input.context.tools.some(tool => tool.name === name)) throw new Error(`Parent tool grant unavailable: ${name}`);
    const writer = isWriter(input.profile);
    if (writer && (this.writer || this.parentMutations.size)) throw new Error("Shared checkout writer conflict: active child writer or in-flight parent mutation");
    const id = randomUUID();
    const entry: Entry = { cancelled: false, callerId: input.callerId, state: {
      id, generation: 1, parentId: this.parentId, status: "setup", profile: input.profile.name,
      assignment: input.assignment, activity: "Preparing SDK child", progress: "", result: "", disposed: false,
      model: { provider: selection.model.provider, id: selection.model.id }, effort: selection.thinkingLevel ?? null,
      telemetry: { requests: null, tokens: null, cost: null, context: null },
    } };
    this.entries.set(id, entry);
    if (writer) this.writer = id;
    entry.setup = this.create(entry, input, selection);
    this.update(entry, {});
    await entry.setup;
    return { id, generation: 1 };
  }
  private async create(entry: Entry, input: StartTask, selection: ChildSelection): Promise<void> {
    try {
      const agentDir = join(this.root, entry.state.id, "agent");
      await mkdir(agentDir, { recursive: true });
      const runtime = await parentModelRuntime(selection, agentDir, () => this.update(entry, { telemetry: { ...entry.state.telemetry, requests: (entry.state.telemetry.requests ?? 0) + 1 } }));
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
      const { session, modelFallbackMessage } = await createAgentSession({
        cwd: selection.cwd, agentDir, modelRuntime: runtime, model: selection.model,
        thinkingLevel: selection.thinkingLevel, scopedModels: [{ model: selection.model!, thinkingLevel: selection.thinkingLevel }],
        resourceLoader: childResources(input.profile.prompt, input.skills), tools: [...input.profile.tools], customTools: tools,
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
        sessionManager: SessionManager.create(selection.cwd, join(this.root, entry.state.id, "transcripts")),
      });
      entry.session = session;
      if (modelFallbackMessage || session.model?.id !== selection.model?.id || session.model?.provider !== selection.model?.provider) throw new Error("SDK did not preserve selected model");
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      entry.unsubscribe = session.subscribe(event => {
        const patch: { -readonly [K in keyof ChildSnapshot]?: ChildSnapshot[K] } = {};
        if (event.type === "agent_start") { patch.status = entry.cancelled ? "cancelled" : "running"; markStarted(); }
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
      entry.run = session.prompt(input.assignment, { expandPromptTemplates: false }).then(() => {
        const last = session.messages.filter(message => message.role === "assistant").at(-1);
        const failed = !last || last.stopReason === "error";
        const stats = session.getSessionStats();
        this.update(entry, {
          status: entry.cancelled || last?.stopReason === "aborted" ? "cancelled" : failed ? "failed" : "settled",
          result: session.getLastAssistantText() ?? "",
          error: failed ? last?.errorMessage ?? "No final assistant outcome" : undefined,
          activity: "Prompt completed",
          telemetry: { requests: entry.state.telemetry.requests, tokens: stats.assistantMessages ? stats.tokens : null,
            cost: stats.assistantMessages ? stats.cost : null, context: session.getContextUsage() ?? null },
        });
      }).catch(error => this.update(entry, { status: entry.cancelled ? "cancelled" : "failed", error: String(error) }))
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
    entry.unsubscribe?.(); entry.session?.dispose();
    if (this.writer === entry.state.id) this.writer = undefined;
    this.update(entry, { disposed: true });
  }
  async steer(ref: ChildRef, text: string): Promise<"queued" | "handled"> {
    const entry = this.entry(ref);
    if (!text.trim()) throw new Error("Nonempty steering text is required");
    if (entry.state.status !== "running" || entry.cancelled) throw new Error("No running child");
    return entry.session!.steer(text);
  }
  async stop(ref: ChildRef): Promise<void> {
    const entry = this.entry(ref);
    if (entry.state.disposed) return;
    entry.cancelled = true;
    await entry.setup?.catch(() => {});
    if (entry.state.disposed) return;
    this.update(entry, { status: "cancelled" });
    await entry.session?.abort(); await entry.run;
    this.dispose(entry);
  }
  async wait(ref: ChildRef): Promise<ChildSnapshot> { const entry = this.entry(ref); await entry.setup; await entry.run; return this.snapshot(ref)!; }
  reopenTranscript(ref: ChildRef) { const path = this.entry(ref).state.transcript; if (!path) throw new Error("No transcript yet"); return SessionManager.open(path).buildSessionContext(); }
  shutdown(): Promise<void> {
    this.closing = true;
    this.shutdownPromise ??= (async () => { await Promise.all(this.list().map(ref => this.stop(ref))); this.listeners.clear(); })();
    return this.shutdownPromise;
  }
}
