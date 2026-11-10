import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore, type FauxResponseFactory } from "@earendil-works/pi-ai";

const PROOF_TOKENS_PER_SECOND = 4;
const MAX_ECHO_CHARS = 240;
const MAX_PROGRESS_CHARS = 4096;

export type ChildSnapshot = Readonly<{
  status: "not-started" | "starting" | "running" | "completed" | "cancelled" | "failed";
  progress: string;
  result: string;
  error?: string;
  transcript?: string;
  disposed: boolean;
}>;

// Complete resource ownership, rather than filtering discoveries after extensions have executed.
export function proofResources(): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Controlled subagent adapter proof. No tools, delegation, or ambient resources.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** One controlled child for one parent runtime; not a scheduler or recovery registry. */
export class ProofCoordinator {
  private state: ChildSnapshot = { status: "not-started", progress: "", result: "", disposed: false };
  private listeners = new Set<() => void>();
  private starting?: Promise<void>;
  private run?: Promise<void>;
  private closing = false;
  private shutdownPromise?: Promise<void>;
  private unsubscribe?: () => void;
  private session?: AgentSession;
  readonly root: string;

  constructor(root: string) { this.root = root; }
  snapshot(): ChildSnapshot { return { ...this.state }; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private update(patch: Partial<ChildSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  async start(prompt: string, tokensPerSecond = PROOF_TOKENS_PER_SECOND): Promise<void> {
    if (this.closing || this.starting) throw new Error("Proof child already started or parent shut down");
    if (!prompt.trim()) throw new Error("A nonempty proof prompt is required");
    this.update({ status: "starting" });
    this.starting = this.create(prompt, tokensPerSecond);
    await this.starting;
  }

  private async create(prompt: string, tokensPerSecond: number): Promise<void> {
    try {
      const cwd = join(this.root, "workspace");
      const agentDir = join(this.root, "agent");
      await mkdir(cwd, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(), modelsPath: null,
        modelsStorePath: join(agentDir, "models-cache.json"), refreshOnCreate: false,
        allowModelNetwork: false,
      });
      const controlled = fauxProvider({ provider: "extended-subagents-proof", tokensPerSecond,
        tokenSize: { min: 1, max: 1 } });
      // Every request, including queued steering, stays inside Pi's controlled provider.
      const respond: FauxResponseFactory = context => {
        controlled.appendResponses([respond]);
        const latest = context.messages.filter(message => message.role === "user").at(-1);
        const text = latest && typeof latest.content !== "string"
          ? latest.content.filter(block => block.type === "text").map(block => block.text).join("")
          : latest?.content ?? "";
        return fauxAssistantMessage(`Controlled response (not model reasoning): ${String(text).slice(0, MAX_ECHO_CHARS)}`);
      };
      controlled.setResponses([respond]);
      runtime.registerNativeProvider(controlled.provider);
      const { session } = await createAgentSession({
        cwd, agentDir, modelRuntime: runtime, model: controlled.getModel(), thinkingLevel: "off",
        resourceLoader: proofResources(), tools: [], customTools: [],
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
        sessionManager: SessionManager.create(cwd, join(this.root, "transcripts")),
      });
      this.session = session;
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      this.unsubscribe = session.subscribe(event => {
        if (event.type === "agent_start") {
          this.update({ status: "running" });
          markStarted();
        }
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          this.update({ progress: (this.state.progress + event.assistantMessageEvent.delta).slice(-MAX_PROGRESS_CHARS) });
        }
        if (event.type === "message_end" && event.message.role === "assistant") {
          const message = event.message;
          this.update({ result: message.content.filter(block => block.type === "text").map(block => block.text).join(""),
            ...(message.stopReason === "error" ? { status: "failed", error: message.errorMessage } : {}) });
        }
      });
      this.update({ transcript: session.sessionFile });
      if (this.closing) return;
      this.run = session.prompt(prompt).then(() => {
        if (this.state.status === "running") this.update({ status: "completed" });
      }).catch(error => this.update({ status: "failed", error: String(error) }));
      // prompt() prepares input asynchronously before the agent owns an abort signal.
      // Do not acknowledge startup until abort() can actually stop that run.
      await Promise.race([started, this.run]);
    } catch (error) {
      this.update({ status: "failed", error: String(error) });
      throw error;
    }
  }

  async steer(text: string): Promise<"queued" | "handled"> {
    if (!text.trim()) throw new Error("A nonempty steering message is required");
    if (!this.session || this.state.status !== "running") throw new Error("No running proof child");
    return this.session.steer(text);
  }
  async cancel(): Promise<void> {
    await this.starting;
    if (!this.session || !["starting", "running"].includes(this.state.status)) return;
    this.update({ status: "cancelled" });
    await this.session.abort();
    await this.run;
  }
  async wait(): Promise<void> { await this.starting; await this.run; }
  reopenTranscript() {
    if (!this.state.transcript) throw new Error("No transcript yet");
    return SessionManager.open(this.state.transcript).buildSessionContext();
  }
  shutdown(): Promise<void> {
    this.closing = true;
    this.shutdownPromise ??= this.close();
    return this.shutdownPromise;
  }
  private async close(): Promise<void> {
    try { await this.cancel(); }
    finally {
      this.session?.dispose();
      this.unsubscribe?.();
      this.update({ disposed: true });
      this.listeners.clear();
    }
  }
}
