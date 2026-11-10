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
const statuses = ["setup", "running", "settled", "failed", "cancelled"] as const;
export function fleetSummary(children: ChildSnapshot[]): string {
  return children.length ? statuses.map(status => `${status} ${children.filter(child => child.status === status).length}`).join(" · ") : "No tasks · ask the model to delegate_task";
}

/** Bounded overview; all current tasks contribute to counts, including settled entries. */
export function createChildWidget(snapshot: () => ChildSnapshot[], theme: Pick<Theme, "fg">, availableRows = () => 30): Component {
  return {
    render(width) {
      const children = snapshot();
      const running = children.filter(active);
      const counts = width < 75 && children.length ? statuses.map((status, index) => `${["setup", "run", "done", "fail", "cancel"][index]}${children.filter(child => child.status === status).length}`).join(" ") : fleetSummary(children);
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
    truncateToWidth(lineText(activity(child)), 240),
    ...(expanded ? ["Assignment: " + truncateToWidth(lineText(child.assignment), 480), "Result: " + truncateToWidth(lineText(child.result || child.error || "Not available yet"), 480)] : []),
    child.transcript ? `Full transcript: ${child.transcript} · /task-hub` : "Transcript unavailable (setup) · /task-hub",
  ].map(lineText);
}

/** Read-only content projection: never dumps provider/auth objects, image payloads or opaque signatures. */
export function transcriptLines(messages: ReturnType<DelegationCoordinator["messages"]>, toolsOnly = false): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
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
  }
  return lines.length ? lines : [toolsOnly ? "No tool calls yet" : "Waiting for SDK messages"];
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
  let mode: "browse" | "search" | "steer" | "stop" = "browse";
  let tab: "inspector" | "transcript" | "tools" = "inspector";
  let offset = 0;
  let viewport = 1;
  let notice = "";
  let disposed = false;
  const input = new Input();
  const refresh = () => { if (!disposed) requestRender(); };
  // At most one in-flight message per child while this view is open; finalized history stays SDK-owned.
  const streaming = new Map<string, ReturnType<DelegationCoordinator["messages"]>[number]>();
  const liveTools = new Map<string, string[]>();
  const unsubscribe = coordinator.subscribe(event => {
    if (event.event?.type === "message_update") streaming.set(event.child.id, event.event.message);
    if (event.event?.type === "message_end" || event.child.disposed) streaming.delete(event.child.id);
    const sdk = event.event;
    if (sdk?.type === "tool_execution_start" || sdk?.type === "tool_execution_update") {
      liveTools.set(event.child.id, [`Live tool: ${sdk.toolName} ${sdk.toolCallId}`, `Arguments: ${safe(JSON.stringify(sdk.args, null, 2))}`,
        ...(sdk.type === "tool_execution_update" ? (Array.isArray(sdk.partialResult.content) ? sdk.partialResult.content : []).flatMap((block: unknown) => block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string" ? [safe(block.text)] : []) : [])]);
    }
    if (sdk?.type === "tool_execution_end" || event.child.disposed) liveTools.delete(event.child.id);
    refresh();
  });
  const roster = () => coordinator.list().filter(child => lineText([child.id, child.parentId, child.profile, child.status, child.assignment, child.progress, child.result, child.error, child.model.id].join(" ")).toLowerCase().includes(query.toLowerCase()));
  const selection = () => {
    const children = roster();
    if (!children.some(child => child.id === selected)) selected = children[0]?.id;
    return children.find(child => child.id === selected);
  };
  const control = async (target: ChildRef, text?: string) => {
    notice = text === undefined ? "Stopping and draining…" : "Sending steering…"; refresh();
    try {
      const child = coordinator.snapshot(target);
      if (!child || child.status !== "running" || child.disposed) throw new Error(`Target ${target.id} #${target.generation} is no longer running; no action sent`);
      notice = text === undefined ? (await coordinator.stop(target), "Stopped and drained") : `Steering ${await coordinator.steer(target, text)}`;
    } catch (error) { notice = String(error); }
    refresh();
  };
  const finishInput = () => {
    if (mode === "search") query = lineText(input.getValue());
    else if (mode === "steer" && interactionTarget) void control(interactionTarget, input.getValue());
    interactionTarget = undefined;
    mode = "browse"; input.setValue(""); offset = 0; refresh();
  };
  return {
    focused: false,
    render(width) {
      width = Math.max(0, width);
      const height = Math.max(1, availableRows());
      const child = selection();
      const panelBg = oklchColor(colorToOklch(theme.colors.customMessageBg).l, 0, 0);
      const paint = (text: string) => {
        const clipped = truncateToWidth(text, width);
        const padded = clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
        return padded.split("\x1b[0m").map(part => theme.style(part, { bg: panelBg })).join("\x1b[0m");
      };
      if (width < 4 || height < 3) return [paint("FLEET " + coordinator.list().length)];
      const inner = Math.max(0, width - 4);
      const row = (text: string) => {
        const clipped = truncateToWidth(text, inner);
        return paint(theme.fg("border", "│") + " " + clipped + " ".repeat(Math.max(1, width - 3 - visibleWidth(clipped))) + theme.fg("border", "│"));
      };
      const frame = (left: string, title: string, right: string) => {
        const text = truncateToWidth(title, width - 2);
        return paint(theme.fg("border", left) + theme.fg("accent", text) + theme.fg("border", "─".repeat(Math.max(0, width - 2 - visibleWidth(text))) + right));
      };
      const body: string[] = [];
      const all = coordinator.list();
      const close = [...new Set([...keybindings.getKeys("tui.select.cancel"), ...keybindings.getKeys("tui.select.confirm")])].join("/");
      const hints = width < 60 ? ["↑↓ agent Tab view PgUp/Dn scroll", "/ search · s steer · x stop", `${close}: close`]
        : ["↑↓ select · Tab view · PgUp/Dn scroll", `${close}: close · / search · s steer · x stop`];
      const children = roster();
      const listHeight = Math.min(children.length, Math.max(1, Math.floor((height - 7) / 4)));
      const index = children.findIndex(item => item.id === selected);
      const start = Math.max(0, index - listHeight + 1);
      body.push(`Parent ${lineText(child?.parentId ?? coordinator.parentId)} · ${children.length}/${all.length} children`);
      for (const item of children.slice(start, start + listHeight)) body.push(`${item.id === selected ? ">" : " "} └ ${item.id.slice(0, 8)} ${item.profile} ${item.status} · ${lineText(item.assignment)}`);
      if (!children.length) body.push(query ? "No matching tasks · / to search again" : "No tasks · ask the model to delegate_task");
      if (all.some(item => item.writerLease)) body.push("WRITER: model tools only; no manual/external writes");
      body.push(`${tab.toUpperCase()}${query ? ` · filter: ${query}` : ""}${notice ? ` · ${lineText(notice)}` : ""}`);
      if (interactionTarget) body.push(...wrapTextWithAnsi(`Target: ${interactionTarget.id} #${interactionTarget.generation}`, Math.max(1, inner)));
      let detail: string[] = [];
      if (child) {
        if (tab === "inspector") {
          const metric = (value: unknown) => value === null || value === undefined ? "unavailable" : JSON.stringify(value);
          detail = [
            ...taskCard(child, true).slice(0, 2),
            `Elapsed ${Math.max(0, Math.floor(((child.endedAt ?? Date.now()) - child.createdAt) / 1000))}s · resources ${child.disposed ? "disposed" : "live"}`,
            `Direct requests ${metric(child.telemetry.requests)} · cost ${metric(child.telemetry.cost)}`,
            `Direct tokens ${metric(child.telemetry.tokens)}`, `Context ${metric(child.telemetry.context)}`,
            "No subtree totals: nesting is unavailable", "Assignment: " + safe(child.assignment), "Activity: " + safe(activity(child)),
            "Result: " + safe(child.result || child.error || "Not available yet"),
            "Full transcript: " + safe(child.transcript ?? "unavailable (setup)"),
            ...(child.writerLease ? [writerWarning] : []),
          ];
        } else {
          try {
            const messages = coordinator.messages(child);
            const partial = streaming.get(child.id);
            detail = [...transcriptLines(partial ? [...messages, partial] : messages, tab === "tools"), ...(liveTools.get(child.id) ?? [])];
          } catch (error) { detail = ["Transcript unavailable: " + safe(String(error))]; }
        }
      }
      const wrapped = detail.flatMap(text => safe(text).split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(1, inner))));
      viewport = Math.max(1, height - 2 - body.length - hints.length);
      offset = Math.max(0, Math.min(offset, wrapped.length - viewport));
      body.push(...wrapped.slice(offset, offset + viewport));
      while (body.length < height - 2 - hints.length) body.push("");
      if (mode === "search" || mode === "steer") {
        input.focused = this.focused;
        body.push(`${mode === "search" ? "Search" : "Steer"}:` + input.render(Math.max(1, inner - 7))[0]);
        body.push(...hints.slice(1, -1), "Enter submit · Esc back (no action)");
      } else if (mode === "stop") body.push("Stop target? y confirms", ...hints.slice(1, -1), "Esc back (no action)");
      else body.push(...hints);
      return [frame("╭", " Fleet / Agent Hub ", "╮"), ...body.slice(0, height - 2).map(text => row(theme.fg("text", text))), frame("╰", "", "╯")];
    },
    handleInput(data) {
      if (keybindings.matches(data, "tui.select.cancel")) {
        if (mode !== "browse") { mode = "browse"; interactionTarget = undefined; input.setValue(""); refresh(); } else done();
        return;
      }
      if (mode === "search" || mode === "steer") {
        if (keybindings.matches(data, "tui.select.confirm")) finishInput();
        else { input.handleInput(data); const cleaned = lineText(input.getValue()); if (cleaned !== input.getValue()) input.setValue(cleaned); refresh(); }
        return;
      }
      if (mode === "stop") {
        if (data === "y") { if (interactionTarget) void control(interactionTarget); interactionTarget = undefined; mode = "browse"; }
        refresh(); return;
      }
      if (keybindings.matches(data, "tui.select.confirm")) { done(); return; }
      if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.select.down")) {
        const children = roster();
        const index = children.findIndex(child => child.id === selected);
        selected = children[Math.max(0, Math.min(children.length - 1, index + (keybindings.matches(data, "tui.select.up") ? -1 : 1)))]?.id;
        offset = 0; notice = "";
      } else if (keybindings.matches(data, "tui.select.pageUp")) offset = Math.max(0, offset - viewport);
      else if (keybindings.matches(data, "tui.select.pageDown")) offset += viewport;
      else if (matchesKey(data, "home")) offset = 0;
      else if (matchesKey(data, "end")) offset = Number.MAX_SAFE_INTEGER;
      else if (matchesKey(data, "tab")) { tab = tab === "inspector" ? "transcript" : tab === "transcript" ? "tools" : "inspector"; offset = 0; }
      else if (data === "/") { mode = "search"; input.setValue(query); }
      else if (data === "s" || data === "x") {
        const child = selection();
        if (child?.status === "running" && !child.disposed) { mode = data === "s" ? "steer" : "stop"; interactionTarget = {id: child.id, generation: child.generation}; input.setValue(""); }
        else notice = "Controls unavailable: select a running task";
      }
      refresh();
    },
    invalidate() { input.invalidate(); },
    dispose() { disposed = true; interactionTarget = undefined; unsubscribe(); streaming.clear(); liveTools.clear(); },
  };
}
