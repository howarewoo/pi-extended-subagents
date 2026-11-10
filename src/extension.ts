import { clippedText } from "./outcomes.ts";
import { readTaskInput } from "./task-input.ts";
import { join } from "node:path";
import { Type } from "typebox";
import { truncateHead, type ExtensionToolContext, type ToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveScheduling } from "./scheduling.ts";
import { DelegationCoordinator, type ChildRef, type ChildSnapshot, type StartTask } from "./coordinator.ts";
import { READ_TOOLS, resolveProfile, bundledProfiles } from "./profiles.ts";
import { createChildWidget, createHub } from "./hub.ts";

export default function delegation(pi: ExtensionAPI) {
  let coordinator: DelegationCoordinator;
  let closing = false;
  let renderWidget: (() => void) | undefined;
  let unsubscribeWidget: (() => void) | undefined;
  const ref = (args: string): ChildRef => {
    const [id, generation] = args.trim().split(/\s+/);
    if (!id || !Number.isSafeInteger(Number(generation))) throw new Error("Expected <task-id> <generation>");
    return { id, generation: Number(generation) };
  };
  const preview = (value: unknown, transcript?: string) => {
    const snapshots = (Array.isArray(value) ? value : [value]).filter((item): item is ChildSnapshot => !!item && typeof item === "object" && "id" in item && "generation" in item && "status" in item);
    const references = snapshots.map(state => ({ id: state.id, generation: state.generation, status: state.status,
      transcript: state.transcript, artifacts: state.artifacts }));
    const text = JSON.stringify(value, (key, item) => {
      if (["result", "assignment", "activity", "progress", "error"].includes(key) && typeof item === "string") return clippedText(item);
      if (key === "value") return clippedText(JSON.stringify(item));
      return item;
    }, 2);
    const clipped = truncateHead((references.length ? `References: ${JSON.stringify(references)}\n` : transcript ? `Transcript: ${transcript}\n` : "") + text);
    return `${clipped.content}${clipped.truncated ? "\n[Preview truncated; inspect full artifact/transcript references or task-status for one identity]" : ""}`;
  };
  const show = (value: unknown, transcript?: string) => pi.sendMessage({ customType: "delegation", content: preview(value, transcript), display: true });
  pi.on("session_start", (_event, ctx) => {
    coordinator = new DelegationCoordinator(join(ctx.sessionManager.getSessionDir(), "delegation", ctx.sessionManager.getSessionId()), ctx.sessionManager.getSessionId());
    unsubscribeWidget = coordinator.subscribe(event => { renderWidget?.(); pi.events.emit("delegation:registry", event); });
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("delegation", (tui, theme) => {
      renderWidget = () => tui.requestRender();
      return createChildWidget(() => coordinator.snapshot(), theme);
    }, { placement: "aboveEditor" });
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    closing = true;
    renderWidget = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget("delegation", undefined);
    await coordinator?.shutdown();
    unsubscribeWidget?.();
  });
  pi.on("tool_call", event => {
    try {
      const builtinRead = READ_TOOLS.includes(event.toolName as typeof READ_TOOLS[number]) && pi.getAllTools().some(tool => tool.name === event.toolName && tool.sourceInfo.path === `builtin:${event.toolName}`);
      coordinator.parentToolStart(event.toolCallId, event.toolName, builtinRead);
    }
    catch (error) { return { block: true, reason: String(error) }; }
  });
  pi.on("tool_execution_end", event => coordinator.parentToolEnd(event.toolCallId));
  const assertTools = (names: readonly string[]) => {
    for (const name of names) {
      const tool = pi.getAllTools().find(tool => tool.name === name);
      if (!tool || tool.sourceInfo.path !== `builtin:${name}`) throw new Error(`Delegation requires an unmodified built-in parent tool: ${name}`);
    }
  };
  const role = Type.Union([Type.Literal("general"), Type.Literal("scout"), Type.Literal("review"), Type.Literal("implementation")]);
  const limits = Type.Object({ depth: Type.Optional(Type.Integer({ minimum: 0 })), spawns: Type.Optional(Type.Integer({ minimum: 0 })), deadlineMs: Type.Optional(Type.Integer({ minimum: 1 })), requests: Type.Optional(Type.Integer({ minimum: 1 })), tools: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false });
  const assignment = { assignment: Type.Optional(Type.String({ minLength: 1 })), taskFile: Type.Optional(Type.String({ minLength: 1 })), resultSchema: Type.Optional(Type.Unknown()), profile: role, spawn: Type.Optional(Type.Array(role)), limits: Type.Optional(limits) };
  const item = Type.Object(assignment, { additionalProperties: false });
  const parameters = Type.Union([
    Type.Object({ ...assignment, background: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    Type.Object({ tasks: Type.Array(item, { minItems: 1, maxItems: 64 }), background: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  ]);
  const taskTool = (parent?: ChildRef, rootContext?: ExtensionToolContext, rootCallerId?: string): ToolDefinition<typeof parameters> => ({
    name: "delegate_task", label: "Delegate task", exposure: "model-only",
    description: "Delegate one assignment or a fully preflighted ordered tasks batch on the selected parent model. Bounded FIFO capacity; implementation writers serialize. Manual !/!! and external edits are uncoordinated: never conflict with child writes. Foreground waits; background delivers one final batch message. Nested foreground only, explicit spawn grants and available capacity required. Limits may only narrow operator policy. Supply exactly one inline assignment or taskFile (explicit non-hidden workspace-relative UTF-8 file, at most 50000 bytes, checked through parent read hooks). Optional resultSchema requires child submit_result; prose is never validated output. Previews are bounded; full result artifacts and transcripts retained after drain.",
    parameters,
    async execute(callerId, args, signal, onUpdate, localContext) {
      const ctx = rootContext ?? localContext;
      const owner = coordinator;
      if (parent && args.background) throw new Error("Nested background delegation is unsupported; use foreground");
      const policy = await resolveScheduling(ctx.cwd, ctx.isProjectTrusted());
      owner.configure(policy);
      const items = "tasks" in args ? args.tasks : [args];
      const inputs: StartTask[] = [];
      for (const task of items) {
        if ((task.assignment === undefined) === (task.taskFile === undefined)) throw new Error("Supply exactly one of assignment or taskFile");
        let { profile, skills } = await resolveProfile(task.profile, ctx.cwd, ctx.isProjectTrusted());
        if (task.spawn) {
          if (task.spawn.some(role => !profile.spawn?.includes(role))) throw new Error("Request cannot mint spawn grants");
          profile = { ...profile, spawn: task.spawn };
        }
        assertTools(profile.tools);
        let text = task.assignment;
        if (task.taskFile !== undefined) {
          assertTools(["read"]);
          text = await readTaskInput(task.taskFile, ctx, signal, parent ? () => owner.taskInputRead(parent) : undefined);
        }
        inputs.push({ assignment: text!, resultSchema: task.resultSchema, profile, skills, context: ctx, callerId: rootCallerId ?? callerId, parent, limits: task.limits,
          nestedTool: (ref: ChildRef) => taskTool(ref, ctx, rootCallerId ?? callerId) });
      }
      signal?.throwIfAborted();
      const children = owner.admit(inputs);
      const stop = () => owner.stopMany(children);
      const abort = () => { void stop(); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) await stop();
      const states = () => children.map(child => owner.snapshot(child)!);
      const result = (snapshots: ChildSnapshot[]) => {
        const value = "tasks" in args ? snapshots : snapshots[0];
        return { content: [{ type: "text" as const, text: preview(value, snapshots.length === 1 ? snapshots[0].transcript : undefined) }],
          details: "tasks" in args ? { children: snapshots } : snapshots[0],
          isError: snapshots.some(state => state.status === "failed" || state.status === "cancelled") };
      };
      const completed = Promise.all(children.map(child => owner.wait(child)));
      if (args.background) {
        signal?.removeEventListener("abort", abort);
        void completed.then(snapshots => { if (!closing && coordinator === owner) show("tasks" in args ? snapshots : snapshots[0], snapshots.length === 1 ? snapshots[0].transcript : undefined); });
        return result(states());
      }
      const unsubscribe = owner.subscribe(event => { if (children.some(child => child.id === event.child.id)) onUpdate?.(result(states())); });
      try { return result(await completed); }
      finally { unsubscribe(); signal?.removeEventListener("abort", abort); }
    },
  });
  pi.registerTool(taskTool());
  pi.registerCommand("task-profiles", { description: "List bundled profiles and capability availability", handler: async () => show(bundledProfiles()) });
  pi.registerCommand("task-status", { description: "List delegation identities, states and final results", handler: async args => show(args.trim() ? coordinator.snapshot(ref(args)) : coordinator.list()) });
  pi.registerCommand("task-stop", { description: "Stop <task-id> <generation> and drain it", handler: async args => { await coordinator.stop(ref(args)); } });
  pi.registerCommand("task-steer", { description: "Steer <task-id> <generation> <text>", handler: async args => {
    const [id, generation, ...text] = args.trim().split(/\s+/);
    await coordinator.steer(ref(`${id} ${generation}`), text.join(" "));
  } });
  pi.registerCommand("task-hub", { description: "Observe the latest registry entry (TUI only)", handler: async (_args, ctx) => {
    if (ctx.mode !== "tui") return;
    await ctx.ui.custom<void>((tui, theme, keys, done) => createHub(coordinator, theme, keys, () => tui.requestRender(), () => done(),
      () => Math.max(1, Math.floor(tui.terminal.rows * 0.9))), { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center" } });
  } });
}
