import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { EFFORTS, sameSelection } from "./model-policy.ts";
import { clippedText } from "./outcomes.ts";
import { readTaskInput } from "./task-input.ts";
import { join } from "node:path";
import { Type } from "typebox";
import { truncateHead, type ExtensionToolContext, type ToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveScheduling } from "./scheduling.ts";
import { DelegationCoordinator, type ChildRef, type ChildSnapshot, type StartTask } from "./coordinator.ts";
import { READ_TOOLS, resolveProfile, bundledProfiles, COORDINATION_ACTIONS, intersectProfileGrants } from "./profiles.ts";
import { createChildWidget, createHub, safe, taskCard } from "./hub.ts";

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
      return createChildWidget(() => coordinator.list(), theme, () => tui.terminal.rows);
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
  const modelSelection = Type.Object({ provider: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }), effort: Type.Union(EFFORTS.map(level => Type.Literal(level))) }, { additionalProperties: false });
  const assignment = { models: Type.Optional(Type.Array(modelSelection, { maxItems: 64 })), model: Type.Optional(modelSelection), assignment: Type.Optional(Type.String({ minLength: 1 })), taskFile: Type.Optional(Type.String({ minLength: 1 })), resultSchema: Type.Optional(Type.Unknown()), profile: role, spawn: Type.Optional(Type.Array(role)), coordination: Type.Optional(Type.Array(Type.Union(COORDINATION_ACTIONS.map(action => Type.Literal(action))))), limits: Type.Optional(limits) };
  const item = Type.Object(assignment, { additionalProperties: false });
  const parameters = Type.Union([
    Type.Object({ ...assignment, background: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    Type.Object({ tasks: Type.Array(item, { minItems: 1, maxItems: 64 }), background: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  ]);
  const taskTool = (parent?: ChildRef, rootContext?: ExtensionToolContext, rootCallerId?: string): ToolDefinition<typeof parameters> => ({
    name: "delegate_task", label: "Delegate task", exposure: "model-only",
    description: "Delegate one assignment or a fully preflighted ordered tasks batch on the selected parent model by default. Optional exact model {provider,id,effort} requires an operator profile models grant and stays exact, suppressing inherited role prewalk; models may only narrow that grant list. No aliases/fallback/coercion. Configured role-default prewalk switches once after first edit/write, not a repository scan. Advisor/probes/speculation/workers/history/executable resource inheritance remain unavailable. Bounded FIFO capacity; implementation writers serialize. Manual !/!! and external edits are uncoordinated: never conflict with child writes. Foreground waits; background delivers one final batch message. Nested foreground only, explicit spawn grants and available capacity required. Limits may only narrow operator policy. Supply exactly one inline assignment or taskFile (explicit non-hidden workspace-relative UTF-8 file, at most 50000 bytes, checked through parent read hooks). Optional resultSchema requires child submit_result; prose is never validated output. Previews are bounded; full result artifacts and transcripts retained after drain.",
    parameters,
    renderCall(args, theme) {
      return { render: width => [theme.fg("toolTitle", `Delegate · ${"tasks" in args ? `batch ${args.tasks?.length ?? 0}` : safe(args.profile ?? "profile pending")} · ${args.background ? "background" : "foreground"}`),
        safe("tasks" in args ? "Ordered batch · expand results for each identity" : args.assignment ?? args.taskFile ?? "Receiving assignment…").replaceAll("\n", " ")].map(line => truncateToWidth(line, Math.max(0, width))), invalidate() {} };
    },
    renderResult(result, options, theme) {
      const stored = result.details as ChildSnapshot | { children: ChildSnapshot[] } | undefined;
      const children = stored && "children" in stored ? stored.children : stored && "id" in stored ? [stored] : [];
      return { render(width) {
        const lines = children.length ? children.flatMap(snapshot => {
          let child = snapshot;
          try { child = coordinator?.snapshot(snapshot) ?? snapshot; } catch { /* delivered snapshots survive runtime replacement */ }
          return taskCard(child, options.expanded);
        }) : [safe(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"))];
        return new Text(lines.map(line => theme.fg("text", line)).join("\n"), 0, 0).render(width);
      }, invalidate() {} };
    },
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
        if (task.coordination) {
          if (task.coordination.some(action => !profile.coordination?.includes(action))) throw new Error("Request cannot mint coordination grants");
          profile = { ...profile, coordination: task.coordination };
        }
        if (task.models) {
          if (task.models.some(selection => !profile.models?.some(grant => sameSelection(grant, selection)))) throw new Error("Request cannot mint model grants");
          profile = { ...profile, models: task.models };
        }
        assertTools(profile.tools);
        let text = task.assignment;
        if (task.taskFile !== undefined) {
          assertTools(["read"]);
          text = await readTaskInput(task.taskFile, ctx, signal, parent ? () => owner.taskInputRead(parent) : undefined);
        }
        inputs.push({ model: task.model, assignment: text!, resultSchema: task.resultSchema, profile, skills, context: ctx, callerId: rootCallerId ?? callerId, parent, limits: task.limits,
          coordinationTools: actor => [coordinationTool(owner, actor)],
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
  const identity = Type.Object({ id: Type.String({ minLength: 1 }), generation: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
  const coordinationParameters = Type.Union([
    Type.Object({ action: Type.Literal("message"), target: Type.Optional(identity), text: Type.String({ minLength: 1, maxLength: 4096 }), mode: Type.Optional(Type.Union([Type.Literal("inbox"), Type.Literal("steer"), Type.Literal("followUp")])) }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("inbox") }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("wait"), target: Type.Optional(identity), messageId: Type.Optional(Type.String({ minLength: 1 })), timeoutMs: Type.Integer({ minimum: 1, maximum: 60000 }) }, { additionalProperties: false }),
    Type.Object({ action: Type.Union([Type.Literal("park"), Type.Literal("stop"), Type.Literal("status")]), target: identity }, { additionalProperties: false }),
    Type.Object({ action: Type.Union([Type.Literal("followup"), Type.Literal("revive")]), target: identity, assignment: Type.String({ minLength: 1 }), resultSchema: Type.Optional(Type.Unknown()) }, { additionalProperties: false }),
  ]);
  const coordinationTool = (owner?: DelegationCoordinator, actor?: ChildRef): ToolDefinition<typeof coordinationParameters> => ({
    name: "delegate_coordinate", label: "Coordinate delegation", exposure: "model-only",
    description: "Live-parent identity-pinned coordination. message targets a running family agent (omit target for root inbox, direct children only); inbox reads own bounded mailbox; wait targets an outcome or own inbox with required 1–60000ms timeout, retaining capacity. No transcript access. Child actions require explicit operator grants. Root additionally has status/stop/park and idle followup/parked revive. Followup/revive create a fresh generation/session with current model/auth and narrowed current grants, no old tool replay or historical recovery. Message accepted/queued is NOT model acknowledgment; delivered means transcript/inbox visibility only. 4096-byte messages, 64 mailbox/waiters, 512 messages and 64 generations per live parent.",
    parameters: coordinationParameters,
    async execute(callerId, args, signal, _update, ctx) {
      const registry = owner ?? coordinator;
      signal?.throwIfAborted();
      let value: unknown;
      if (args.action === "message") value = await registry.message(actor, args.target, args.text, args.mode);
      else if (args.action === "inbox") value = registry.inbox(actor);
      else if (args.action === "wait") value = await registry.coordinateWait(actor, args.target, args.timeoutMs, signal, args.messageId);
      else {
        if (actor) throw new Error("Root-only coordination action");
        if (args.action === "stop") { await registry.stop(args.target); value = registry.snapshot(args.target); }
        else if (args.action === "park") { registry.park(args.target); value = registry.agents(); }
        else if (args.action === "status") value = { snapshot: registry.snapshot(args.target), generations: registry.generations(args.target.id), agents: registry.agents() };
        else if (args.action === "followup" || args.action === "revive") {
          const presence = registry.agents().find(state => state.id === args.target.id && state.generation === args.target.generation)?.presence;
          if (presence !== (args.action === "revive" ? "parked" : "idle")) throw new Error("Followup requires idle; revive requires parked current identity");
          const state = registry.snapshot(args.target)!;
          const parent = registry.renewalParent(args.target);
          registry.configure(await resolveScheduling(ctx.cwd, ctx.isProjectTrusted()));
          let { profile, skills } = await resolveProfile(state.profile, ctx.cwd, ctx.isProjectTrusted());
          let ancestor = parent;
          let descendantRole = state.profile;
          while (ancestor) {
            const original = registry.snapshot(ancestor)!;
            const current = (await resolveProfile(original.profile, ctx.cwd, ctx.isProjectTrusted())).profile;
            if (!current.spawn?.includes(descendantRole)) throw new Error("Current ancestor spawn role denied");
            profile = intersectProfileGrants(profile, current);
            descendantRole = original.profile;
            ancestor = original.parentGeneration === undefined ? undefined : { id: original.parentId, generation: original.parentGeneration };
          }
          assertTools(profile.tools);
          signal?.throwIfAborted();
          const next = registry.renew(args.target, { assignment: args.assignment, resultSchema: args.resultSchema, profile, skills, context: ctx, callerId, parent,
            coordinationTools: ref => [coordinationTool(registry, ref)], nestedTool: ref => taskTool(ref, ctx, callerId) });
          value = registry.snapshot(next);
        }
      }
      return { content: [{ type: "text", text: preview(value) }], details: value };
    },
  });
  pi.registerTool(coordinationTool());
  pi.registerTool(taskTool());
  pi.registerCommand("task-profiles", { description: "List bundled profiles and capability availability", handler: async () => show(bundledProfiles()) });
  pi.registerCommand("task-status", { description: "List delegation identities, states and final results", handler: async args => show(args.trim() ? coordinator.snapshot(ref(args)) : coordinator.list()) });
  pi.registerCommand("task-stop", { description: "Stop <task-id> <generation> and drain it", handler: async args => { await coordinator.stop(ref(args)); } });
  pi.registerCommand("task-steer", { description: "Steer <task-id> <generation> <text>", handler: async args => {
    const [id, generation, ...text] = args.trim().split(/\s+/);
    await coordinator.steer(ref(`${id} ${generation}`), text.join(" "));
  } });
  pi.registerCommand("task-hub", { description: "Fleet roster, generation history, transcripts and pinned controls (TUI only)", handler: async (_args, ctx) => {
    if (ctx.mode !== "tui") return;
    await ctx.ui.custom<void>((tui, theme, keys, done) => createHub(coordinator, theme, keys, () => tui.requestRender(), () => done(),
      () => Math.max(1, Math.floor(tui.terminal.rows * 0.9))), { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center" } });
  } });
}
