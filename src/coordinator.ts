import {
  leafDenial,
  toolProvenance,
  type ToolMetadata,
  type CapabilityDenial,
} from "./capabilities.ts";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
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
import {
  resultValidator,
  submissionParameters,
  saveOutcomeArtifact,
  type StructuredOutcome,
} from "./outcomes.ts";
import type { Validator } from "@earendil-works/pi-schema";
import {
  allowsModel,
  sameSelection,
  validateModelSelection,
  type ModelSelection,
} from "./model-policy.ts";
import { parentModelRuntime } from "./model-adapter.ts";
import { resolveWorkspace, workspaceArguments } from "./workspace.ts";
import {
  DEFAULT_POLICY,
  narrowLimits,
  validatePolicy,
  type ExecutionLimits,
  type SchedulingPolicy,
} from "./scheduling.ts";
import {
  resolveProfile,
  intersectProfileGrants,
  isWriter,
  READ_TOOLS,
  type Profile,
  type BuiltinTool,
  type CoordinationAction,
} from "./profiles.ts";

const MAX_MESSAGE_BYTES = 4096;
const MAX_MAILBOX_MESSAGES = 64;
const MAX_RETAINED_MESSAGES = 512;
const MAX_WAITERS = 64;
const MAX_WAIT_MS = 60000;
const MAX_GENERATIONS = 64;

export type DelegationMessage = {
  id: string;
  sender: ChildRef | "root";
  recipient: ChildRef | "root";
  text: string;
  mode: "inbox" | "steer" | "followUp";
  status: "accepted" | "queued" | "handled" | "delivered" | "not-running" | "error";
  error?: string;
};
export type CoordinationWait =
  | { status: "timeout" | "cancelled" | "shutdown" }
  | { status: "messages"; messages: DelegationMessage[] }
  | { status: "message"; message: DelegationMessage }
  | {
      status: "outcome";
      outcome: Pick<ChildSnapshot, "id" | "generation" | "status" | "limitReason">;
    };
export type ChildRef = Readonly<{ id: string; generation: number }>;
export type ChildSnapshot = Readonly<
  ChildRef & {
    parentId: string;
    parentGeneration?: number;
    depth: number;
    writerLease: boolean;
    limits: ExecutionLimits;
    limitReason?: string;
    toolCalls: number;
    status: "queued" | "setup" | "running" | "draining" | "settled" | "failed" | "cancelled";
    profile: string;
    tools: readonly BuiltinTool[];
    leafTools?: readonly string[];
    skills?: readonly string[];
    capabilityDenials?: readonly CapabilityDenial[];
    cwd?: string;
    assignment: string;
    activity: string;
    progress: string;
    result: string;
    model: { provider: string; id: string };
    effort: string | null;
    prewalk?: {
      target: ModelSelection;
      status: "armed" | "handed-off" | "suppressed-exact" | "no-op";
    };
    telemetry: {
      requests: number | null;
      tokens: ReturnType<AgentSession["getSessionStats"]>["tokens"] | null;
      cost: number | null;
      context: ReturnType<AgentSession["getContextUsage"]> | null;
    };
    outcome?: StructuredOutcome;
    artifacts?: { text?: string; structured?: string; error?: string };
    error?: string;
    transcript?: string;
    disposed: boolean;
    createdAt: number;
    endedAt: number | null;
  }
>;
export type RegistryEvent = Readonly<{
  type: "changed" | "sdk";
  child: ChildSnapshot;
  event?: AgentSessionEvent;
}>;
export type StartTask = {
  cwd?: string;
  model?: ModelSelection;
  resultSchema?: unknown;
  assignment: string;
  profile: Profile;
  skills: Skill[];
  context: ExtensionToolContext;
  assertTools: (names: readonly string[]) => void;
  toolMetadata?: () => readonly ToolMetadata[];
  availableSkills?: () => readonly Skill[];
  capabilityDenials?: CapabilityDenial[];
  leafProvenance?: Readonly<Record<string, string>>;
  callerId: string;
  parent?: ChildRef;
  limits?: Partial<ExecutionLimits>;
  coordinationTools?: (actor: ChildRef) => ToolDefinition[];
  nestedTool?: (parent: ChildRef) => ToolDefinition;
};
type ChildSelection = Pick<
  ExtensionToolContext,
  "model" | "modelRegistry" | "scopedModels" | "thinkingLevel" | "cwd"
>;
type Entry = {
  validator?: Validator;
  input: StartTask;
  selection: ChildSelection;
  done: Promise<void>;
  finish: () => void;
  timer?: ReturnType<typeof setTimeout>;
  spawned: number;
  state: ChildSnapshot;
  finalizedMessages?: AgentSession["messages"];
  setup?: Promise<void>;
  run?: Promise<void>;
  session?: AgentSession;
  unsubscribe?: () => void;
  cancelled: boolean;
  callerId: string;
};

function admittedModel(entry: Entry, selection: ModelSelection): boolean {
  return entry.input.profile.models === undefined
    ? sameSelection(selection, {
        ...entry.state.model,
        effort: entry.state.effort as ModelSelection["effort"],
      })
    : allowsModel(entry.input.profile, selection);
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

/** Authoritative parent-lifetime registry. IDs are never reused; controls require their generation. */
export class DelegationCoordinator {
  private entries = new Map<string, Entry>();
  private queue = new Set<Entry>();
  private history = new Map<string, { state: ChildSnapshot; messages: AgentSession["messages"] }>();
  private presence = new Map<string, "active" | "idle" | "parked" | "stopped">();
  private coordinationListeners = new Set<() => void>();
  private coordinationMessages: DelegationMessage[] = [];
  private mailboxes = new Map<string, DelegationMessage[]>();
  private waits = new Map<string, Set<string>>();
  private waiterCount = 0;
  private notifyCoordination(): void {
    for (const listener of this.coordinationListeners) listener();
  }
  agents() {
    return this.list().map((state) => ({
      id: state.id,
      generation: state.generation,
      presence: this.presence.get(state.id),
    }));
  }
  generations(id: string): ChildSnapshot[] {
    return [...this.history.values()]
      .map((record) => record.state)
      .concat(this.list())
      .filter((state) => state.id === id)
      .map((state) => structuredClone(state));
  }
  private listeners = new Set<(event: RegistryEvent) => void>();
  private parentMutations = new Set<string>();
  private writer?: string;
  private closing = false;
  private shutdownPromise?: Promise<void>;
  readonly root: string;
  readonly parentId: string;
  constructor(root: string, parentId: string) {
    this.root = root;
    this.parentId = parentId;
  }
  private policy: SchedulingPolicy = { ...DEFAULT_POLICY };
  configure(policy: SchedulingPolicy): void {
    this.policy = validatePolicy(policy);
    this.pump();
  }
  list(): ChildSnapshot[] {
    return [...this.entries.values()].map((entry) => structuredClone(entry.state));
  }
  snapshot(ref?: ChildRef): ChildSnapshot | undefined {
    if (ref) {
      const historical = this.history.get(this.key(ref));
      if (historical) return structuredClone(historical.state);
    }
    const entry = ref ? this.entry(ref) : [...this.entries.values()].at(-1);
    return entry && structuredClone(entry.state);
  }
  private entry(ref: ChildRef): Entry {
    const entry = this.entries.get(ref.id);
    if (!entry || entry.state.generation !== ref.generation)
      throw new Error("Unknown or stale delegation identity");
    return entry;
  }
  subscribe(listener: (event: RegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(entry: Entry, patch: Partial<ChildSnapshot>, event?: AgentSessionEvent): void {
    entry.state = { ...entry.state, ...patch };
    this.notifyCoordination();
    for (const listener of this.listeners) {
      // Observers must never own execution or turn a successful run into failure.
      try {
        listener({ type: event ? "sdk" : "changed", child: structuredClone(entry.state), event });
      } catch {
        /* observer isolated */
      }
    }
  }
  /** Reserve at preflight, release on every finalized call (including blocked calls). */
  parentToolStart(
    id: string,
    name: string,
    readOnly = READ_TOOLS.includes(name as (typeof READ_TOOLS)[number]),
  ): void {
    if (readOnly || name === "delegate_task" || name === "delegate_coordinate") return;
    const child = this.writer ? this.entries.get(this.writer) : undefined;
    if (this.writer && (!child || !id.startsWith(child.callerId + "/")))
      throw new Error(
        `Shared checkout writer is held by ${this.writer}; stop or wait for that task`,
      );
    this.parentMutations.add(id);
  }
  parentToolEnd(id: string): void {
    this.parentMutations.delete(id);
    this.pump();
  }
  private active(): Entry[] {
    return [...this.entries.values()].filter(
      (entry) => !entry.state.disposed && entry.state.status !== "queued",
    );
  }
  private validate(input: StartTask): ChildSelection {
    if (this.closing) throw new Error("Parent shut down");
    if (!input.assignment.trim()) throw new Error("A nonempty assignment is required");
    const selection = {
      model: input.context.model,
      modelRegistry: input.context.modelRegistry,
      scopedModels: input.context.scopedModels,
      thinkingLevel: input.context.thinkingLevel,
      cwd: input.cwd ?? input.context.cwd,
    };
    if (!selection.model) throw new Error("A selected parent model is required");
    const requested = input.model ?? input.profile.model;
    const parentState = input.parent ? this.entry(input.parent).state : undefined;
    const effective: ModelSelection = requested ?? {
      ...(parentState?.model ?? { provider: selection.model.provider, id: selection.model.id }),
      effort:
        (parentState?.effort as ModelSelection["effort"] | undefined) ??
        selection.thinkingLevel ??
        "off",
    };
    if (
      (requested && !input.profile.models?.some((item) => sameSelection(item, requested))) ||
      !allowsModel(input.profile, effective)
    )
      throw new Error("Model selection denied by effective profile grants");
    selection.model = validateModelSelection(selection, effective);
    selection.thinkingLevel = effective.effort;
    if (input.profile.prewalk && !input.model) {
      if (!input.profile.models?.some((item) => sameSelection(item, input.profile.prewalk!)))
        throw new Error("Prewalk target requires an exact model grant");
      validateModelSelection(selection, input.profile.prewalk);
    }
    const writer = this.writer ? this.entries.get(this.writer) : undefined;
    if (
      isWriter(input.profile) &&
      [...this.parentMutations].some((id) => !writer || !id.startsWith(writer.callerId + "/"))
    )
      throw new Error("Shared checkout writer conflict: in-flight parent mutation");
    if (input.parent) {
      const parent = this.entry(input.parent);
      if (parent.cancelled || parent.state.disposed)
        throw new Error("Delegating parent is no longer active");
      if (
        !admittedModel(parent, effective) ||
        input.profile.models?.some((model) => !admittedModel(parent, model)) ||
        (input.profile.prewalk && !input.model && !admittedModel(parent, input.profile.prewalk))
      )
        throw new Error("Descendant cannot broaden ancestor model grants");
      if (!parent.input.profile.spawn?.includes(input.profile.name))
        throw new Error("Ancestor spawn role denied");
      if (parent.state.depth >= Math.min(this.policy.depth, parent.state.limits.depth))
        throw new Error("Delegation depth limit");
      if (
        input.profile.tools.some((tool) => !parent.input.profile.tools.includes(tool)) ||
        input.profile.skills.some((skill) => !parent.input.profile.skills.includes(skill)) ||
        input.profile.leafTools?.some((name) => !parent.input.profile.leafTools?.includes(name)) ||
        input.profile.spawn?.some((role) => !parent.input.profile.spawn?.includes(role)) ||
        input.profile.coordination?.some(
          (action) => !parent.input.profile.coordination?.includes(action),
        )
      )
        throw new Error("Descendant cannot broaden ancestor grants");
      let ancestor: Entry | undefined = parent;
      while (ancestor) {
        if (isWriter(input.profile) && isWriter(ancestor.input.profile))
          throw new Error("Nested writer under writer ancestor is unsupported");
        ancestor = this.entries.get(ancestor.state.parentId);
      }
    }
    return selection;
  }
  /** Whole-batch synchronous validation precedes registry insertion, disk setup or dispatch. */
  admit(inputs: StartTask[], replacement?: ChildRef): ChildRef[] {
    const previous = replacement ? this.entry(replacement) : undefined;
    inputs = inputs.map((input) => {
      const cwd = resolveWorkspace(
        input.cwd ??
          previous?.selection.cwd ??
          (input.parent ? this.entry(input.parent).selection.cwd : undefined),
        input.context.cwd,
      );
      if (previous && cwd !== previous.selection.cwd)
        throw new Error("Follow-up must retain its original workspace");
      if (typeof input.assertTools !== "function")
        throw new Error("Delegation requires a parent builtin provenance validator");
      const callable = new Set(input.context.tools.map((tool) => tool.name));
      const capabilityDenials: CapabilityDenial[] = [];
      const leafTools: string[] = [];
      const leafProvenance: Record<string, string> = {};
      if (input.profile.name === "general") {
        const metadata = input.toolMetadata?.() ?? [];
        const sameWorkspace = cwd === resolveWorkspace(undefined, input.context.cwd);
        for (const tool of metadata) {
          if (input.profile.tools.includes(tool.name as BuiltinTool)) continue;
          const reason = !callable.has(tool.name)
            ? "tool is not live callable"
            : leafDenial(tool, input.profile.leafTools ?? [], sameWorkspace);
          if (reason) capabilityDenials.push({ name: tool.name, reason });
          else {
            leafTools.push(tool.name);
            leafProvenance[tool.name] = toolProvenance(tool);
          }
        }
        for (const name of input.profile.leafTools ?? [])
          if (!metadata.some((tool) => tool.name === name))
            capabilityDenials.push({ name, reason: "tool metadata unavailable" });
      }
      const profile = {
        ...input.profile,
        leafTools,
        tools: input.profile.tools.filter((name) => callable.has(name)),
      };
      if (!profile.tools.length)
        throw new Error(
          `Profile ${profile.name} has no callable parent builtin tools; enable an allowed parent tool or choose a usable profile`,
        );
      input.assertTools(profile.tools);
      return { ...input, profile, cwd, capabilityDenials, leafProvenance };
    });
    if (previous) {
      if (
        inputs.length !== 1 ||
        !previous.state.disposed ||
        !["idle", "parked"].includes(this.presence.get(previous.state.id) ?? "")
      )
        throw new Error("Assignment is not idle or parked");
      if (this.key(previous.input.parent) !== this.key(inputs[0].parent))
        throw new Error("Follow-up must retain its exact original parent generation");
      if (previous.state.generation >= MAX_GENERATIONS)
        throw new Error("Generation retention limit");
      const profile = inputs[0].profile;
      if (
        (previous.input.profile.models !== undefined && profile.models === undefined) ||
        profile.models?.some(
          (model) => !previous.input.profile.models?.some((grant) => sameSelection(model, grant)),
        )
      )
        throw new Error("Follow-up cannot broaden previous model grants");
      if (
        profile.name !== previous.input.profile.name ||
        profile.tools.some((tool) => !previous.input.profile.tools.includes(tool)) ||
        profile.skills.some((skill) => !previous.input.profile.skills.includes(skill)) ||
        profile.leafTools?.some((name) => !previous.input.profile.leafTools?.includes(name)) ||
        profile.spawn?.some((role) => !previous.input.profile.spawn?.includes(role)) ||
        profile.coordination?.some(
          (action) => !previous.input.profile.coordination?.includes(action),
        )
      )
        throw new Error("Follow-up cannot broaden previous grants");
    }
    if (!inputs.length || inputs.length > this.policy.batch) throw new Error("Batch size limit");
    const selections = inputs.map((input) => this.validate(input));
    const validators = inputs.map((input) =>
      input.resultSchema === undefined ? undefined : resultValidator(input.resultSchema),
    );
    const limits = inputs.map((input) => {
      const maximum: ExecutionLimits = {
        deadlineMs: this.policy.deadlineMs,
        requests: this.policy.requests,
        tools: this.policy.tools,
        depth: this.policy.depth,
        spawns: this.policy.spawns,
      };
      if (input.parent) {
        const inherited = this.entry(input.parent).state.limits;
        for (const key of Object.keys(maximum) as (keyof ExecutionLimits)[])
          maximum[key] = Math.min(maximum[key], inherited[key]);
      }
      return narrowLimits(maximum, input.limits ?? {});
    });
    const queued = this.queue.size;
    const pending = [...this.queue].map((entry) => entry.input).concat(inputs);
    let slots = Math.max(0, this.policy.concurrency - this.active().length);
    let writerBusy = !!this.writer || !!this.parentMutations.size;
    let dispatchable = 0;
    for (const input of pending) {
      if (!slots || (isWriter(input.profile) && writerBusy)) break;
      slots--;
      dispatchable++;
      if (isWriter(input.profile)) writerBusy = true;
    }
    if (pending.length - dispatchable > this.policy.queue)
      throw new Error("Delegation queue capacity limit");
    const parents = new Map<Entry, number>();
    for (const input of inputs)
      if (input.parent) {
        const parent = this.entry(input.parent);
        parents.set(parent, (parents.get(parent) ?? 0) + 1);
      }
    for (const [parent, count] of parents) {
      if (parent.spawned + count > Math.min(this.policy.spawns, parent.state.limits.spawns))
        throw new Error("Delegation spawn limit");
      // Waiting sessions retain their permits: no lending or hidden overcommit. Refuse
      // nested waits that cannot start immediately instead of queuing a deadlock.
      if (
        queued ||
        this.active().length + inputs.length > this.policy.concurrency ||
        (inputs.some((input) => isWriter(input.profile)) &&
          (this.writer || inputs.filter((input) => isWriter(input.profile)).length > 1))
      )
        throw new Error("Nested capacity unavailable; no permit lending");
    }
    const entries = inputs.map((input, index) => {
      const selection = selections[index];
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const entry: Entry = {
        validator: validators[index],
        input,
        selection,
        done,
        finish,
        spawned: previous?.spawned ?? 0,
        cancelled: false,
        callerId: input.callerId,
        state: {
          id: previous?.state.id ?? randomUUID(),
          generation: (previous?.state.generation ?? 0) + 1,
          parentGeneration: input.parent?.generation,
          parentId: input.parent?.id ?? this.parentId,
          depth: input.parent ? this.entry(input.parent).state.depth + 1 : 1,
          createdAt: Date.now(),
          endedAt: null,
          status: "queued",
          writerLease: false,
          limits: limits[index],
          toolCalls: 0,
          profile: input.profile.name,
          tools: [...input.profile.tools],
          leafTools: [...(input.profile.leafTools ?? [])],
          skills: [...input.profile.skills],
          capabilityDenials: input.capabilityDenials,
          cwd: selection.cwd,
          outcome: validators[index]
            ? { validation: "awaiting", attempts: 0, errors: [], finalized: false }
            : undefined,
          assignment: input.assignment,
          activity: "Queued for capacity / writer admission",
          progress: "",
          result: "",
          disposed: false,
          model: { provider: selection.model!.provider, id: selection.model!.id },
          effort: selection.thinkingLevel ?? null,
          prewalk: input.profile.prewalk
            ? {
                target: input.profile.prewalk,
                status: input.model
                  ? "suppressed-exact"
                  : sameSelection(input.profile.prewalk, {
                        provider: selection.model!.provider,
                        id: selection.model!.id,
                        effort: selection.thinkingLevel!,
                      })
                    ? "no-op"
                    : "armed",
              }
            : undefined,
          telemetry: { requests: null, tokens: null, cost: null, context: null },
        },
      };
      return entry;
    });
    for (const [parent, count] of parents) parent.spawned += count;
    if (previous)
      this.history.set(this.key(previous.state), {
        state: structuredClone(previous.state),
        messages: previous.finalizedMessages ?? [],
      });
    for (const entry of entries) {
      this.entries.set(entry.state.id, entry);
      this.queue.add(entry);
      this.presence.set(entry.state.id, "active");
    }
    for (const entry of entries) {
      entry.timer = setTimeout(() => {
        this.limit(entry, "deadline");
      }, entry.state.limits.deadlineMs);
    }
    for (const entry of entries) if (!entry.state.disposed) this.update(entry, {});
    this.pump();
    return entries.map((entry) => ({ id: entry.state.id, generation: entry.state.generation }));
  }
  async start(input: StartTask): Promise<ChildRef> {
    const [ref] = this.admit([input]);
    await this.entry(ref).setup;
    return ref;
  }
  renewalParent(ref: ChildRef): ChildRef | undefined {
    const parent = this.entry(ref).input.parent;
    if (parent) {
      const entry = this.entry(parent);
      if (entry.cancelled || entry.state.disposed || entry.state.status !== "running")
        throw new Error("Original parent generation is no longer active");
    }
    return parent && { id: parent.id, generation: parent.generation };
  }
  renew(ref: ChildRef, input: StartTask): ChildRef {
    const previous = this.entry(ref);
    this.renewalParent(ref);
    const profile = intersectProfileGrants(input.profile, previous.input.profile);
    const retained =
      previous.state.prewalk && ["handed-off", "no-op"].includes(previous.state.prewalk.status)
        ? previous.state.prewalk.target
        : previous.input.model;
    const next = this.admit(
      [
        {
          ...input,
          model: retained ?? input.model,
          profile,
          skills: input.skills.filter((skill) => profile.skills.includes(skill.filePath)),
          resultSchema:
            input.resultSchema === undefined ? previous.input.resultSchema : input.resultSchema,
          limits: narrowLimits(previous.state.limits, input.limits ?? {}),
        },
      ],
      ref,
    )[0];
    if (previous.state.prewalk && previous.state.prewalk.status !== "armed")
      this.update(this.entry(next), { prewalk: previous.state.prewalk });
    return next;
  }
  private pump(): void {
    if (this.closing) return;
    for (const entry of this.queue) {
      if (entry.cancelled || entry.state.disposed || entry.state.status !== "queued") continue;
      if (this.active().length >= this.policy.concurrency) break;
      const writer = isWriter(entry.input.profile);
      if (writer && (this.writer || this.parentMutations.size)) break; // strict FIFO
      this.queue.delete(entry);
      if (writer) this.writer = entry.state.id;
      entry.state = {
        ...entry.state,
        status: "setup",
        writerLease: writer,
        activity: "Preparing SDK child",
      };
      entry.setup = this.create(entry, entry.input, entry.selection);
      this.update(entry, {});
      void entry.setup.catch(() => {});
    }
  }
  private limit(entry: Entry, reason: string): void {
    if (
      entry.cancelled ||
      entry.state.disposed ||
      entry.state.limitReason ||
      ["settled", "failed", "cancelled"].includes(entry.state.status)
    )
      return;
    this.update(entry, { limitReason: reason, error: `Execution limit: ${reason}` });
    void this.stop(entry.state);
  }
  private async create(entry: Entry, input: StartTask, selection: ChildSelection): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true });
      const taskDir = join(
        this.root,
        entry.state.generation === 1
          ? entry.state.id
          : `${entry.state.id}-g${entry.state.generation}`,
      );
      await mkdir(taskDir); // exclusive ownership: never reuse an existing task record
      const agentDir = join(taskDir, "agent");
      await mkdir(agentDir);
      const target =
        entry.state.prewalk?.status === "armed"
          ? validateModelSelection(input.context, entry.state.prewalk.target)
          : undefined;
      let policyError: string | undefined;
      const effective = (): ModelSelection => ({
        ...entry.state.model,
        effort: entry.state.effort as ModelSelection["effort"],
      });
      const revalidate = async (selected: ModelSelection, requirePrewalk: boolean) => {
        let current: Entry | undefined = entry;
        while (current) {
          const policy = (
            await resolveProfile(
              current.input.profile.name,
              input.context.cwd,
              input.context.isProjectTrusted(),
              undefined,
              current.input.availableSkills?.() ?? current.input.skills,
            )
          ).profile;
          if (
            (current.input.profile.models !== undefined && policy.models === undefined) ||
            !allowsModel(policy, selected) ||
            !admittedModel(current, selected)
          )
            throw new Error("Current or admitted model policy denied selection");
          if (
            current === entry &&
            requirePrewalk &&
            (!policy.prewalk || !sameSelection(policy.prewalk, entry.state.prewalk!.target))
          )
            throw new Error("Current prewalk grant revoked");
          current = current.input.parent ? this.entry(current.input.parent) : undefined;
        }
        validateModelSelection(input.context, selected);
      };
      const runtime = await parentModelRuntime(
        selection,
        agentDir,
        () => {
          if (policyError) throw new Error(policyError);
          validateModelSelection(input.context, effective());
          if (entry.cancelled || this.closing) throw new Error("Delegation cancelled");
          if ((entry.state.telemetry.requests ?? 0) >= entry.state.limits.requests) {
            this.limit(entry, "requests");
            throw new Error("Direct request limit");
          }
          this.update(entry, {
            telemetry: {
              ...entry.state.telemetry,
              requests: (entry.state.telemetry.requests ?? 0) + 1,
            },
          });
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
          (pi) => {
            pi.on("turn_start", async () => {
              try {
                await revalidate(effective(), entry.state.prewalk?.status === "armed");
              } catch (error) {
                policyError = String(error);
              }
            });
            pi.on("turn_end", async (event) => {
              if (
                !entry.cancelled &&
                !this.closing &&
                entry.state.prewalk?.status === "armed" &&
                event.toolResults.some(
                  (result) =>
                    (result.toolName === "edit" || result.toolName === "write") &&
                    input.profile.tools.includes(result.toolName),
                )
              ) {
                try {
                  const next = entry.state.prewalk.target;
                  await revalidate(next, true);
                  if (entry.cancelled || this.closing) return;
                  await entry.session!.setModel(target!);
                  entry.session!.setThinkingLevel(next.effort);
                  if (entry.session!.thinkingLevel !== next.effort)
                    throw new Error("SDK coerced prewalk effort");
                  this.update(entry, {
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
            if (entry.cancelled || this.closing) throw new Error("Delegation cancelled");
            if (!input.context.tools.some((tool) => tool.name === name))
              throw new Error(`Admitted parent tool is no longer callable: ${name}`);
            const builtin = input.profile.tools.includes(name as BuiltinTool);
            // Re-read configuration for this generation and every ancestor before dispatch.
            let current: Entry | undefined = entry;
            while (current) {
              const { profile } = await resolveProfile(
                current.input.profile.name,
                input.context.cwd,
                input.context.isProjectTrusted(),
                undefined,
                current.input.availableSkills?.() ?? current.input.skills,
              );
              if (
                builtin
                  ? !profile.tools.includes(name as BuiltinTool)
                  : !profile.leafTools?.includes(name)
              )
                throw new Error(`Current capability grant revoked: ${name}`);
              current = current.input.parent ? this.entry(current.input.parent) : undefined;
            }
            if (entry.cancelled || this.closing) throw new Error("Delegation cancelled");
            if (builtin) input.assertTools([name]);
            else {
              const metadata = input.toolMetadata?.().find((tool) => tool.name === name);
              if (
                !metadata ||
                leafDenial(
                  metadata,
                  input.profile.leafTools ?? [],
                  selection.cwd === resolveWorkspace(undefined, input.context.cwd),
                ) ||
                toolProvenance(metadata) !== input.leafProvenance?.[name]
              )
                throw new Error(`Leaf capability revoked or reclassified: ${name}`);
            }
            if (!input.context.tools.some((tool) => tool.name === name))
              throw new Error(`Admitted parent tool is no longer callable: ${name}`);
            // The public parent dispatcher preserves validation and permission hooks. Do not
            // call a raw create*Tool.execute here: that would bypass operator policy.
            const outcome = await input.context.executeTool(
              name,
              builtin
                ? workspaceArguments(name as BuiltinTool, args, selection.cwd, input.context.cwd)
                : args,
              { signal, onUpdate },
            );
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
              this.closing ||
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
              this.update(entry, {
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
            this.update(entry, {
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
      if (input.profile.spawn?.length && input.nestedTool)
        tools.push(input.nestedTool(entry.state));
      for (const tool of tools) {
        const execute = tool.execute;
        tool.execute = async (...args) => {
          if (entry.cancelled || this.closing) throw new Error("Delegation cancelled");
          if (entry.state.toolCalls >= entry.state.limits.tools) {
            this.limit(entry, "tools");
            throw new Error("Tool call limit");
          }
          this.update(entry, { toolCalls: entry.state.toolCalls + 1 });
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
        tools: tools.map((tool) => tool.name),
        customTools: tools,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false },
        }),
        sessionManager: SessionManager.create(selection.cwd, join(taskDir, "transcripts")),
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
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      entry.unsubscribe = session.subscribe((event) => {
        const patch: { -readonly [K in keyof ChildSnapshot]?: ChildSnapshot[K] } = {};
        if (event.type === "agent_start") {
          patch.status = entry.cancelled ? "draining" : "running";
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
          for (const message of this.coordinationMessages)
            if (
              message.recipient !== "root" &&
              this.key(message.recipient) === this.key(entry.state) &&
              text ===
                `Delegation message ${message.id} from ${message.sender === "root" ? "root" : this.key(message.sender)}: ${message.text}`
            )
              message.status = "delivered";
          this.notifyCoordination();
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
        this.update(entry, patch, event);
      });
      this.update(entry, { transcript: session.sessionFile });
      if (this.closing || entry.cancelled) {
        this.update(entry, { status: "cancelled" });
        this.dispose(entry);
        return;
      }
      entry.run = session
        .prompt(input.assignment, { expandPromptTemplates: false })
        .then(async () => {
          await this.stopMany(this.children(entry).map((child) => child.state));
          const last = session.messages.filter((message) => message.role === "assistant").at(-1);
          const failed = !last || last.stopReason === "error";
          const stats = session.getSessionStats();
          this.update(entry, { status: "draining", activity: "Finalizing outcome artifacts" });
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
          this.update(entry, {
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
          await this.stopMany(this.children(entry).map((child) => child.state));
          this.update(entry, {
            status: entry.cancelled ? "cancelled" : "failed",
            error: entry.state.limitReason ? entry.state.error : String(error),
          });
        })
        .finally(() => this.dispose(entry));
      // prompt preparation precedes abort-signal ownership; acknowledge only abortable work.
      await Promise.race([started, entry.run]);
    } catch (error) {
      this.update(entry, {
        status: entry.cancelled || this.closing ? "cancelled" : "failed",
        error: String(error),
      });
      this.dispose(entry);
      throw error;
    }
  }
  private closeDescendantPresence(entry: Entry): void {
    for (const child of this.entries.values())
      if (
        child.state.parentId === entry.state.id &&
        child.state.parentGeneration === entry.state.generation
      ) {
        this.presence.set(child.state.id, "stopped");
        this.closeDescendantPresence(child);
      }
  }
  private dispose(entry: Entry): void {
    if (entry.state.disposed) return;
    this.queue.delete(entry);
    clearTimeout(entry.timer);
    entry.finalizedMessages = structuredClone(entry.session?.messages ?? []);
    entry.unsubscribe?.();
    entry.session?.dispose();
    // Retain immutable evidence, not the disposed SDK session graph, while idle/parked.
    entry.unsubscribe = undefined;
    entry.session = undefined;
    if (this.writer === entry.state.id) this.writer = undefined;
    this.closeDescendantPresence(entry);
    this.presence.set(entry.state.id, entry.cancelled || this.closing ? "stopped" : "idle");
    this.update(entry, {
      disposed: true,
      endedAt: Date.now(),
      writerLease: false,
      outcome: entry.state.outcome ? { ...entry.state.outcome, finalized: true } : undefined,
    });
    entry.finish();
    this.pump();
  }
  private key(ref?: ChildRef): string {
    return ref ? `${ref.id}/${ref.generation}` : "root";
  }
  private actor(ref: ChildRef | undefined, action: CoordinationAction): Entry | undefined {
    if (this.closing) throw new Error("Parent shut down");
    if (!ref) return;
    const actor = this.entry(ref);
    if (actor.cancelled || actor.state.disposed || actor.state.status !== "running")
      throw new Error("Sender is no longer running");
    if (!actor.input.profile.coordination?.includes(action))
      throw new Error(`Coordination action denied: ${action}`);
    return actor;
  }
  private target(actor: Entry | undefined, ref: ChildRef): Entry {
    const target = this.entry(ref);
    // A selected action grants family addressing, never transcript/resource access.
    if (
      actor &&
      target !== actor &&
      !(
        target.state.parentId === actor.state.id &&
        target.state.parentGeneration === actor.state.generation
      ) &&
      !(
        actor.state.parentId === target.state.id &&
        actor.state.parentGeneration === target.state.generation
      ) &&
      !(
        actor.state.parentId === target.state.parentId &&
        actor.state.parentGeneration === target.state.parentGeneration
      )
    )
      throw new Error("Coordination target outside granted family");
    return target;
  }
  inbox(actor?: ChildRef): DelegationMessage[] {
    this.actor(actor, "inbox");
    return this.takeInbox(actor);
  }
  async message(
    actor: ChildRef | undefined,
    target: ChildRef | undefined,
    text: string,
    mode: "inbox" | "steer" | "followUp" = "inbox",
  ): Promise<DelegationMessage> {
    const sender = this.actor(actor, "message");
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > MAX_MESSAGE_BYTES)
      throw new Error("Message requires 1–4096 UTF-8 bytes");
    if (!target && !sender) throw new Error("Root cannot message itself");
    const recipient = target ? this.target(sender, target) : undefined;
    if (!target && sender?.state.parentId !== this.parentId)
      throw new Error("Only direct children may message root");
    if (target && actor && this.key(target) === this.key(actor))
      throw new Error("Self messaging denied");
    const record: DelegationMessage = {
      id: randomUUID(),
      sender: actor ? { ...actor } : "root",
      recipient: target ? { ...target } : "root",
      text,
      mode,
      status: "accepted",
    };
    if (
      recipient &&
      (recipient.cancelled || recipient.state.disposed || recipient.state.status !== "running")
    )
      return { ...record, status: "not-running" };
    if (!target && mode !== "inbox") throw new Error("Root accepts inbox messages only");
    const key = this.key(target);
    const mailbox = this.mailboxes.get(key) ?? [];
    if (
      mailbox.length >= MAX_MAILBOX_MESSAGES ||
      this.coordinationMessages.length >= MAX_RETAINED_MESSAGES
    )
      throw new Error("Parent message retention/mailbox limit");
    this.coordinationMessages.push(record);
    mailbox.push(record);
    this.mailboxes.set(key, mailbox);
    this.notifyCoordination();
    if (mode !== "inbox") {
      try {
        const content = `Delegation message ${record.id} from ${this.key(actor)}: ${text}`;
        const disposition = await recipient!.session![mode](content);
        // The captured recipient/session is never looked up again by ID.
        if (record.status !== "delivered")
          record.status = disposition === "queued" ? "queued" : "handled";
      } catch (error) {
        record.status = "error";
        record.error = String(error);
      }
      this.notifyCoordination();
    }
    return structuredClone(record);
  }
  park(ref: ChildRef): void {
    if (this.closing) throw new Error("Parent shut down");
    const entry = this.entry(ref);
    this.renewalParent(ref);
    if (!entry.state.disposed || this.presence.get(ref.id) !== "idle")
      throw new Error("Park requires a disposed idle assignment; stop active work explicitly");
    this.presence.set(ref.id, "parked");
    this.update(entry, {});
  }
  async coordinateWait(
    actor: ChildRef | undefined,
    target: ChildRef | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
    messageId?: string,
  ): Promise<CoordinationWait> {
    const sender = this.actor(actor, "wait");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_MS)
      throw new Error("Wait timeout must be 1–60000ms");
    if (this.waiterCount >= MAX_WAITERS) throw new Error("Parent waiter limit");
    if (target && messageId) throw new Error("Wait selects either an outcome or message receipt");
    const receipt = messageId
      ? this.coordinationMessages.find((message) => message.id === messageId)
      : undefined;
    if (
      messageId &&
      (!receipt ||
        (this.key(receipt.sender === "root" ? undefined : receipt.sender) !== this.key(actor) &&
          this.key(receipt.recipient === "root" ? undefined : receipt.recipient) !==
            this.key(actor)))
    )
      throw new Error("Unknown or foreign message receipt");
    const destination = target ? this.target(sender, target) : undefined;
    const pendingReceipt =
      receipt && !["delivered", "handled", "error", "not-running"].includes(receipt.status);
    if (sender && pendingReceipt && receipt.recipient === "root")
      throw new Error("Waiting for a pending root receipt with a retained permit is unsupported");
    const recipientRef = receipt?.recipient === "root" ? undefined : receipt?.recipient;
    const receiptEntry = recipientRef ? this.entries.get(recipientRef.id) : undefined;
    const dependency =
      destination ??
      (pendingReceipt && receiptEntry?.state.generation === recipientRef?.generation
        ? receiptEntry
        : undefined);
    const sourceKey = this.key(actor),
      targetKey = dependency ? this.key(dependency.state) : this.key(target);
    if (sender && dependency) {
      if (sender === dependency) throw new Error("Self wait denied");
      let ancestor: Entry | undefined = sender;
      while (ancestor) {
        if (ancestor === dependency) throw new Error("Ancestor wait would deadlock");
        ancestor = this.entries.get(ancestor.state.parentId);
      }
      if (dependency.state.status === "queued")
        throw new Error("Wait on queued work with retained permit is unsupported");
      const reaches = (key: string, seen = new Set<string>()): boolean => {
        if (key === sourceKey) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        const children = [...this.entries.values()]
          .filter(
            (entry) =>
              !entry.state.disposed &&
              entry.state.parentGeneration !== undefined &&
              `${entry.state.parentId}/${entry.state.parentGeneration}` === key,
          )
          .map((entry) => this.key(entry.state));
        return [...(this.waits.get(key) ?? []), ...children].some((next) => reaches(next, seen));
      };
      if (reaches(targetKey)) throw new Error("Coordination wait cycle");
    }
    const edges = this.waits.get(sourceKey) ?? new Set<string>();
    if (dependency && edges.has(targetKey)) throw new Error("Duplicate active wait");
    if (dependency) {
      edges.add(targetKey);
      this.waits.set(sourceKey, edges);
    }
    this.waiterCount++;
    return new Promise<CoordinationWait>((resolve) => {
      let finished = false;
      const finish = (value: CoordinationWait) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.coordinationListeners.delete(check);
        signal?.removeEventListener("abort", abort);
        if (dependency) {
          edges.delete(targetKey);
          if (!edges.size) this.waits.delete(sourceKey);
        }
        this.waiterCount--;
        resolve(value);
      };
      const check = () => {
        if (this.closing) return finish({ status: "shutdown" });
        if (
          sender &&
          (sender.cancelled ||
            sender.state.disposed ||
            this.entries.get(sender.state.id) !== sender)
        )
          return finish({ status: "cancelled" });
        if (receipt) {
          if (["delivered", "handled", "error", "not-running"].includes(receipt.status))
            return finish({ status: "message", message: structuredClone(receipt) });
          if (receipt.recipient !== "root") {
            const recipient = this.entries.get(receipt.recipient.id);
            if (
              !recipient ||
              recipient.state.generation !== receipt.recipient.generation ||
              recipient.state.disposed ||
              recipient.cancelled
            )
              return finish({
                status: "message",
                message: { ...structuredClone(receipt), status: "not-running" },
              });
          }
        } else if (destination) {
          if (destination.state.disposed)
            return finish({
              status: "outcome",
              outcome: {
                id: destination.state.id,
                generation: destination.state.generation,
                status: destination.state.status,
                limitReason: destination.state.limitReason,
              },
            });
        } else if ((this.mailboxes.get(sourceKey)?.length ?? 0) > 0)
          return finish({ status: "messages", messages: this.takeInbox(actor) });
      };
      const abort = () => finish({ status: "cancelled" });
      const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
      this.coordinationListeners.add(check);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else check();
    });
  }
  private takeInbox(actor?: ChildRef): DelegationMessage[] {
    const key = this.key(actor),
      messages = this.mailboxes.get(key) ?? [];
    this.mailboxes.delete(key);
    for (const message of messages) if (message.mode === "inbox") message.status = "delivered";
    this.notifyCoordination();
    return structuredClone(messages);
  }
  taskInputRead(ref: ChildRef): void {
    const entry = this.entry(ref);
    if (
      entry.cancelled ||
      entry.state.disposed ||
      this.closing ||
      !entry.input.profile.tools.includes("read")
    )
      throw new Error("Delegating parent has no active read grant");
    if (entry.state.toolCalls >= entry.state.limits.tools) {
      this.limit(entry, "tools");
      throw new Error("Tool call limit");
    }
    this.update(entry, { toolCalls: entry.state.toolCalls + 1 });
  }
  async steer(ref: ChildRef, text: string): Promise<"queued" | "handled"> {
    const entry = this.entry(ref);
    if (!text.trim()) throw new Error("Nonempty steering text is required");
    if (entry.state.status !== "running" || entry.cancelled) throw new Error("No running child");
    return entry.session!.steer(text);
  }
  private children(entry: Entry): Entry[] {
    return [...this.entries.values()].filter(
      (child) =>
        child.state.parentId === entry.state.id &&
        child.state.parentGeneration === entry.state.generation &&
        !child.state.disposed,
    );
  }
  async stopMany(refs: readonly ChildRef[]): Promise<void> {
    const entries = refs.map((ref) => this.entry(ref));
    // Mark the whole cancellation set before any disposal can dequeue a sibling.
    for (const entry of entries) if (!entry.state.disposed) entry.cancelled = true;
    await Promise.all(entries.map((entry) => this.stop(entry.state)));
  }
  async stop(ref: ChildRef): Promise<void> {
    const entry = this.entry(ref);
    this.presence.set(entry.state.id, "stopped");
    this.closeDescendantPresence(entry);
    this.notifyCoordination();
    if (entry.state.disposed) return;
    entry.cancelled = true;
    if (entry.state.status === "queued") {
      this.update(entry, { status: "cancelled", activity: "Cancelled before setup" });
      this.dispose(entry);
      return;
    }
    this.update(entry, { status: "draining", activity: "Cancelling and draining" });
    // Start subtree cancellation without waiting for tools queued behind this session.
    const descendants = this.stopMany(this.children(entry).map((child) => child.state));
    await entry.setup?.catch(() => {});
    await Promise.all([descendants, entry.state.disposed ? undefined : entry.session?.abort()]);
    if (entry.state.disposed) return;
    await entry.run;
    this.dispose(entry);
  }
  async wait(ref: ChildRef): Promise<ChildSnapshot> {
    const entry = this.entry(ref);
    await entry.done;
    return structuredClone(entry.state);
  }
  /** Detached public SDK transcript for one admitted generation; no replay or arbitrary file access. */
  messages(ref: ChildRef): AgentSession["messages"] {
    const historical = this.history.get(this.key(ref));
    if (historical) return structuredClone(historical.messages);
    const entry = this.entry(ref);
    return structuredClone(entry.session?.messages ?? entry.finalizedMessages ?? []);
  }
  reopenTranscript(ref: ChildRef) {
    const path = this.snapshot(ref)?.transcript;
    if (!path) throw new Error("No transcript yet");
    return SessionManager.open(path).buildSessionContext();
  }
  shutdown(): Promise<void> {
    this.closing = true;
    this.notifyCoordination();
    this.shutdownPromise ??= (async () => {
      await Promise.all(this.list().map((ref) => this.stop(ref)));
      this.listeners.clear();
    })();
    return this.shutdownPromise;
  }
}
