import {
  AssistantMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  getMarkdownTheme,
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { DelegationCoordinator } from "./coordinator.ts";

export function safe(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g,
      " ",
    )
    .replaceAll("\t", "  ");
}

// Inputs are sanitized before native rendering. Only native SGR survives the output boundary,
// not OSC links/shell zones, image protocols or cursor-control sequences.
export function nativeText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .split(/(\x1b\[[0-9;:]*m)/g)
    .map((part, index) => (index % 2 ? part : safe(part)))
    .join("");
}
function safeValue(value: unknown): unknown {
  if (typeof value === "string") return safe(value);
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [safe(key), safeValue(item)]),
    );
  return value;
}

type Messages = ReturnType<DelegationCoordinator["messages"]>;
export type ThreadDependencies = Readonly<{
  tui: TUI;
  cwd: string;
  toolRenderers?: Readonly<Record<string, ToolRenderers>>;
}>;
export type ThreadAnchor = { ref: string; key: string; line: number };
export type LiveTool = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  content?: readonly { type: string; text?: string; mimeType?: string }[];
};
const textContent = (content: readonly { type: string; text?: string; mimeType?: string }[]) =>
  content.flatMap((block) =>
    block.type === "text"
      ? [{ type: "text", text: safe(block.text ?? "") }]
      : block.type === "image"
        ? [{ type: "text", text: `[image ${safe(block.mimeType ?? "unknown")}; payload omitted]` }]
        : [],
  );

/** Selected-generation readonly projection through the same public classes as Pi's main chat. */
export function createNativeThread({ tui, cwd, toolRenderers }: ThreadDependencies) {
  const renderers = new Map<string, ToolRenderers>(
    [
      createReadToolDefinition(cwd),
      createBashToolDefinition(cwd),
      createEditToolDefinition(cwd),
      createWriteToolDefinition(cwd),
      createGrepToolDefinition(cwd),
      createFindToolDefinition(cwd),
      createLsToolDefinition(cwd),
    ].map(({ name, renderShell, renderCall, renderResult }) => [
      name,
      { renderShell, renderCall, renderResult } as ToolRenderers,
    ]),
  );
  for (const [name, renderersForTool] of Object.entries(toolRenderers ?? {}))
    renderers.set(name, renderersForTool);
  const cache = new Map<string, { signature: string; component: Component }>();
  let generation: string | undefined;
  let expanded = false;
  let spans: { key: string; start: number; length: number }[] = [];
  return {
    setExpanded(value: boolean) {
      expanded = value;
      for (const { component } of cache.values())
        if (component instanceof ToolExecutionComponent) component.setExpanded(expanded);
    },
    anchorAt(offset: number): ThreadAnchor | undefined {
      const span = spans.find(({ start, length }) => offset >= start && offset < start + length);
      return span && generation
        ? { ref: generation, key: span.key, line: offset - span.start }
        : undefined;
    },
    offsetFor(anchor: ThreadAnchor): number | undefined {
      if (anchor.ref !== generation) return undefined;
      const span = spans.find(({ key }) => key === anchor.key);
      if (!span) return undefined;
      // A hidden tool body returns to its surviving header, not an unrelated later message.
      return span.start + (anchor.line < span.length ? anchor.line : 0);
    },
    render(
      ref: string,
      messages: Messages,
      partial: Messages[number] | undefined,
      live: LiveTool | undefined,
      width: number,
    ): string[] {
      if (generation !== ref) {
        cache.clear();
        generation = ref;
      }
      const used = new Set<string>();
      const components: { key: string; component: Component }[] = [];
      const append = (
        key: string,
        value: unknown,
        build: () => Component,
        update?: (component: Component) => void,
      ) => {
        const signature = JSON.stringify(value);
        let entry = cache.get(key);
        if (!entry || entry.signature !== signature) {
          if (entry && update) {
            update(entry.component);
            entry.signature = signature;
          } else {
            entry = { signature, component: build() };
            cache.set(key, entry);
          }
        }
        used.add(key);
        components.push({ key, component: entry.component });
      };
      const all = partial ? [...messages, partial] : messages;
      const results = new Map(
        all.flatMap((message) =>
          message.role === "toolResult" ? [[message.toolCallId, message] as const] : [],
        ),
      );
      const toolIds = new Set<string>();
      const tool = (name: string, id: string, args: unknown, failure?: string) => {
        if (toolIds.has(id)) return;
        toolIds.add(id);
        const result = results.get(id);
        const active = live?.toolCallId === id ? live : undefined;
        const content = result
          ? textContent(result.content)
          : active?.content
            ? textContent(active.content)
            : failure
              ? [{ type: "text", text: safe(failure) }]
              : undefined;
        // Only the documented edit diff is renderer input. Never pass arbitrary tool details.
        const details = result?.details;
        const diff =
          name === "edit" &&
          details &&
          typeof details === "object" &&
          "diff" in details &&
          typeof details.diff === "string"
            ? {
                diff: safe(details.diff),
                ...("firstChangedLine" in details && typeof details.firstChangedLine === "number"
                  ? { firstChangedLine: details.firstChangedLine }
                  : {}),
              }
            : undefined;
        const toolArgs = safeValue(active?.args ?? args);
        const output = content
          ? { content, details: diff, isError: result?.isError ?? !!failure }
          : undefined;
        append("tool:" + id, [name, toolArgs, output, !!active], () => {
          const component = new ToolExecutionComponent(
            safe(name),
            safe(id),
            toolArgs,
            { showImages: false },
            renderers.get(name),
            tui,
            cwd,
          );
          component.setExpanded(expanded);
          // Native edit's completed-args preview reads cwd files. Recorded result.diff is sufficient.
          if (name !== "edit") component.setArgsComplete();
          // Do not mark execution started: this observer must not invent elapsed clocks/timers.
          if (output) component.updateResult(output, !!active && !result);
          return component;
        });
      };
      all.forEach((message, index) => {
        if (message.role === "system") return;
        if (message.role === "assistant") {
          const content: typeof message.content = message.content.map((block) =>
            block.type === "text"
              ? { type: "text", text: safe(block.text) }
              : block.type === "thinking"
                ? { type: "thinking", thinking: safe(block.thinking) }
                : {
                    type: "toolCall",
                    id: safe(block.id),
                    name: safe(block.name),
                    arguments: safeValue(block.arguments) as typeof block.arguments,
                  },
          );
          const projected = {
            role: message.role,
            api: message.api,
            provider: message.provider,
            model: message.model,
            timestamp: message.timestamp,
            usage: message.usage,
            stopReason: message.stopReason,
            content,
            errorMessage: message.errorMessage ? safe(message.errorMessage) : undefined,
          };
          const streaming = message === partial;
          append(
            "assistant:" + index,
            [projected, streaming],
            () => {
              const component = new AssistantMessageComponent(projected, false, getMarkdownTheme());
              component.updateContent(projected, streaming);
              return component;
            },
            (component) =>
              (component as AssistantMessageComponent).updateContent(projected, streaming),
          );
          for (const block of message.content)
            if (block.type === "toolCall")
              tool(
                block.name,
                block.id,
                block.arguments,
                message.stopReason === "error" || message.stopReason === "aborted"
                  ? message.errorMessage || "Operation aborted"
                  : undefined,
              );
          if (
            message.errorMessage &&
            message.stopReason !== "error" &&
            message.stopReason !== "aborted"
          ) {
            append(
              "error:" + index,
              message.errorMessage,
              () => new Text("Error: " + safe(message.errorMessage!), 1, 0),
            );
          }
        } else if (message.role === "toolResult") {
          if (!toolIds.has(message.toolCallId)) tool(message.toolName, message.toolCallId, {});
        } else if ("content" in message) {
          const text =
            typeof message.content === "string"
              ? safe(message.content)
              : Array.isArray(message.content)
                ? textContent(message.content)
                    .map((block) => block.text)
                    .join("\n")
                : "";
          append("user:" + index, text, () => new UserMessageComponent(text, getMarkdownTheme()));
        }
      });
      if (live && !toolIds.has(live.toolCallId)) tool(live.toolName, live.toolCallId, live.args);
      for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);
      spans = [];
      const lines: string[] = [];
      for (const { key, component } of components) {
        const rendered = component
          .render(Math.max(12, width))
          .flatMap((line) => wrapTextWithAnsi(nativeText(line), Math.max(1, width)));
        spans.push({ key, start: lines.length, length: rendered.length });
        lines.push(...rendered);
      }
      return lines;
    },
    invalidate() {
      for (const entry of cache.values()) entry.component.invalidate();
    },
    clear() {
      cache.clear();
      generation = undefined;
      spans = [];
    },
  };
}
