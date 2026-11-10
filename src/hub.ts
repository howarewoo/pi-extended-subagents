import { colorToOklch, Input, matchesKey, oklchColor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type KeybindingsManager } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ChildRef, ChildSnapshot, DelegationCoordinator } from "./coordinator.ts";

type Palette = Pick<Theme, "fg" | "style"> & { colors: Pick<Theme["colors"], "customMessageBg"> };
export function safe(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g, " ").replaceAll("\t", "  ");
}
const lineText = (text: string) => safe(text).replaceAll("\n", " ");
const active = (child: ChildSnapshot) => !child.disposed;
const activity = (child: ChildSnapshot) => child.error || (active(child) ? child.activity || child.progress : child.result) || child.progress || "Waiting for SDK activity";
export const writerWarning = "Model-tool writer only: no conflicting manual !/!! or external edits";
const statuses = ["queued", "setup", "running", "draining", "settled", "failed", "cancelled"] as const;
export function fleetSummary(children: ChildSnapshot[]): string {
  return children.length ? statuses.map(status => `${status} ${children.filter(child => child.status === status).length}`).join(" · ") : "No tasks · ask the model to delegate_task";
}

/** Bounded overview; all current tasks contribute to counts, including settled entries. */
export function createChildWidget(snapshot: () => ChildSnapshot[], theme: Pick<Theme, "fg">, availableRows = () => 30): Component {
  return {
    render(width) {
      const children = snapshot();
      const running = children.filter(active);
      const counts = width < 75 && children.length ? statuses.map((status, index) => `${["queue", "setup", "run", "drain", "done", "fail", "cancel"][index]}${children.filter(child => child.status === status).length}`).join(" ") : fleetSummary(children);
      const rows = [`FLEET ${children.length} · /task-hub`, counts];
      const writer = children.some(child => child.writerLease);
      const budget = Math.max(1, Math.min(5, Math.floor(availableRows() / 4)));
      const slots = Math.max(0, budget - 2 - (writer ? 1 : 0));
      const shown = [...running, ...children.filter(child => !active(child)).slice(-1)].slice(0, slots);
      rows.push(...shown.map(child => `${child.id.slice(0, 8)} ${child.profile} ${child.status} · ${truncateToWidth(lineText(child.assignment), Math.max(4, Math.floor(width / 4)))} — ${lineText(activity(child))}`));
      if (writer) rows.push(width < 75 ? "Model writer: !/!! + external unsafe" : writerWarning);
      return rows.slice(0, budget).map((line, index) => truncateToWidth(theme.fg(writer && index === rows.length - 1 ? "warning" : index ? "muted" : "accent", lineText(line)), Math.max(0, width)));
    }, invalidate() {},
  };
}

export function taskCard(child: ChildSnapshot | undefined, expanded = false): string[] {
  if (!child) return ["Task identity unavailable", "See tool error; /task-hub lists current runtime tasks"];
  return [
    `${child.id} #${child.generation} · ${child.profile} · ${child.status}`,
    `${child.model.provider}/${child.model.id} · effort ${child.effort ?? "unavailable"}`,
    truncateToWidth(lineText(activity(child)), 240, "… [preview truncated]"),
    `Prewalk ${child.prewalk ? JSON.stringify(child.prewalk) : "off"} · advisor unavailable`,
    `Parent ${child.parentId}${child.parentGeneration ? ` #${child.parentGeneration}` : ""} · depth ${child.depth} · writer lease ${child.writerLease}`,
    ...(child.outcome ? [`Structured ${child.outcome.validation} · ${child.outcome.finalized ? "finalized" : "provisional"} · attempts ${child.outcome.attempts}`] : []),
    ...(child.limitReason ? [`Limit: ${child.limitReason}`] : []),
    ...(child.artifacts ? [`Artifacts: ${JSON.stringify(child.artifacts)}`] : []),
    ...(expanded ? ["Assignment: " + truncateToWidth(lineText(child.assignment), 480, "… [preview truncated]"), "Result: " + truncateToWidth(lineText(child.result || child.error || "Not available yet"), 480, "… [preview truncated]")] : []),
    child.transcript ? `Full transcript: ${child.transcript} · /task-hub` : "Transcript unavailable (setup) · /task-hub",
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
  requestRender: () => void, done: () => void, availableRows = () => 24,
): Component & Focusable & { dispose(): void } {
  let selected: string | undefined;
  let query = "";
  let interactionTarget: ChildRef | undefined;
  let interactionVisibleAtHeight: number | undefined;
  let mode: "browse" | "search" | "steer" | "message" | "stop" = "browse";
  let tab: "thread" | "details" | "tools" = "thread";
  let offset = 0;
  let viewport = 1;
  let notice = "";
  let disposed = false;
  const input = new Input();
  const refresh = () => { if (!disposed) requestRender(); };
  // In-flight projections only; finalized messages remain in the authoritative registry.
  const streaming = new Map<string, ReturnType<DelegationCoordinator["messages"]>[number]>();
  const liveTools = new Map<string, string[]>();
  const unsubscribe = coordinator.subscribe(event => {
    if (event.event?.type === "message_update") streaming.set(identity(event.child), event.event.message);
    if (event.event?.type === "message_end" || event.child.disposed) streaming.delete(identity(event.child));
    const sdk = event.event;
    if (sdk?.type === "tool_execution_start" || sdk?.type === "tool_execution_update") {
      liveTools.set(identity(event.child), [`Live tool: ${sdk.toolName} ${sdk.toolCallId}`, `Arguments: ${safe(JSON.stringify(sdk.args, null, 2))}`,
        ...(sdk.type === "tool_execution_update" ? (Array.isArray(sdk.partialResult.content) ? sdk.partialResult.content : []).flatMap((block: unknown) => block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string" ? [safe(block.text)] : []) : [])]);
    }
    if (sdk?.type === "tool_execution_end" || event.child.disposed) liveTools.delete(identity(event.child));
    refresh();
  });
  const identity = (ref: ChildRef) => `${ref.id}/${ref.generation}`;
  const roster = () => coordinator.list().flatMap(child => coordinator.generations(child.id)).filter(child => lineText([child.id, child.parentId, child.profile, child.status, child.assignment, child.progress, child.result, child.error, child.model.id].join(" ")).toLowerCase().includes(query.toLowerCase()));
  const selection = () => {
    const children = roster();
    if (!children.some(child => identity(child) === selected)) { selected = children[0] && identity(children[0]); offset = 0; }
    return children.find(child => identity(child) === selected);
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
    if (mode === "search") query = lineText(input.getValue());
    else if ((mode === "steer" || mode === "message") && interactionTarget) void control(interactionTarget, input.getValue(), mode === "message");
    interactionTarget = undefined;
    mode = "browse"; input.setValue(""); offset = 0; refresh();
  };
  return {
    focused: false,
    render(width) {
      interactionVisibleAtHeight = undefined;
      width = Math.max(0, width);
      const height = Math.max(1, availableRows());
      const child = selection();
      const panelBg = oklchColor(colorToOklch(theme.colors.customMessageBg).l, 0, 0);
      const paint = (text: string) => {
        const clipped = truncateToWidth(text, width);
        const padded = clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
        return padded.split("\x1b[0m").map(part => theme.style(part, { bg: panelBg })).join("\x1b[0m");
      };
      if (width < 4 || height < 3) return [paint(interactionTarget ? "Resize · Esc cancels" : "FLEET " + coordinator.list().length)];
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
      else footer.push(...(wide ? ["↑↓ agents · / filter · Tab view · PgUp/Dn Home/End scroll", `s steer · m inbox · x stop · w wait · p park · ${close}: close`]
        : ["↑↓ / Tab · s steer m msg x stop", `PgUp/Dn · ${close.replaceAll("escape", "Esc").replaceAll("enter", "Enter").replaceAll("ctrl+", "C-")}: close`]));
      // A pinned target and its controls are indivisible; optional hints must yield first.
      const requiredFooter = interactionTarget ? targetLines.length + 2 : 0;
      const shownFooter = requiredFooter || height >= 8 ? footer.slice(-Math.max(2, height - 7, requiredFooter)) : [];
      if (interactionTarget) interactionVisibleAtHeight = height;
      const paneHeight = Math.max(1, height - 2 - shownFooter.length);
      viewport = Math.max(1, paneHeight - 3);
      let detail: string[] = [];
      if (child) {
        if (tab === "details") {
          const metric = (value: unknown) => value === null || value === undefined ? "unavailable" : JSON.stringify(value);
          detail = [
            "Assignment", safe(child.assignment), "", "Result", safe(child.result || "Not available yet"), "",
            ...(child.error ? ["Error", safe(child.error), ""] : []),
            ...(child.outcome ? ["Structured outcome", JSON.stringify(child.outcome, null, 2), ""] : []),
            ...(child.artifacts ? ["Saved artifacts", JSON.stringify(child.artifacts, null, 2), ""] : []),
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
            detail = messages.length || partial
              ? [...transcriptLines(partial ? [...messages, partial] : messages, tab === "tools"), ...(liveTools.get(identity(child)) ?? [])]
              : [child.error || child.result || (child.status === "queued" ? "Queued · no SDK messages yet" : "Waiting for SDK messages")];
          } catch (error) { detail = ["Transcript unavailable: " + safe(String(error))]; }
        }
      } else detail = [query ? "No matching tasks · / to change filter" : "No tasks · ask the model to delegate_task"];
      const wrapped = detail.flatMap(text => safe(text).split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, threadWidth))));
      offset = Math.max(0, Math.min(offset, wrapped.length - viewport));
      const content = wrapped.slice(offset, offset + viewport).map(line => theme.fg("text", line));
      const statusColor = (item: ChildSnapshot): "error" | "warning" | "success" | "accent" => item.status === "failed" ? "error" : item.status === "cancelled" ? "warning" : item.status === "settled" ? "success" : "accent";
      const selectedLabel = child ? `${child.id.slice(0, 8)} #${child.generation} · ${child.profile} · ${child.status}${historical(child) ? " · history" : ""}` : "No selection";
      const viewLabel = `${tab.toUpperCase()} · Tab: ${tab === "thread" ? "details" : tab === "details" ? "tools" : "thread"}`;
      const position = `${offset + 1}–${Math.min(wrapped.length, offset + viewport)}/${wrapped.length} lines${offset + viewport < wrapped.length ? " · more ↓" : ""}`;
      const pane: string[] = [];
      if (wide) {
        const slots = Math.max(1, Math.floor((paneHeight - 2) / 3));
        const start = Math.max(0, index - slots + 1);
        const left = [theme.fg("accent", `AGENTS · ${children.length} generations`), ...children.slice(start, start + slots).flatMap(item => [
          theme.fg(identity(item) === selected ? "accent" : "text", `${identity(item) === selected ? ">" : " "} ${" ".repeat(Math.min(4, Math.max(0, item.depth - 1)))}└ ${item.id.slice(0, 8)} #${item.generation}${historical(item) ? " · history" : ""}`),
          theme.fg(statusColor(item), `  ${item.profile} · ${item.status}`),
          theme.fg("muted", "  " + lineText(item.assignment)),
        ])];
        const right = [theme.fg("accent", lineText(selectedLabel)), theme.fg("muted", viewLabel), ...content];
        const cell = (text: string, columns: number) => { const clipped = truncateToWidth(text, columns); return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped))); };
        for (let index = 0; index < paneHeight; index++) pane.push(cell(index === paneHeight - 1 ? theme.fg("muted", `${children.length ? start + 1 : 0}–${Math.min(children.length, start + slots)}/${children.length} · ↑↓ select`) : left[index] ?? "", leftWidth) +
          theme.fg("border", " │ ") + cell(index === paneHeight - 1 ? theme.fg("muted", position) : right[index] ?? "", threadWidth));
      } else {
        pane.push(theme.fg("accent", child ? `> └ ${child.id.slice(0, 8)} #${child.generation} · ${index + 1}/${children.length}` : "No selection"));
        if (paneHeight > 1) pane.push(theme.fg(child ? statusColor(child) : "muted", `${viewLabel}${child ? ` · ${child.status}` : ""}`));
        if (paneHeight > 2) pane.push(...content.slice(0, paneHeight - 3), ...Array(Math.max(0, paneHeight - 3 - content.length)).fill(""), theme.fg("muted", position));
      }
      return [frame("╭", " Fleet / Agent Hub ", "╮"), ...pane.slice(0, height - 2).map(row), ...shownFooter.map(row), frame("╰", "", "╯")];
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
        offset = 0; notice = "";
      } else if (keybindings.matches(data, "tui.select.pageUp")) offset = Math.max(0, offset - viewport);
      else if (keybindings.matches(data, "tui.select.pageDown")) offset += viewport;
      else if (matchesKey(data, "home")) offset = 0;
      else if (matchesKey(data, "end")) offset = Number.MAX_SAFE_INTEGER;
      else if (matchesKey(data, "tab")) { tab = tab === "thread" ? "details" : tab === "details" ? "tools" : "thread"; offset = 0; }
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
    invalidate() { input.invalidate(); },
    dispose() { disposed = true; interactionTarget = undefined; unsubscribe(); streaming.clear(); liveTools.clear(); },
  };
}
