import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import {
  AssistantMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  createReadToolDefinition,
  getMarkdownTheme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import {
  Text,
  ProcessTerminal,
  TuiMainScreen,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createNativeThread, nativeText } from "../src/thread.ts";
import type { DelegationCoordinator } from "../src/coordinator.ts";

test("native thread uses the main chat's exact user/assistant classes, formatting, cache and active-theme invalidation", (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  t.mock.method(tui, "requestRender", () => {});
  const thread = createNativeThread({ tui, cwd: process.cwd() });
  const userText = "# Review request\n\n1. inspect 中文 👩‍💻\n2. report findings";
  const assistant = fauxAssistantMessage([
    {
      type: "thinking",
      thinking: "Consider **constraints**",
      thinkingSignature: "PRIVATE_SIGNATURE",
    },
    {
      type: "text",
      text: "# Findings\n\n- **Clear result**\n- 中文 👩‍💻\n\n```ts\nconst answer = 42;\n```",
    },
  ]);
  const messages: ReturnType<DelegationCoordinator["messages"]> = [
    { role: "user", timestamp: 1, content: userText + "\x1b]52;c;secret\x07\x1b[91m" },
    assistant,
  ];
  const update = t.mock.method(AssistantMessageComponent.prototype, "updateContent");
  const output = thread.render("id/1", messages, undefined, undefined, 55);
  const updates = update.mock.callCount();
  assert.deepEqual(thread.render("id/1", messages, undefined, undefined, 55), output);
  assert.equal(
    update.mock.callCount(),
    updates,
    "unchanged native messages must reuse components/highlighting",
  );
  const expected = [
    new UserMessageComponent(userText, getMarkdownTheme()),
    new AssistantMessageComponent(assistant, false, getMarkdownTheme()),
  ].flatMap((component) =>
    component.render(55).flatMap((line) => wrapTextWithAnsi(nativeText(line), 55)),
  );
  assert.deepEqual(
    output,
    expected,
    "actual public main-thread classes, not a formatter facsimile",
  );
  assert.match(output.join("\n"), /\x1b\[38;/);
  assert.doesNotMatch(output.join("\n"), /\x1b\]133|\x1b\]52|\x1b\[91m|PRIVATE_SIGNATURE/);
  assert.ok(output.every((line) => visibleWidth(line) <= 55));
  initTheme("light", false);
  thread.invalidate();
  const light = thread.render("id/1", messages, undefined, undefined, 55);
  assert.notDeepEqual(
    light,
    output,
    "native singleton theme and cached components must follow real theme changes",
  );
  assert.match(strip(light.join("\n")), /const answer = 42/);
  const streamed = fauxAssistantMessage("Streaming **next**");
  assert.match(
    strip(thread.render("id/1", messages, streamed, undefined, 55).join("\n")),
    /Streaming next/,
  );
  thread.clear();
  initTheme("dark", false);
});

test("native builtin read rendering is identical to the actual public tool component and renderer-only definition", (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  t.mock.method(tui, "requestRender", () => {});
  const cwd = process.cwd(),
    args = { path: "sample.ts" };
  const message = fauxAssistantMessage(fauxToolCall("read", args, { id: "read-call" }), {
    stopReason: "toolUse",
  });
  const result = {
    role: "toolResult" as const,
    toolName: "read",
    toolCallId: "read-call",
    timestamp: 2,
    isError: false,
    content: [{ type: "text" as const, text: "export const value = 42;\n// 中文 👩‍💻" }],
    details: { private: "OPAQUE_DETAILS" },
  };
  const thread = createNativeThread({ tui, cwd });
  thread.setExpanded(true);
  const output = thread.render("id/1", [message, result], undefined, undefined, 55);
  const { renderShell, renderCall, renderResult } = createReadToolDefinition(cwd);
  const component = new ToolExecutionComponent(
    "read",
    "read-call",
    args,
    { showImages: false },
    {
      renderShell,
      renderCall,
      renderResult,
    } as import("@earendil-works/pi-coding-agent").ToolRenderers,
    tui,
    cwd,
  );
  component.setExpanded(true);
  component.setArgsComplete();
  component.updateResult({ content: result.content, isError: false });
  const expected = component.render(55).flatMap((line) => wrapTextWithAnsi(nativeText(line), 55));
  assert.deepEqual(output, expected);
  for (const appearance of ["dark", "light"] as const) {
    initTheme(appearance, false);
    thread.invalidate();
    component.invalidate();
    for (const width of [61, 56]) {
      for (const expanded of [false, true, false]) {
        thread.setExpanded(expanded);
        component.setExpanded(expanded);
        const actual = thread.render("id/1", [message, result], undefined, undefined, width);
        const reference = component
          .render(width)
          .flatMap((line) => wrapTextWithAnsi(nativeText(line), width));
        assert.deepEqual(actual, reference);
        t.diagnostic(
          `${appearance} ${width} columns ${expanded ? "expanded" : "collapsed"}: ${actual.length} native-matched rows`,
        );
      }
    }
  }
  initTheme("dark", false);
  thread.invalidate();
  thread.setExpanded(true);
  assert.match(strip(output.join("\n")), /export const value = 42/);
  assert.match(output.join("\n"), /\x1b\[/, "native syntax colors retained");
  assert.doesNotMatch(output.join("\n"), /OPAQUE_DETAILS/);
  const live = {
    toolCallId: "read-call",
    toolName: "read",
    args,
    content: [{ type: "text", text: "PARTIAL_NATIVE_RESULT" }],
  };
  assert.match(
    strip(thread.render("id/2", [message], undefined, live, 32).join("\n")),
    /PARTIAL_NATIVE_RESULT/,
  );
  const final = strip(
    thread.render("id/2", [message, result], undefined, undefined, 32).join("\n"),
  );
  assert.match(final, /export const value/);
  assert.doesNotMatch(final, /PARTIAL_NATIVE_RESULT/);
  thread.clear();
});

test("native edit renders only recorded safe diff without completed-args filesystem previews; generic results hide opaque/image payloads", async (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  const redraw = t.mock.method(tui, "requestRender", () => {});
  const completed = t.mock.method(ToolExecutionComponent.prototype, "setArgsComplete");
  const thread = createNativeThread({ tui, cwd: process.cwd() });
  const edit = fauxAssistantMessage(
    fauxToolCall(
      "edit",
      { path: "never-read-secret.ts", edits: [{ oldText: "before", newText: "after" }] },
      { id: "edit-call" },
    ),
    { stopReason: "toolUse" },
  );
  const output = thread.render(
    "id/1",
    [
      edit,
      {
        role: "toolResult",
        toolName: "edit",
        toolCallId: "edit-call",
        timestamp: 2,
        isError: false,
        content: [{ type: "text", text: "Successfully replaced text." }],
        details: {
          diff: "-1 before\n+1 after\x1b]52;c;PRIVATE\x07",
          firstChangedLine: 1,
          secret: "OPAQUE_DETAILS",
        },
      },
    ],
    undefined,
    undefined,
    55,
  );
  assert.equal(completed.mock.callCount(), 0, "edit must never trigger native cwd preview reads");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    redraw.mock.callCount(),
    0,
    "recorded diff projection has no async preview or clock",
  );
  const text = strip(output.join("\n"));
  assert.match(text, /before/);
  assert.match(text, /after/);
  assert.match(output.join("\n"), /\x1b\[/);
  assert.doesNotMatch(output.join("\n"), /PRIVATE|OPAQUE_DETAILS|\x1b\]52/);
  const generic = thread.render(
    "other/1",
    [
      {
        role: "toolResult",
        toolName: "submit_result",
        toolCallId: "submit",
        timestamp: 3,
        isError: true,
        content: [
          { type: "text", text: "ACTUAL FAILURE\x1b[2J\u202e" },
          { type: "image", mimeType: "image/png", data: "IMAGE_PAYLOAD" },
        ],
        details: { signature: "PRIVATE_SIGNATURE" },
      },
    ],
    undefined,
    undefined,
    32,
  );
  assert.match(strip(generic.join("\n")), /ACTUAL FAILURE/);
  assert.match(strip(generic.join("\n")), /payload\s+omitted/);
  assert.doesNotMatch(generic.join("\n"), /PRIVATE_SIGNATURE|IMAGE_PAYLOAD|\x1b\[2J|\u202e/);
  assert.ok(generic.every((line) => visibleWidth(line) <= 32));
  thread.clear();
});

test("native expansion survives cache reuse, live reconstruction, final/error/abort and generation switches without transcript mutation", (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  t.mock.method(tui, "requestRender", () => {});
  const thread = createNativeThread({ tui, cwd: process.cwd() });
  const args = { path: "sample.ts" };
  const message = fauxAssistantMessage(fauxToolCall("read", args, { id: "call" }), {
    stopReason: "toolUse",
  });
  const result = {
    role: "toolResult" as const,
    toolName: "read",
    toolCallId: "call",
    timestamp: 2,
    isError: false,
    content: [
      { type: "text" as const, text: Array.from({ length: 50 }, (_, i) => `BODY_${i}`).join("\n") },
    ],
  };
  const messages = [message, result];
  const original = structuredClone(messages);
  const live = { toolName: "read", toolCallId: "call", args, content: result.content };
  const render = (ref = "id/1", completed = true) =>
    strip(
      thread
        .render(ref, completed ? messages : [message], undefined, completed ? undefined : live, 56)
        .join("\n"),
    );
  assert.doesNotMatch(render(), /BODY_49/, "new threads default collapsed");
  const built = t.mock.method(ToolExecutionComponent.prototype, "setArgsComplete");
  thread.setExpanded(true);
  assert.match(render(), /BODY_49/);
  assert.equal(built.mock.callCount(), 0, "display changes reuse cached tool components");
  assert.match(render("id/1", false), /BODY_49/, "live reconstruction retains preference");
  assert.match(render(), /BODY_49/, "final reconstruction retains preference");
  const expandedLines = thread.render("id/1", messages, undefined, undefined, 56);
  const anchor = thread.anchorAt(
    expandedLines.findIndex((line) => strip(line).includes("BODY_40")),
  )!;
  thread.setExpanded(false);
  render();
  const summary = thread.offsetFor(anchor)!;
  assert.ok(summary >= 0 && summary < 4, "hidden anchor falls back to tool header");
  assert.doesNotMatch(
    render("id/2", false),
    /BODY_49/,
    "new generation inherits collapsed preference",
  );
  for (const expanded of [true, false]) {
    thread.setExpanded(expanded);
    for (const stopReason of ["error", "aborted"] as const) {
      const failure = { ...message, stopReason, errorMessage: "ACTUAL_FAILURE" };
      assert.match(
        strip(thread.render("id/2", [failure], undefined, undefined, 56).join("\n")),
        /ACTUAL_FAILURE/,
      );
    }
    result.isError = true;
    const failed = render("id/3");
    assert.equal(failed.includes("BODY_49"), expanded);
  }
  result.isError = false;
  assert.deepEqual(messages, original);
  assert.deepEqual(thread.render("empty/1", [], undefined, undefined, 12), []);
  thread.clear();
});

test("thread caches unchanged detached projections and rows, but observes finalized edits, resize, and streaming finalization", (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  t.mock.method(tui, "requestRender", () => {});
  const thread = createNativeThread({ tui, cwd: process.cwd() });
  const rendered = t.mock.method(AssistantMessageComponent.prototype, "render");
  const updated = t.mock.method(AssistantMessageComponent.prototype, "updateContent");
  const messages = Array.from({ length: 100 }, (_, i) => fauxAssistantMessage(`HISTORY_${i}`));
  const output = thread.render("cache/1", messages, undefined, undefined, 55);
  const renders = rendered.mock.callCount(),
    updates = updated.mock.callCount();
  assert.deepEqual(
    thread.render("cache/1", structuredClone(messages), undefined, undefined, 55),
    output,
  );
  assert.equal(
    rendered.mock.callCount(),
    renders,
    "no native layout or output sanitization for unchanged history",
  );
  assert.equal(updated.mock.callCount(), updates, "no repeated native projection updates");
  const narrow = thread.render("cache/1", messages, undefined, undefined, 24);
  assert.equal(rendered.mock.callCount(), renders + 100, "width invalidates rows only");
  assert.equal(updated.mock.callCount(), updates);
  assert.ok(narrow.every((line) => visibleWidth(line) <= 24));
  const changed = structuredClone(messages);
  changed[50].content = [{ type: "text", text: "CHANGED_FINAL\x1b]52;c;PRIVATE\x07" }];
  const edited = thread.render("cache/1", changed, undefined, undefined, 24);
  assert.equal(
    rendered.mock.callCount(),
    renders + 101,
    "only changed finalized message relayouts",
  );
  assert.equal(updated.mock.callCount(), updates + 1);
  assert.match(strip(edited.join("\n")), /CHANGED_FINAL/);
  assert.doesNotMatch(edited.join("\n"), /PRIVATE|HISTORY_50/);
  const partial = fauxAssistantMessage("LIVE_FIRST");
  thread.render("cache/1", changed, partial, undefined, 24);
  partial.content = [{ type: "text", text: "LIVE_SECOND" }];
  assert.match(
    strip(thread.render("cache/1", changed, partial, undefined, 24).join("\n")),
    /LIVE_SECOND/,
  );
  const beforeFinal = updated.mock.callCount();
  const final = thread.render(
    "cache/1",
    [...changed, structuredClone(partial)],
    undefined,
    undefined,
    24,
  );
  assert.equal(updated.mock.callCount(), beforeFinal + 1);
  assert.equal(
    updated.mock.calls.at(-1)?.arguments[1],
    false,
    "finalized partial leaves native streaming mode",
  );
  const reference = createNativeThread({ tui, cwd: process.cwd() });
  assert.deepEqual(
    final,
    reference.render("cache/1", [...changed, partial], undefined, undefined, 24),
  );
  thread.clear();
  reference.clear();
});

test("builtin rows stay cached with unrelated registrations and alongside custom tool rows", (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  t.mock.method(tui, "requestRender", () => {});
  const thread = createNativeThread({
    tui,
    cwd: process.cwd(),
    toolRenderers: { delegate_task: {} },
  });
  const rendered = t.mock.method(ToolExecutionComponent.prototype, "render");
  const messages = [
    {
      role: "toolResult" as const,
      toolCallId: "read-call",
      toolName: "read",
      timestamp: 1,
      isError: false,
      content: [{ type: "text" as const, text: "builtin output" }],
    },
  ];
  const output = thread.render("tools/1", messages, undefined, undefined, 55);
  assert.equal(rendered.mock.callCount(), 1);
  assert.equal(thread.hasCustomRenderers(), false);
  assert.deepEqual(thread.render("tools/1", messages, undefined, undefined, 55), output);
  assert.equal(rendered.mock.callCount(), 1, "unrelated registration does not bypass builtin rows");

  messages.push({ ...messages[0], toolCallId: "delegate-call", toolName: "delegate_task" });
  thread.render("tools/1", messages, undefined, undefined, 55);
  assert.equal(thread.hasCustomRenderers(), true);
  assert.equal(rendered.mock.callCount(), 2);
  thread.render("tools/1", messages, undefined, undefined, 55);
  assert.equal(rendered.mock.callCount(), 3, "only the custom row renders again");

  messages.pop();
  thread.render("tools/1", messages, undefined, undefined, 55);
  assert.equal(thread.hasCustomRenderers(), false, "removed custom rows no longer bypass caching");
  assert.equal(rendered.mock.callCount(), 3);
  thread.clear();
});

test("cache signatures omit opaque assistant metadata, thinking signatures, tool details and user/tool image payloads", (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  t.mock.method(tui, "requestRender", () => {});
  const thread = createNativeThread({ tui, cwd: process.cwd() });
  const assistant = fauxAssistantMessage([{ type: "thinking", thinking: "Visible thinking" }]);
  const unreadable = {
    get() {
      throw new Error("opaque field must not be read or serialized");
    },
  };
  Object.defineProperty(assistant, "providerMetadata", { ...unreadable, enumerable: true });
  Object.defineProperty(assistant.content[0], "thinkingSignature", {
    ...unreadable,
    enumerable: true,
  });
  const image = { type: "image" as const, mimeType: "image/png", data: "" };
  Object.defineProperty(image, "data", { ...unreadable, enumerable: true });
  const result = {
    role: "toolResult" as const,
    toolCallId: "image",
    toolName: "read",
    timestamp: 1,
    isError: false,
    content: [image],
    details: {},
  };
  Object.defineProperty(result.details, "private", { ...unreadable, enumerable: true });
  const messages = [assistant, { role: "user" as const, timestamp: 2, content: [image] }, result];
  const output = thread.render("safe/1", messages, undefined, undefined, 55);
  assert.deepEqual(thread.render("safe/1", messages, undefined, undefined, 55), output);
  assert.match(strip(output.join("\n")), /Visible thinking/);
  assert.match(strip(output.join("\n")), /payload omitted/);
  thread.clear();
});

test("custom tool renderer asynchronous invalidation is not hidden by cached thread rows", async (t) => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  const redraw = t.mock.method(tui, "requestRender", () => {});
  let content = "BEFORE_ASYNC",
    invalidate!: () => void;
  const thread = createNativeThread({
    tui,
    cwd: process.cwd(),
    toolRenderers: {
      custom: {
        renderResult: (_result, _options, _theme, context) => {
          invalidate = context.invalidate;
          return new Text(content, 0, 0);
        },
      },
    },
  });
  const messages = [
    {
      role: "toolResult" as const,
      toolCallId: "call",
      toolName: "custom",
      timestamp: 1,
      isError: false,
      content: [{ type: "text" as const, text: "result" }],
    },
  ];
  assert.match(
    strip(thread.render("custom/1", messages, undefined, undefined, 55).join("\n")),
    /BEFORE_ASYNC/,
  );
  await Promise.resolve();
  content = "AFTER_ASYNC";
  invalidate();
  assert.ok(redraw.mock.callCount() > 0);
  const output = strip(thread.render("custom/1", messages, undefined, undefined, 55).join("\n"));
  assert.match(output, /AFTER_ASYNC/);
  assert.doesNotMatch(output, /BEFORE_ASYNC/);
  thread.clear();
});
