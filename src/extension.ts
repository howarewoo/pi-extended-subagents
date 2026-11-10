import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { Type } from "typebox";
import { truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DelegationCoordinator, type ChildRef, type ChildSnapshot } from "./coordinator.ts";
import { READ_TOOLS, resolveProfile, bundledProfiles } from "./profiles.ts";
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
    const clipped = truncateHead(JSON.stringify(value, null, 2));
    return `${transcript ? `Transcript: ${transcript}\n` : ""}${clipped.content}${clipped.truncated ? "\n[Preview truncated; inspect the retained transcript or request task-status for one identity]" : ""}`;
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
  const parameters = Type.Object({ assignment: Type.String({ minLength: 1 }),
    profile: Type.Union([Type.Literal("general"), Type.Literal("scout"), Type.Literal("review"), Type.Literal("implementation")]),
    background: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false });
  // Pi rejects conflicting extension tool registrations during resource loading.
  pi.registerTool({
      name: "delegate_task", label: "Delegate task", exposure: "model-only",
      description: "Delegate ONE assignment using the selected parent model. Profiles general/scout/review are read-only; implementation holds the exclusive model-tool writer. Manual !/!! commands, external terminals/editors and unrelated sessions are UNCOORDINATED: do not run conflicting writes while a child writer is active. Foreground returns final output; background returns identity and delivers one completion. Output preview limited to 50KB/2000 lines; full transcript path retained. No batches or nesting.",
      parameters,
      renderCall(args, theme) {
        return { render: width => [theme.fg("toolTitle", `Delegate · ${safe(args.profile ?? "profile pending")} · ${args.background ? "background" : "foreground"}`), safe(args.assignment ?? "Receiving assignment…").replaceAll("\n", " ")].map(line => truncateToWidth(line, Math.max(0, width))), invalidate() {} };
      },
      renderResult(result, options, theme) {
        const stored = result.details as ChildSnapshot | undefined;
        if (!stored?.id) return new Text(safe(result.content.filter(block => block.type === "text").map(block => block.text).join("\n")), 0, 0);
        return {
          render(width) {
            let child = stored;
            if (stored?.id) {
              try { child = coordinator?.snapshot(stored) ?? stored; } catch { /* delivered details remain valid after runtime replacement */ }
            }
            return new Text(taskCard(child, options.expanded).map(line => theme.fg("text", line)).join("\n"), 0, 0).render(width);
          },
          invalidate() {},
        };
      },
      async execute(callerId, args, signal, onUpdate, ctx) {
        const { profile, skills } = await resolveProfile(args.profile, ctx.cwd, ctx.isProjectTrusted());
        assertTools(profile.tools);
        signal?.throwIfAborted();
        const child = await coordinator.start({ assignment: args.assignment, profile, skills, context: ctx, callerId });
        const abort = () => { void coordinator.stop(child); };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) await coordinator.stop(child);
        const result = (state: ChildSnapshot | (ChildRef & { status: ChildSnapshot["status"] })) => {
          const transcript = "transcript" in state ? state.transcript : undefined;
          return { content: [{ type: "text" as const, text: preview(state, transcript) }],
            details: "assignment" in state ? state : coordinator.snapshot(child)!, isError: state.status === "failed" || state.status === "cancelled" };
        };
        if (args.background) {
          signal?.removeEventListener("abort", abort);
          void coordinator.wait(child).then(state => { if (!closing) show(state, state.transcript); });
          return result({ ...child, status: coordinator.snapshot(child)!.status });
        }
        const unsubscribe = coordinator.subscribe(event => { if (event.child.id === child.id) onUpdate?.(result(event.child)); });
        try { return result(await coordinator.wait(child)); }
        finally { unsubscribe(); signal?.removeEventListener("abort", abort); }
      },
  });
  pi.registerCommand("task-profiles", { description: "List bundled profiles and capability availability", handler: async () => show(bundledProfiles()) });
  pi.registerCommand("task-status", { description: "List delegation identities, states and final results", handler: async args => show(args.trim() ? coordinator.snapshot(ref(args)) : coordinator.list()) });
  pi.registerCommand("task-stop", { description: "Stop <task-id> <generation> and drain it", handler: async args => { await coordinator.stop(ref(args)); } });
  pi.registerCommand("task-steer", { description: "Steer <task-id> <generation> <text>", handler: async args => {
    const [id, generation, ...text] = args.trim().split(/\s+/);
    await coordinator.steer(ref(`${id} ${generation}`), text.join(" "));
  } });
  pi.registerCommand("task-hub", { description: "Fleet roster, inspector, transcript and child controls (TUI only)", handler: async (_args, ctx) => {
    if (ctx.mode !== "tui") return;
    await ctx.ui.custom<void>((tui, theme, keys, done) => createHub(coordinator, theme, keys, () => tui.requestRender(), () => done(),
      () => Math.max(1, Math.floor(tui.terminal.rows * 0.9))), { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center" } });
  } });
}
