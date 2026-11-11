import { colorToOklch, Input, matchesKey, oklchColor, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type KeybindingsManager } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ChildRef, ChildSnapshot, DelegationCoordinator } from "./coordinator.ts";
import { createNativeThread, safe, type LiveTool, type ThreadDependencies } from "./thread.ts";
export { safe } from "./thread.ts";

type Palette = Pick<Theme, "fg" | "style"> & { colors: Pick<Theme["colors"], "customMessageBg"> };
const lineText = (text: string) => safe(text).replaceAll("\n", " ");
const assignmentHeadline = (child: ChildSnapshot) => safe(child.assignment).split("\n").map(line => line.trim()).find(Boolean)?.replace(/^#{1,6}\s+/, "") || "Assignment";
export const agentLabel = (child: ChildSnapshot) => `${assignmentHeadline(child)} · ${lineText(child.profile)}`;
const active = (child: ChildSnapshot) => !child.disposed;
const activity = (child: ChildSnapshot) => child.error || (active(child) ? child.activity || child.progress : child.result) || child.progress || "Waiting for SDK activity";
export const writerWarning = "Model-tool writer only: no conflicting manual !/!! or external edits";
const statuses = ["queued", "setup", "running", "draining", "settled", "failed", "cancelled"] as const;
export function fleetSummary(children: ChildSnapshot[]): string {
  return children.length ? statuses.map(status => `${status} ${children.filter(child => child.status === status).length}`).join(" · ") : "No tasks · ask the model to delegate_task";
}

/** Event-driven, bounded current-agent tree; history and full metrics remain in the Hub. */
export function createChildWidget(snapshot: () => ChildSnapshot[], theme: Pick<Theme, "fg"> & Partial<Pick<Theme, "bold">>, availableRows = () => 30): Component {
  return {
    render(width) {
      width = Math.max(0, width);
      const children = snapshot();
      if (!children.length) return [];
      const queued = children.filter(child => child.status === "queued").length;
      const priority = (child: ChildSnapshot) => child.status === "draining" ? 0 : child.status === "running" ? 1 : child.status === "setup" ? 2 : 3;
      const live = children.filter(child => !child.disposed && child.status !== "queued").sort((a, b) => priority(a) - priority(b));
      const finished = children.filter(child => child.disposed).sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
      const candidates = [...live, ...finished];
      const writer = children.some(child => child.writerLease);
      const budget = Math.max(1, Math.min(5, Math.floor(availableRows() / 4)));
      const counts = width < 60 ? `${live.length} active · ${queued} queued` : statuses.flatMap(status => {
        const count = children.filter(child => child.status === status).length;
        return count ? [`${count} ${status}`] : [];
      }).join(" · ");
      const rows = [theme.fg("accent", `● Sub-agents ${children.length}`) + theme.fg("muted", ` · ${counts}`)];
      if (writer && budget === 1) rows[0] = theme.fg("warning", `● Sub-agents ${children.length} · Model writer: !/!! + external unsafe · ${queued} queued`);
      const room = Math.max(0, budget - 1 - (writer && budget > 1 ? 1 : 0));
      const activityRows = candidates.length && room >= (candidates.length > 1 ? 3 : 2) ? 1 : 0;
      const slots = room - activityRows;
      const overflow = candidates.length > slots;
      const shown = candidates.slice(0, Math.max(0, slots - (overflow ? 1 : 0)));
      shown.forEach((child, index) => {
        const last = index === shown.length - 1 && shown.length === candidates.length;
        const color = child.status === "failed" ? "error" : child.status === "draining" || child.status === "cancelled" ? "warning" : child.status === "settled" ? "success" : "accent";
        const role = lineText(child.profile);
        const indent = "  ".repeat(Math.min(3, Math.max(0, child.depth - 1)));
        const prefix = theme.fg("muted", `${indent}${last ? "└─" : "├─"} `) + theme.fg(color, child.disposed ? "○ " : "● ") + (theme.bold?.(role) ?? role) + " ";
        const elapsed = Math.max(0, Math.floor(((child.endedAt ?? Date.now()) - child.createdAt) / 1000));
        const stats = [child.status, `${elapsed}s`, `${child.toolCalls} tools`,
          ...(child.telemetry.requests === null ? [] : [`${child.telemetry.requests} req`]),
          ...(child.telemetry.tokens ? [`${child.telemetry.tokens.total} tok`] : []),
          ...(child.telemetry.cost === null ? [] : [`$${child.telemetry.cost.toFixed(3)}`])].join(" · ");
        const metric = truncateToWidth(stats, Math.max(8, Math.floor(width / 2)));
        const headline = assignmentHeadline(child);
        rows.push(prefix + theme.fg("text", truncateToWidth(headline, Math.max(4, width - visibleWidth(prefix) - visibleWidth(metric) - 3))) + theme.fg("muted", " · " + metric));
        if (!index && activityRows) {
          const prefix = `${indent}${last ? "   " : "│  "} └ `;
          const text = lineText(activity(child));
          const columns = Math.max(0, width - visibleWidth(prefix));
          const length = visibleWidth(text);
          // Progress is an accumulated tail; keep its newest text, not a frozen opening paragraph.
          const preview = length > columns ? "…" + sliceByColumn(text, length - Math.max(0, columns - 1), Math.max(0, columns - 1)) : text;
          rows.push(theme.fg("muted", prefix + preview));
        }
      });
      if (shown.length < candidates.length && room) rows.push(theme.fg("muted", `└─ ${candidates.length - shown.length} more · /agent-hub`));
      else if (!candidates.length && queued && room) rows.push(theme.fg("muted", `└─ ${queued} queued`));
      if (writer && budget > 1) rows.push(theme.fg("warning", width < 75 ? "Model writer: !/!! + external unsafe" : writerWarning));
      return rows.slice(0, budget).map(line => truncateToWidth(line, width));
    }, invalidate() {},
  };
}

export function taskCard(child: ChildSnapshot | undefined, expanded = false): string[] {
  if (!child) return ["Task identity unavailable", "See tool error; /agent-hub lists current runtime tasks"];
  return [
    `${truncateToWidth(agentLabel(child), 240, "… [preview truncated]")} #${child.generation} · ${child.status}`,
    `Identity ${child.id} #${child.generation}`,
    `${child.model.provider}/${child.model.id} · effort ${child.effort ?? "unavailable"}`,
    truncateToWidth(lineText(activity(child)), 240, "… [preview truncated]"),
    `Prewalk ${child.prewalk ? JSON.stringify(child.prewalk) : "off"} · advisor unavailable`,
    `Parent ${child.parentId}${child.parentGeneration ? ` #${child.parentGeneration}` : ""} · depth ${child.depth} · writer lease ${child.writerLease}`,
    ...(child.outcome ? [`Structured ${child.outcome.validation} · ${child.outcome.finalized ? "finalized" : "provisional"} · attempts ${child.outcome.attempts}`] : []),
    ...(child.limitReason ? [`Limit: ${child.limitReason}`] : []),
    ...(child.artifacts ? [`Artifacts: ${JSON.stringify(child.artifacts)}`] : []),
    ...(expanded ? ["Assignment: " + truncateToWidth(lineText(child.assignment), 480, "… [preview truncated]"), "Result: " + truncateToWidth(lineText(child.result || child.error || "Not available yet"), 480, "… [preview truncated]")] : []),
    child.transcript ? `Full transcript: ${child.transcript} · /agent-hub` : "Transcript unavailable (setup) · /agent-hub",
  ].map(lineText);
}

/** Read-only content projection: never dumps provider/auth objects, image payloads or opaque signatures. */
export function transcriptLines(messages: ReturnType<DelegationCoordinator["messages"]>, toolsOnly = false): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const start = lines.length;
    const blocks = "content" in message ? message.content : undefined;
    if (!toolsOnly || message.role === "toolResult") {
      lines.push(`[${message.role}${message.role === "toolResult" ? ` ${message.toolName} ${message.toolCallId} ${message.isError ? "ERROR" : "result"}` : ""}]`);
      if (typeof blocks === "string") lines.push(safe(blocks));
    }
    if (Array.isArray(blocks)) for (const block of blocks) {
      if (block.type === "toolCall") lines.push(`Tool ${block.name} ${block.id}\nArguments: ${safe(JSON.stringify(block.arguments, null, 2))}`);
      else if (!toolsOnly || message.role === "toolResult") {
        if (block.type === "text") lines.push(safe(block.text));
        else if (block.type === "thinking") lines.push("Thinking: " + safe(block.thinking));
        else if (block.type === "image") lines.push(`[image ${safe(block.mimeType)}; payload omitted]`);
      }
    }
    if (message.role === "assistant" && message.errorMessage) lines.push("Error: " + safe(message.errorMessage));
    if (start && lines.length > start) lines.splice(start, 0, "");
  }
  return lines.length ? lines.map(safe) : [toolsOnly ? "No tool calls yet" : "Waiting for SDK messages"];
}

/** Observation only: closing or disposing never touches child execution. */
export function createHub(
  coordinator: DelegationCoordinator, theme: Palette,
  keybindings: Pick<KeybindingsManager, "matches" | "getKeys">,
  requestRender: () => void, done: () => void, dependencies: ThreadDependencies, availableRows = () => 24,
): Component & Focusable & { dispose(): void } {
  let selected: string | undefined;
  let query = "";
  let interactionTarget: ChildRef | undefined;
  let interactionVisibleAtHeight: number | undefined;
  let mode: "browse" | "search" | "steer" | "message" | "stop" = "browse";
  let tab: "thread" | "details" | "tools" = "thread";
  let offset = 0;
  let following = true;
  let maxOffset = 0;
  let threadBounds: {x: number; y: number; width: number; height: number} | undefined;
  let viewport = 1;
  let notice = "";
  let disposed = false;
  const input = new Input();
  const nativeThread = createNativeThread(dependencies);
  const refresh = () => { if (!disposed) requestRender(); };
  // In-flight projections only; finalized messages remain in the authoritative registry.
  const streaming = new Map<string, ReturnType<DelegationCoordinator["messages"]>[number]>();
  const liveTools = new Map<string, LiveTool>();
  const unsubscribe = coordinator.subscribe(event => {
    if (event.event?.type === "message_update") streaming.set(identity(event.child), event.event.message);
    if (event.event?.type === "message_end" || event.child.disposed) streaming.delete(identity(event.child));
    const sdk = event.event;
    if (sdk?.type === "tool_execution_start" || sdk?.type === "tool_execution_update") {
      liveTools.set(identity(event.child), {toolName: sdk.toolName, toolCallId: sdk.toolCallId, args: sdk.args,
        ...(sdk.type === "tool_execution_update" ? {content: sdk.partialResult.content} : {})});
    }
    if (sdk?.type === "tool_execution_end" || event.child.disposed) liveTools.delete(identity(event.child));
    refresh();
  });
  const identity = (ref: ChildRef) => `${ref.id}/${ref.generation}`;
  const roster = () => coordinator.list().flatMap(child => coordinator.generations(child.id)).filter(child => lineText([child.id, child.parentId, child.profile, child.status, child.assignment, child.progress, child.result, child.error, child.model.id].join(" ")).toLowerCase().includes(query.toLowerCase()));
  const selection = () => {
    const children = roster();
    if (!children.some(child => identity(child) === selected)) { selected = children[0] && identity(children[0]); offset = 0; following = tab === "thread"; }
    return children.find(child => identity(child) === selected);
  };
  const scrollBy = (delta: number) => {
    offset = Math.max(0, Math.min(maxOffset, offset + delta));
    if (tab === "thread") following = delta > 0 && offset === maxOffset;
    refresh();
  };
  const control = async (target: ChildRef, text?: string, message = false) => {
    notice = text === undefined ? "Stopping and draining…" : message ? "Sending inbox message…" : "Sending steering…"; refresh();
    try {
      const child = coordinator.snapshot(target);
      if (!child || child.disposed || child.status === "draining" || (text !== undefined && child.status !== "running")) throw new Error(`Target ${target.id} #${target.generation} is no longer running; no action sent`);
      if (text === undefined) { await coordinator.stop(target); notice = "Stopped and drained"; }
      else if (message) {
        const receipt = await coordinator.message(undefined, target, text);
        notice = `Message ${receipt.id} · ${receipt.status} · NOT model acknowledgment${receipt.error ? ` · ${receipt.error}` : ""}`;
      } else notice = `Steering ${await coordinator.steer(target, text)}`;
    } catch (error) { notice = String(error); }
    refresh();
  };
  const observeControl = async (target: ChildRef, action: "wait" | "park") => {
    try {
      if (action === "park") { coordinator.park(target); notice = "Parked (session already disposed)"; }
      else { notice = "Waiting up to 1000ms (not model acknowledgment)…"; refresh(); notice = JSON.stringify(await coordinator.coordinateWait(undefined, target, 1000)); }
    } catch (error) { notice = String(error); }
    refresh();
  };
  const canSubmitInteraction = () => {
    if (interactionVisibleAtHeight === Math.max(1, availableRows())) return true;
    notice = "Resize for controls · Esc cancels; no action sent"; refresh(); return false;
  };
  const finishInput = () => {
    if (interactionTarget && !canSubmitInteraction()) return;
    if (mode === "search") { query = lineText(input.getValue()); offset = 0; following = tab === "thread"; }
    else if ((mode === "steer" || mode === "message") && interactionTarget) void control(interactionTarget, input.getValue(), mode === "message");
    interactionTarget = undefined;
    mode = "browse"; input.setValue(""); refresh();
  };
  return {
    focused: false,
    render(width) {
      interactionVisibleAtHeight = undefined;
      threadBounds = undefined;
      width = Math.max(0, width);
      const height = Math.max(1, availableRows());
      const child = selection();
      const panelBg = oklchColor(colorToOklch(theme.colors.customMessageBg).l, 0, 0);
      const paint = (text: string) => {
        const clipped = truncateToWidth(text, width);
        const padded = clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
        const restoreBg = theme.style("", {bg: panelBg}).replace(/\x1b\[49m$/, "");
        return padded.split("\x1b[0m").map(part => theme.style(part.replaceAll("\x1b[49m", restoreBg), { bg: panelBg })).join("\x1b[0m");
      };
      if (width < 4 || height < 3) return [paint(interactionTarget ? "Resize · Esc cancels" : "Agent Hub " + coordinator.list().length)];
      const inner = Math.max(0, width - 4);
      const row = (text: string) => {
        const clipped = truncateToWidth(text, inner);
        return paint(theme.fg("border", "│") + " " + clipped + " ".repeat(Math.max(1, width - 3 - visibleWidth(clipped))) + theme.fg("border", "│"));
      };
      const frame = (left: string, title: string, right: string) => {
        const text = truncateToWidth(title, width - 2);
        return paint(theme.fg("border", left) + theme.fg("accent", text) + theme.fg("border", "─".repeat(Math.max(0, width - 2 - visibleWidth(text))) + right));
      };
      const children = roster();
      const current = coordinator.list();
      const historical = (item: ChildRef) => !current.some(live => identity(live) === identity(item));
      const index = children.findIndex(item => identity(item) === selected);
      const wide = width >= 76;
      const leftWidth = wide ? Math.min(32, Math.max(24, Math.floor(inner / 3))) : 0;
      const threadWidth = wide ? inner - leftWidth - 3 : inner;
      const close = [...new Set([...keybindings.getKeys("tui.select.cancel"), ...keybindings.getKeys("tui.select.confirm")])].join("/");
      const footer: string[] = [];
      if (query) footer.push(theme.fg("muted", `Filter: ${lineText(query)} · ${children.length} generations`));
      if (current.some(item => item.writerLease)) footer.push(theme.fg("warning", "WRITER: model tools only; no manual/external writes"));
      if (notice) {
        const lines = wrapTextWithAnsi(lineText(notice), Math.max(1, inner));
        footer.push(...lines.slice(0, 3).map((line, index) => theme.fg("warning", index === 2 && lines.length > 3 ? truncateToWidth(line, Math.max(0, inner - 19)) + " [notice truncated]" : line)));
      }
      const targetLines = interactionTarget ? wrapTextWithAnsi(`Target: ${interactionTarget.id} #${interactionTarget.generation}`, Math.max(1, inner)) : [];
      if (interactionTarget && (inner < 26 || height < targetLines.length + 5)) {
        return [frame("╭", " Resize / Esc cancel ", "╮"), ...targetLines.slice(0, height - 3).map(row),
          row("Resize for controls · Esc cancels"), frame("╰", "", "╯")];
      }
      footer.push(...targetLines.map(line => theme.fg("accent", line)));
      if (mode === "search" || mode === "steer" || mode === "message") {
        input.focused = this.focused;
        const label = mode === "search" ? "Filter: " : mode === "message" ? "Inbox: " : "Steer: ";
        footer.push(label + input.render(Math.max(1, inner - visibleWidth(label)))[0], "Enter submit · Esc back (no action)");
      } else if (mode === "stop") footer.push("Stop target? y confirms · Esc back", "Enter does not confirm stop");
      else footer.push(...(wide ? ["↑↓ agents · j/k line · Ctrl+u/d or PgUp/Dn page · Home/End", `${close}: close · / filter Tab view · s steer m inbox x stop · w wait p park`]
        : ["↑↓ agent · j/k scroll · / Tab", `End live · s/m/x · ${(keybindings.getKeys("tui.select.cancel")[0] ?? "Esc").replaceAll("escape", "Esc")}: close`]));
      // A pinned target and its controls are indivisible; optional hints must yield first.
      const requiredFooter = interactionTarget ? targetLines.length + 2 : 0;
      const shownFooter = requiredFooter || height >= 8 ? footer.slice(-Math.max(2, height - 7, requiredFooter)) : [];
      if (interactionTarget) interactionVisibleAtHeight = height;
      const paneHeight = Math.max(1, height - 2 - shownFooter.length);
      viewport = Math.max(1, paneHeight - 3);
      let detail: string[] = [];
      let nativeLines: string[] | undefined;
      if (child) {
        if (tab === "details") {
          const metric = (value: unknown) => value === null || value === undefined ? "unavailable" : JSON.stringify(value);
          detail = [
            `Identity ${child.id} #${child.generation}`, "", "Assignment", safe(child.assignment), "", "Result", safe(child.result || "Not available yet"), "",
            ...(child.error ? ["Error", safe(child.error), ""] : []),
            ...(child.outcome ? ["Structured outcome", JSON.stringify(child.outcome, null, 2), ""] : []),
            ...(child.artifacts ? ["Saved artifacts", JSON.stringify(child.artifacts, null, 2), ""] : []),
            `Workspace: ${safe(child.cwd ?? "parent workspace")}`,
            `Effective builtin tools: ${child.tools.join(", ")}`,
            `${child.model.provider}/${child.model.id} · effort ${child.effort ?? "unavailable"}`,
            `Prewalk ${child.prewalk ? JSON.stringify(child.prewalk) : "off"} · advisor unavailable`,
            `Presence ${coordinator.agents().find(agent => agent.id === child.id && agent.generation === child.generation)?.presence ?? "historical"} · resources ${child.disposed ? "disposed" : "live"}`,
            `Elapsed ${Math.max(0, Math.floor(((child.endedAt ?? Date.now()) - child.createdAt) / 1000))}s`,
            `Direct requests ${metric(child.telemetry.requests)} · cost ${metric(child.telemetry.cost)}`,
            `Direct tokens ${metric(child.telemetry.tokens)}`, `Context ${metric(child.telemetry.context)}`,
            `Parent ${child.parentId} #${child.parentGeneration ?? "root"} · depth ${child.depth} · direct generation only`,
            `Limits ${JSON.stringify(child.limits)} · calls ${child.toolCalls} · reason ${child.limitReason ?? "none"}`,
            "Activity: " + safe(activity(child)),
            "Full transcript: " + safe(child.transcript ?? "unavailable (queued/setup)"),
            "Followup/revive: native delegate_coordinate only (Hub has no tool dispatcher)",
            ...(child.writerLease ? [writerWarning] : []),
          ];
        } else {
          try {
            const messages = coordinator.messages(child);
            const partial = streaming.get(identity(child));
            if (tab === "thread" && (messages.length || partial || liveTools.has(identity(child)))) {
              nativeLines = nativeThread.render(identity(child), messages, partial, liveTools.get(identity(child)), threadWidth);
            } else detail = messages.length || partial
              ? [...transcriptLines(partial ? [...messages, partial] : messages, true),
                ...(liveTools.get(identity(child)) ? ["Live tool: " + liveTools.get(identity(child))!.toolName,
                  "Arguments: " + JSON.stringify(liveTools.get(identity(child))!.args, null, 2),
                  ...(liveTools.get(identity(child))!.content ?? []).flatMap(block => block.type === "text" ? [block.text ?? ""] : [])] : [])]
              : [child.error || child.result || (child.status === "queued" ? "Queued · no SDK messages yet" : "Waiting for SDK messages")];
          } catch (error) { detail = ["Transcript unavailable: " + safe(String(error))]; }
        }
      } else detail = [query ? "No matching tasks · / to change filter" : "No tasks · ask the model to delegate_task"];
      const wrapped = nativeLines ?? detail.flatMap(text => safe(text).split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, threadWidth))));
      maxOffset = Math.max(0, wrapped.length - viewport);
      offset = tab === "thread" && following ? maxOffset : Math.max(0, Math.min(offset, maxOffset));
      threadBounds = {x: wide ? 2 + leftWidth + 3 : 2, y: 3, width: threadWidth, height: Math.max(0, paneHeight - 3)};
      const content = wrapped.slice(offset, offset + viewport).map(line => nativeLines ? line : theme.fg("text", line));
      const statusColor = (item: ChildSnapshot): "error" | "warning" | "success" | "accent" => item.status === "failed" ? "error" : item.status === "cancelled" ? "warning" : item.status === "settled" ? "success" : "accent";
      const selectedLabel = child ? `${agentLabel(child)} #${child.generation} · ${child.status}${historical(child) ? " · history" : ""}` : "No selection";
      const viewLabel = `${tab.toUpperCase()} · Tab: ${tab === "thread" ? "details" : tab === "details" ? "tools" : "thread"}`;
      const position = `${tab === "thread" ? following ? "LIVE · " : "READING · " : ""}${offset + 1}–${Math.min(wrapped.length, offset + viewport)}/${wrapped.length} lines${tab === "thread" ? following ? " · k/PgUp read" : " · End: live" : offset < maxOffset ? " · more ↓" : ""}`;
      const pane: string[] = [];
      if (wide) {
        const slots = Math.max(1, Math.floor((paneHeight - 2) / 3));
        const start = Math.max(0, index - slots + 1);
        const left = [theme.fg("accent", `SUB-AGENTS · ${children.length} generations`), ...children.slice(start, start + slots).flatMap(item => [
          theme.fg(identity(item) === selected ? "accent" : "text", `${identity(item) === selected ? ">" : " "} ${" ".repeat(Math.min(4, Math.max(0, item.depth - 1)))}└ ${agentLabel(item)} #${item.generation}${historical(item) ? " · history" : ""}`),
          theme.fg(statusColor(item), `  ${item.profile} · ${item.status}`),
          theme.fg("muted", `  #${item.generation}${historical(item) ? " · history" : ""}`),
        ])];
        const right = [theme.fg("accent", lineText(selectedLabel)), theme.fg("muted", viewLabel), ...content];
        const cell = (text: string, columns: number) => { const clipped = truncateToWidth(text, columns); return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped))); };
        for (let index = 0; index < paneHeight; index++) pane.push(cell(index === paneHeight - 1 ? theme.fg("muted", `${children.length ? start + 1 : 0}–${Math.min(children.length, start + slots)}/${children.length} · ↑↓ select`) : left[index] ?? "", leftWidth) +
          theme.fg("border", " │ ") + cell(index === paneHeight - 1 ? theme.fg("muted", position) : right[index] ?? "", threadWidth));
      } else {
        const suffix = child ? ` #${child.generation} · ${index + 1}/${children.length}` : "";
        pane.push(theme.fg("accent", child ? `> └ ${truncateToWidth(agentLabel(child), Math.max(0, inner - 4 - visibleWidth(suffix)))}${suffix}` : "No selection"));
        if (paneHeight > 1) pane.push(theme.fg(child ? statusColor(child) : "muted", `${tab.toUpperCase()}${child ? ` · ${child.profile} · ${child.status}` : ""}`));
        if (paneHeight > 2) pane.push(...content.slice(0, paneHeight - 3), ...Array(Math.max(0, paneHeight - 3 - content.length)).fill(""), theme.fg("muted", position));
      }
      return [frame("╭", " Agent Hub ", "╮"), ...pane.slice(0, height - 2).map(row), ...shownFooter.map(row), frame("╰", "", "╯")];
    },
    handleInput(data) {
      if (keybindings.matches(data, "tui.select.cancel")) {
        if (mode !== "browse") { mode = "browse"; interactionTarget = undefined; input.setValue(""); refresh(); } else done();
        return;
      }
      if (mode === "search" || mode === "steer" || mode === "message") {
        if (keybindings.matches(data, "tui.select.confirm")) finishInput();
        else { input.handleInput(data); const cleaned = lineText(input.getValue()); if (cleaned !== input.getValue()) input.setValue(cleaned); refresh(); }
        return;
      }
      if (mode === "stop") {
        if (data === "y") {
          if (interactionTarget && !canSubmitInteraction()) return;
          if (interactionTarget) void control(interactionTarget);
          interactionTarget = undefined; mode = "browse";
        }
        refresh(); return;
      }
      if (keybindings.matches(data, "tui.select.confirm")) { done(); return; }
      if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.select.down")) {
        const children = roster();
        const index = children.findIndex(child => identity(child) === selected);
        const next = children[Math.max(0, Math.min(children.length - 1, index + (keybindings.matches(data, "tui.select.up") ? -1 : 1)))];
        selected = next && identity(next);
        offset = 0; following = tab === "thread"; notice = "";
      } else if (keybindings.matches(data, "tui.select.pageUp") || matchesKey(data, "ctrl+u")) scrollBy(-viewport);
      else if (keybindings.matches(data, "tui.select.pageDown") || matchesKey(data, "ctrl+d")) scrollBy(viewport);
      else if (data === "k") scrollBy(-1);
      else if (data === "j") scrollBy(1);
      else if (matchesKey(data, "home")) { offset = 0; following = false; }
      else if (matchesKey(data, "end")) { offset = maxOffset; following = tab === "thread"; }
      else if (matchesKey(data, "tab")) { tab = tab === "thread" ? "details" : tab === "details" ? "tools" : "thread"; offset = 0; following = tab === "thread"; }
      else if (data === "/") {
        mode = "search"; input.setValue(query);
        // Native Input.setValue preserves its old cursor; a saved filter starts editing at its end.
        input.handleInput("\x1b[F");
      }
      else if (["w", "p", "f", "r"].includes(data)) {
        const child = selection();
        if (!child) notice = "Select an identity first";
        else if (data === "w" || data === "p") void observeControl({id: child.id, generation: child.generation}, data === "w" ? "wait" : "park");
        else {
          notice = "Followup/revive: native model-issued delegate_coordinate only. Hub command context has no permission-preserving tool dispatcher; no generation started.";
        }
      }
      else if (data === "s" || data === "x" || data === "m") {
        const child = selection();
        if (child && !child.disposed && child.status !== "draining" && (data === "x" || child.status === "running")) { mode = data === "s" ? "steer" : data === "m" ? "message" : "stop"; interactionTarget = {id: child.id, generation: child.generation}; interactionVisibleAtHeight = undefined; input.setValue(""); }
        else notice = "Controls unavailable: historical/disposed target, or task not running (stop accepts queued/setup/running)";
      }
      refresh();
    },
    handleMouse(event) {
      if (event.type !== "wheel" || disposed) return;
      // Overlay wheels outside the reading viewport must not fall through to the main chat.
      if (mode === "browse" && threadBounds && event.x >= threadBounds.x && event.x < threadBounds.x + threadBounds.width &&
        event.y >= threadBounds.y && event.y < threadBounds.y + threadBounds.height && event.wheelDelta) scrollBy(event.wheelDelta);
      return {handled: true};
    },
    invalidate() { input.invalidate(); nativeThread.invalidate(); },
    dispose() { disposed = true; interactionTarget = undefined; unsubscribe(); streaming.clear(); liveTools.clear(); nativeThread.clear(); },
  };
}
