import { stripVTControlCharacters as stripAnsi } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { createChildWidget, createHub, taskCard, transcriptLines, safe } from "../src/hub.ts";
import { DelegationCoordinator, type ChildRef, type ChildSnapshot } from "../src/coordinator.ts";
import { ProcessTerminal, TuiMainScreen, backgroundAnsi, oklchColor, styleText, visibleWidth } from "@earendil-works/pi-tui";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { initTheme, type ThemeStyle } from "@earendil-works/pi-coding-agent";

initTheme("dark", false);
const dependencies = {tui: new TuiMainScreen(new ProcessTerminal()), cwd: process.cwd()};
dependencies.tui.requestRender = () => {}; // Unstarted real TUI: no terminal writes in component tests.
const keys = { matches: (data: string, action: string) => data === "escape" && action === "tui.select.cancel",
  getKeys: () => ["escape" as const] };
const theme = { fg: (_color: string, text: string) => text,
  colors: { customMessageBg: oklchColor(0.3, 0.1, 330) },
  style: (text: string, { bg }: ThemeStyle) => {
    assert.ok(bg && typeof bg !== "string", "panel must supply a concrete neutral color");
    return styleText(text, { bg }, "truecolor");
  } };

test("hub frames, pads and paints every cell, adapts to tiny geometry and invalidates theme output", () => {
  const coordinator = new DelegationCoordinator("unused-render-only", "parent");
  let rows = 24;
  const palette = { ...theme, colors: { ...theme.colors } };
  const darkBg = backgroundAnsi(oklchColor(0.3, 0, 0), "truecolor");
  const hub = createHub(coordinator, palette,
    keys, () => {}, () => {}, dependencies, () => rows);
  try {
    for (const width of [0, 1, 2, 3, 4, 8, 20, 40, 80]) {
      for (rows of [1, 2, 3, 4, 5, 6, 7, 24]) {
        const rendered = hub.render(width);
        assert.ok(rendered.length <= rows);
        assert.ok(rendered.every(line => visibleWidth(line) === width));
        assert.ok(rendered.every(line => line.startsWith(darkBg) && line.endsWith("\x1b[49m")));
        if (width >= 4 && rows >= 3) {
          assert.match(rendered[0], /╭.*╮/);
          assert.match(rendered.at(-1)!, /╰.*╯/);
          assert.ok(rendered.slice(1, -1).every(line => line.includes("│ ") && line.includes(" │")));
        }
      }
    }
    rows = 24;
    assert.match(hub.render(80).join("\n"), /Fleet \/ Agent Hub/);
    assert.match(hub.render(80).join("\n"), /escape: close/);
    palette.colors.customMessageBg = oklchColor(0.9, 0.1, 330);
    hub.invalidate();
    const lightBg = backgroundAnsi(oklchColor(0.9, 0, 0), "truecolor");
    assert.ok(hub.render(80).every(line => line.startsWith(lightBg)));
  } finally { hub.dispose(); }
});

test("widget retains each child state, sanitizes terminal content and shows latest activity at narrow widths", () => {
  let child: ChildSnapshot | undefined;
  const widget = createChildWidget(() => child ? [child] : [], theme);
  assert.match(widget.render(100).join("\n"), /● Agents 0.*task-hub/);
  for (const status of ["queued", "setup", "running", "draining", "settled", "cancelled", "failed"] as const) {
    child = { depth: 1, limits: {deadlineMs: 600000, requests: 100, tools: 100, depth: 2, spawns: 8}, toolCalls: 0, tools: ["read"], createdAt: 1, endedAt: null, writerLease: false, id: "test", generation: 1, parentId: "parent", profile: "general", assignment: "test", activity: "", model: {provider: "test", id: "test"}, effort: "off", telemetry: {requests: null, tokens: null, cost: null, context: null}, status, progress: "old activity ".repeat(20) + "中文 👩‍💻 latest\u001b\u0007", result: "final result", disposed: ["settled", "failed", "cancelled"].includes(status) };
    const output = widget.render(80).join("\n");
    assert.ok(output.includes(status));
    assert.ok(widget.render(20)[0].startsWith("● Agents"));
    assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(stripAnsi(output).replaceAll("\n", "")));
    if (status === "running") { assert.ok(output.includes("test")); assert.match(output, /中文 👩‍💻 latest/); }
    else if (child.disposed) assert.ok(output.includes("final result"));
    for (const width of [0, 1, 2, 8, 20, 40]) assert.ok(widget.render(width).every(line => visibleWidth(line) <= width));
  }
  child = { ...child!, status: "running", profile: "implementation", writerLease: true, disposed: false };
  assert.match(widget.render(100).join("\n"), /no conflicting manual !\/!! or external edits/);
  child = { ...child!, status: "failed", error: "Cannot start\u001b\u0007" };
  assert.match(widget.render(140).join("\n"), /Cannot start/);
});

function snapshot(id: string, patch: Partial<ChildSnapshot> = {}): ChildSnapshot {
  return { id, depth: 1, limits: {deadlineMs: 600000, requests: 100, tools: 100, depth: 2, spawns: 8}, toolCalls: 0, tools: ["read"], generation: 1, parentId: "root", status: "running", profile: "scout", assignment: "inspect " + id,
    activity: "Tool: read", progress: "streaming", result: "", model: {provider: "controlled", id: "model"}, effort: null,
    telemetry: {requests: null, tokens: null, cost: null, context: null}, disposed: false, createdAt: 1000, endedAt: null, writerLease: false, ...patch };
}
const effectiveKeys = { matches: (data: string, action: string) => data === ({"tui.select.cancel": "\x1b", "tui.select.confirm": "\r", "tui.select.up": "\x1b[A", "tui.select.down": "\x1b[B", "tui.select.pageUp": "\x1b[5~", "tui.select.pageDown": "\x1b[6~"} as Record<string,string>)[action], getKeys: () => ["escape" as const, "enter" as const] };

test("fleet counts every lifecycle, bounds height independently of task count, and shows actual lease not profile", () => {
  const children = [snapshot("reader", {profile: "implementation"}), ...["setup", "running", "settled", "failed", "cancelled"].map(status => snapshot(status, {status: status as ChildSnapshot["status"], disposed: status !== "running" && status !== "setup"}))];
  const widget = createChildWidget(() => children, theme);
  const text = stripAnsi(widget.render(180).join("\n"));
  assert.match(text, /● Agents 6/); assert.match(text, /2 running/); assert.match(text, /1 failed/);
  assert.doesNotMatch(text, /no conflicting/);
  children[0] = {...children[0], writerLease: true};
  assert.match(widget.render(180).join("\n"), /no conflicting/);
  for (const rows of [4, 8, 16, 30]) assert.ok(createChildWidget(() => children, theme, () => rows).render(40).length <= Math.max(1, Math.floor(rows / 4)));
});

test("Hub selection survives streaming/new completion; search, tabs, full transcript scroll and controls use selected generation", async t => {
  const coordinator = new DelegationCoordinator("unused", "root");
  let children = [snapshot("first"), snapshot("second", {generation: 7})];
  let listener: Parameters<DelegationCoordinator["subscribe"]>[0] | undefined;
  let detached = false, closed = 0, renders = 0;
  const calls: unknown[] = [];
  t.mock.method(coordinator, "list", () => structuredClone(children));
  t.mock.method(coordinator, "snapshot", (ref: ChildRef) => structuredClone(children.find(child => child.id === ref.id && child.generation === ref.generation)));
  t.mock.method(coordinator, "subscribe", (cb: Parameters<DelegationCoordinator["subscribe"]>[0]) => { listener = cb; return () => {detached = true;}; });
  t.mock.method(coordinator, "messages", () => [{role: "user", content: Array.from({length: 100}, (_, i) => `FULL LINE ${i} 中文`).join("\n"), timestamp: 1}]);
  t.mock.method(coordinator, "steer", async (ref: ChildRef, text: string) => { calls.push([ref.id, ref.generation, text]); return "queued"; });
  t.mock.method(coordinator, "stop", async (ref: ChildRef) => {calls.push([ref.id, ref.generation, "stop"]);});
  const hub = createHub(coordinator, theme, effectiveKeys, () => renders++, () => closed++, dependencies, () => 20);
  const output = () => stripAnsi(hub.render(100).join("\n"));
  assert.match(output(), /> └ inspect first/);
  hub.handleInput!("\x1b[B"); assert.match(output(), /> └ inspect second/);
  children = [...children, snapshot("new", {status: "settled", disposed: true})];
  listener!({type: "changed", child: children[2]}); assert.match(output(), /> └ inspect second/);
  assert.doesNotMatch(output(), /Direct requests/);
  assert.match(output(), /FULL LINE 99/);
  hub.handleInput!("\x1b[H"); assert.match(output(), /FULL LINE 0/);
  hub.handleInput!("\x1b[6~"); assert.doesNotMatch(output(), /FULL LINE 0 /);
  hub.handleInput!("\x1b[F"); assert.match(output(), /FULL LINE 99/);
  hub.handleInput!("\t"); hub.handleInput!("\x1b[F"); assert.match(output(), /Direct requests unavailable/);
  hub.handleInput!("\t"); assert.match(output(), /TOOLS/);
  hub.handleInput!("s"); hub.handleInput!("new direction"); assert.match(output(), /Target: second #7/); hub.handleInput!("\r");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0], ["second", 7, "new direction"]);
  hub.handleInput!("x"); hub.handleInput!("\r"); assert.equal(calls.length, 1, "Enter never confirms stop");
  hub.handleInput!("\x1b"); hub.handleInput!("x"); assert.match(output(), /Target: second #7/); hub.handleInput!("y");
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls[1], ["second", 7, "stop"]);
  hub.handleInput!("/"); hub.handleInput!("first"); hub.handleInput!("\r"); assert.match(output(), /> └ inspect first/); assert.doesNotMatch(output(), /└ inspect second/);
  hub.handleInput!("\r"); hub.handleInput!("\x1b"); assert.equal(closed, 2);
  assert.equal(calls.length, 2, "navigation/closing never invokes controls");
  hub.dispose(); assert.ok(detached); assert.ok(renders > 0);
});

test("cards and transcript project real messages and sanitize controls/bidi without exposing opaque provider payloads", () => {
  const child = snapshot("card", {transcript: "/session/transcript.jsonl", error: "Failed\x1b[31m\u202e"});
  assert.match(taskCard(child, true).join("\n"), /inspect card.*scout #1.*running/);
  assert.match(taskCard(child).join("\n"), /Full transcript/);
  assert.equal(safe("a\x1b]52;c;secret\x07b\x1b[31m\u200f"), "ab ");
  const messages: ReturnType<DelegationCoordinator["messages"]> = [
    {role: "assistant", content: [{type:"toolCall", id:"call", name:"read\x1b[31m", arguments:{path:"real.ts"}}], api:"x", model:"x", provider:"x", timestamp:1, stopReason:"toolUse", usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}},
    {role:"toolResult",toolCallId:"call",toolName:"read",content:[{type:"text",text:"ACTUAL OUTPUT\x1b[31m"}], details:{credentials:"NOT FOR DISPLAY"},isError:true,timestamp:2},
  ];
  const text = transcriptLines(messages, true).join("\n");
  assert.match(text, /Tool read call/); assert.match(text, /real.ts/); assert.match(text, /ERROR/); assert.match(text, /ACTUAL OUTPUT/);
  assert.doesNotMatch(text, /NOT FOR DISPLAY|\x1b|\u202e/);
});

for (const action of ["steer", "stop", "message"] as const) {
  test(`Hub ${action} pins the original target across filter changes and refuses stale generations`, async t => {
    const coordinator = new DelegationCoordinator("unused", "root");
    let children = [snapshot("A", {generation: 7}), snapshot("B", {generation: 9})];
    const dispatches: ChildRef[] = [];
    const lookups: ChildRef[] = [];
    t.mock.method(coordinator, "list", () => structuredClone(children));
    t.mock.method(coordinator, "snapshot", (ref: ChildRef) => {
      lookups.push({...ref});
      const child = children.find(child => child.id === ref.id);
      if (!child || child.generation !== ref.generation) throw new Error("Unknown or stale delegation identity");
      return structuredClone(child);
    });
    t.mock.method(coordinator, "steer", async (ref: ChildRef) => { dispatches.push({...ref}); return "queued"; });
    t.mock.method(coordinator, "stop", async (ref: ChildRef) => { dispatches.push({...ref}); });
    t.mock.method(coordinator, "message", async (_actor: ChildRef | undefined, ref: ChildRef | undefined) => { dispatches.push({...ref!}); throw new Error("unexpected message dispatch"); });
    const hub = createHub(coordinator, theme, effectiveKeys, () => {}, () => {}, dependencies, () => 24);
    const render = () => stripAnsi(hub.render(100).join("\n"));
    const begin = () => {
      render();
      hub.handleInput!(action === "steer" ? "s" : action === "message" ? "m" : "x");
      if (action !== "stop") hub.handleInput!("original target only");
      assert.match(render(), /Target: A #7/);
    };
    const submit = async () => {
      hub.handleInput!(action !== "stop" ? "\r" : "y");
      await new Promise(resolve => setImmediate(resolve));
    };
    try {
      hub.handleInput!("/"); hub.handleInput!("running"); hub.handleInput!("\r");
      begin();
      children[0] = {...children[0], status: "settled", disposed: true};
      assert.match(render(), /> └ inspect B/, "ordinary roster fallback still works");
      assert.match(render(), /Target: A #7/, "confirmation/input still identifies original target");
      await submit();
      assert.deepEqual(lookups, [{id: "A", generation: 7}]);
      assert.deepEqual(dispatches, [], "neither B nor settled A receives the action");
      assert.match(render(), /no longer running; no action sent/);
      assert.doesNotMatch(render(), /Target:/, "submit clears pinned target");

      children = [snapshot("A", {generation: 7}), snapshot("B", {generation: 9})];
      hub.handleInput!("\x1b[A");
      begin();
      children[0] = {...children[0], generation: 8};
      await submit();
      assert.deepEqual(lookups.at(-1), {id: "A", generation: 7}, "must not silently upgrade target generation");
      assert.deepEqual(dispatches, []);
      assert.match(render(), /Unknown or stale delegation identity/);

      children[0] = {...children[0], generation: 7};
      begin(); children[0] = {...children[0], status: "draining"};
      await submit();
      assert.deepEqual(dispatches, [], "a target that starts draining during input refuses every action");
      assert.match(render(), /no action sent/);
      hub.handleInput!("/"); hub.handleInput!("\x15"); hub.handleInput!("draining"); hub.handleInput!("\r");
      hub.handleInput!(action === "steer" ? "s" : action === "message" ? "m" : "x");
      assert.match(render(), /Controls unavailable/, "already draining targets cannot open controls");
      children[0] = {...children[0], status: "running"};
      hub.handleInput!("/"); hub.handleInput!("\x15"); hub.handleInput!("running"); hub.handleInput!("\r");
      hub.handleInput!("\x1b[A");
      begin(); hub.handleInput!("\x1b");
      assert.doesNotMatch(render(), /Target:/, "cancel clears pinned target");
      hub.handleInput!("\x1b[B");
      hub.handleInput!(action === "steer" ? "s" : action === "message" ? "m" : "x");
      assert.match(render(), /Target: B #9/, "next interaction captures its own target");
    } finally { hub.dispose(); }
  });
}

test("Hub opens with agents on the left and the selected full thread on the right; narrow fallback preserves reading", t => {
  const coordinator = new DelegationCoordinator("unused", "root");
  const children = Array.from({length: 12}, (_, index) => snapshot(`agent-${index}`, {assignment: `Assignment ${index} 中文 👩‍💻`}));
  t.mock.method(coordinator, "list", () => children);
  t.mock.method(coordinator, "messages", (ref: ChildRef) => [{role: "user", timestamp: 1, content: Array.from({length: 90}, (_, index) => `${ref.id} THREAD LINE ${index} 中文`).join("\n")}]);
  let rows = 27;
  const hub = createHub(coordinator, theme, effectiveKeys, () => {}, () => {}, dependencies, () => rows);
  const render = (width = 90) => hub.render(width).map(stripAnsi);
  try {
    const wide = render();
    const adjacent = wide.find(line => line.includes("AGENTS") && line.includes("Assignment 0"));
    assert.ok(adjacent, "selection heading and selected identity must share the same physical row");
    assert.ok(wide.some(line => line.includes("> └ Assignment 0") && line.includes("THREAD")), "left roster and right view must be adjacent");
    assert.match(wide.join("\n"), /agent-0 THREAD LINE 89/);
    assert.doesNotMatch(wide.join("\n"), /Direct tokens|Limits \{|Prewalk/);
    assert.ok(wide.every(line => visibleWidth(line) === 90));
    const left = wide.slice(1, -1).map(line => line.split("│")[1]);
    hub.handleInput!("\x1b[5~");
    assert.match(render().join("\n"), /agent-0 THREAD LINE/);
    assert.deepEqual(render().slice(1, -1).map(line => line.split("│")[1]), left, "thread scrolling must not scroll the roster");
    for (let index = 0; index < 10; index++) hub.handleInput!("\x1b[B");
    assert.match(render().join("\n"), /> └ Assignment 10/);
    assert.match(render().join("\n"), /agent-10 THREAD LINE 89/);
    rows = 14;
    const narrow = render(36);
    assert.ok(narrow.every(line => visibleWidth(line) === 36));
    assert.ok(narrow.length <= rows);
    assert.match(narrow.join("\n"), /> └ Assignment 10/);
    assert.match(narrow.join("\n"), /THREAD LINE 89/);
    assert.doesNotMatch(narrow.join("\n"), /AGENTS/);
  } finally {hub.dispose();}
});

test("Hub full thread preserves role/thinking/tool/error text, isolates ANSI and holds reading position through streamed deltas", t => {
  const coordinator = new DelegationCoordinator("unused", "root");
  const child = snapshot("content");
  let listener!: Parameters<DelegationCoordinator["subscribe"]>[0];
  t.mock.method(coordinator, "subscribe", (callback: Parameters<DelegationCoordinator["subscribe"]>[0]) => { listener = callback; return () => {}; });
  t.mock.method(coordinator, "list", () => [child]);
  let messages: ReturnType<DelegationCoordinator["messages"]> = [{role: "user", timestamp: 1,
    content: Array.from({length: 60}, (_, index) => `USER_BODY${index} 正文👩‍💻\x1b[91m\x1b]52;c;SECRET\x07\u202e`).join("\n")}];
  t.mock.method(coordinator, "messages", () => messages);
  const palette = {...theme, fg: (_color: string, text: string) => `\x1b[32m${text}\x1b[0m`};
  let rows = 27;
  const hub = createHub(coordinator, palette, effectiveKeys, () => {}, () => {}, dependencies, () => rows);
  const render = (width = 90) => hub.render(width);
  const plain = () => render().map(stripAnsi);
  try {
    render(); hub.handleInput!("\x1b[H"); hub.handleInput!("\x1b[6~");
    const before = plain().filter(line => line.includes("USER_BODY"));
    const partial = fauxAssistantMessage("STREAMING_SENTINEL");
    listener({type: "sdk", child, event: {type: "message_update", message: partial,
      assistantMessageEvent: {type: "text_delta", contentIndex: 0, delta: "STREAMING_SENTINEL", partial}}});
    assert.deepEqual(plain().filter(line => line.includes("USER_BODY")), before, "appending a stream must not jump the reading position");
    hub.handleInput!("\x1b[F"); assert.match(plain().join("\n"), /STREAMING_SENTINEL/);
    const assistant = fauxAssistantMessage([
      {type: "thinking", thinking: "THINKING_SENTINEL", thinkingSignature: "SIGNATURE_SECRET"},
      {type: "text", text: "ASSISTANT_SENTINEL\n" + "正文👩‍💻".repeat(60)},
      fauxToolCall("read", {path: "visible.ts"}),
    ]);
    messages = [...messages, assistant, {role: "toolResult", toolCallId: "read-call", toolName: "read", isError: true, timestamp: 2,
      content: [{type: "text", text: "RESULT_END\x1b[91m"}, {type: "image", data: "IMAGE_BASE64_SECRET", mimeType: "image/png"}], details: {private: "TOOL_DETAILS_SECRET"}},
      {...fauxAssistantMessage("FINAL_SENTINEL"), errorMessage: "ERROR_SENTINEL"}];
    listener({type: "sdk", child, event: {type: "message_end", message: partial}});
    hub.handleInput!("\x1b[H");
    const pages: string[] = [];
    for (let page = 0; page < 12; page++) { pages.push(plain().join("\n")); hub.handleInput!("\x1b[6~"); }
    const full = pages.join("\n");
    for (const content of ["USER_BODY0", "THINKING_SENTINEL", "ASSISTANT_SENTINEL", "visible.ts", "RESULT_END", "payload omitted", "FINAL_SENTINEL", "ERROR_SENTINEL"]) assert.ok(full.includes(content), content);
    assert.doesNotMatch(full, /SIGNATURE_SECRET|TOOL_DETAILS_SECRET|IMAGE_BASE64_SECRET|SECRET|\u202e/);
    for (const width of [0, 1, 3, 8, 36, 40, 75, 76, 90, 200]) for (rows of [1, 4, 8, 14, 27]) {
      const lines = render(width);
      assert.ok(lines.length <= rows);
      for (const line of lines) {
        assert.equal(visibleWidth(line), width, `${width} columns, ${rows} rows`);
        assert.doesNotMatch(line, /\x1b\[91m|\x1b\]52|\u202e|\x1b\[0m(?!\x1b\[48;)/);
        assert.doesNotMatch(line, /\x1b\[49m(?!\x1b\[0m|$)/, "native background resets must restore the neutral outer panel");
      }
    }
  } finally {hub.dispose();}
});

test("Hub empty, filtered, queued/setup and terminal threads explain unavailable transcript without allocating work", t => {
  const coordinator = new DelegationCoordinator("unused", "root");
  let children: ChildSnapshot[] = [];
  t.mock.method(coordinator, "list", () => children);
  t.mock.method(coordinator, "messages", () => []);
  const hub = createHub(coordinator, theme, effectiveKeys, () => {}, () => {}, dependencies);
  const output = () => stripAnsi(hub.render(90).join("\n"));
  try {
    assert.match(output(), /No tasks/);
    for (const status of ["queued", "setup", "draining", "settled", "failed", "cancelled"] as const) {
      children = [snapshot(status, {status, error: status === "failed" ? "ACTUAL FAILURE" : undefined, disposed: ["settled", "failed", "cancelled"].includes(status)})];
      assert.match(output(), new RegExp(status));
      assert.match(output(), status === "queued" ? /no SDK messages yet/ : status === "failed" ? /ACTUAL FAILURE/ : /Waiting for SDK messages/);
    }
    hub.handleInput!("/"); hub.handleInput!("unmatched"); hub.handleInput!("\r");
    assert.match(output(), /No matching tasks/);
  } finally {hub.dispose();}
});

test("Hub prefilled filter editing starts at the native Input end after an empty control is cancelled", t => {
  const coordinator = new DelegationCoordinator("unused", "root");
  t.mock.method(coordinator, "list", () => [snapshot("one", {assignment: "alpha"}), snapshot("two", {assignment: "alpha beta"})]);
  t.mock.method(coordinator, "messages", () => []);
  const hub = createHub(coordinator, theme, effectiveKeys, () => {}, () => {}, dependencies);
  const output = () => stripAnsi(hub.render(90).join("\n"));
  try {
    output(); hub.handleInput!("/"); hub.handleInput!("alpha"); hub.handleInput!("\r");
    hub.handleInput!("s"); hub.handleInput!("\x1b"); // Input cursor is now at zero, filter is still "alpha".
    hub.handleInput!("/"); hub.handleInput!(" beta"); hub.handleInput!("\r");
    assert.match(output(), /Filter: alpha beta · 1 generations/);
    assert.match(output(), /> └ alpha beta.*scout #1/);
    hub.handleInput!("/"); hub.handleInput!("\x15"); hub.handleInput!("alpha"); hub.handleInput!("\r");
    assert.match(output(), /Filter: alpha · 2 generations/, "native Ctrl+U replaces a prefilled filter without an extra cursor workaround");
  } finally {hub.dispose();}
});

for (const action of ["stop", "steer", "message"] as const) {
  test(`Hub ${action} keeps the full original target visible at short height and blocks hidden controls until resize`, async t => {
    const coordinator = new DelegationCoordinator("unused", "root");
    const a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    let children = [snapshot(a, {assignment: "alpha", generation: 7, progress: "match"}), snapshot(b, {assignment: "beta", generation: 9, progress: "match"})];
    const calls: ChildRef[] = [];
    t.mock.method(coordinator, "list", () => structuredClone(children));
    t.mock.method(coordinator, "messages", () => []);
    t.mock.method(coordinator, "snapshot", (ref: ChildRef) => children.find(child => child.id === ref.id && child.generation === ref.generation));
    t.mock.method(coordinator, "stop", async (ref: ChildRef) => { calls.push({...ref}); });
    t.mock.method(coordinator, "steer", async (ref: ChildRef) => { calls.push({...ref}); return "queued"; });
    t.mock.method(coordinator, "message", async (_actor: ChildRef | undefined, ref: ChildRef | undefined) => { calls.push({...ref!}); throw new Error("receipt fixture"); });
    let rows = 8, width = 90;
    const hub = createHub(coordinator, theme, effectiveKeys, () => {}, () => {}, dependencies, () => rows);
    const render = () => {
      const lines = hub.render(width);
      assert.ok(lines.length <= rows);
      assert.ok(lines.every(line => visibleWidth(line) === width));
      return stripAnsi(lines.join("\n"));
    };
    const begin = () => { hub.handleInput!(action === "stop" ? "x" : action === "steer" ? "s" : "m"); if (action !== "stop") hub.handleInput!("original payload"); };
    const submit = async () => { hub.handleInput!(action === "stop" ? "y" : "\r"); await new Promise(resolve => setImmediate(resolve)); };
    try {
      render(); hub.handleInput!("/"); hub.handleInput!("match"); hub.handleInput!("\r");
      begin(); children[0] = {...children[0], progress: "no hit"};
      await submit(); assert.deepEqual(calls, [], "a newly opened but not yet displayed target cannot authorize dispatch");
      const short = render();
      assert.match(short, /> └ beta.*scout #9/);
      assert.ok(short.includes(`Target: ${a} #7`), "full pinned identity must outrank filter/status hints at height 8");
      await submit(); assert.deepEqual(calls, [{id: a, generation: 7}]);

      children[0] = {...children[0], progress: "match"}; render(); hub.handleInput!("\x1b[A"); begin();
      children[0] = {...children[0], progress: "no hit"}; render(); rows = 4; width = 20;
      await submit(); assert.equal(calls.length, 1, "shrinking before redraw also blocks submission");
      assert.match(render(), /Resize/);
      await submit(); assert.equal(calls.length, 1, "hidden UUID cannot authorize confirmation/input submission");
      rows = 27; width = 90;
      assert.ok(render().includes(`Target: ${a} #7`), "resize must retain the original pin and input");
      await submit(); assert.deepEqual(calls, [{id: a, generation: 7}, {id: a, generation: 7}]);

      begin(); rows = 4; width = 20; render(); hub.handleInput!("\x1b");
      rows = 14; width = 36;
      assert.doesNotMatch(render(), /Target:/, "cancel clears the blocked interaction");
      begin(); const reset = render();
      assert.ok(reset.replaceAll("\n", "").replaceAll("│", "").replaceAll(" ", "").includes(`Target:${b}#9`), "new interaction pins B, not cancelled A");
      hub.handleInput!("\x1b"); assert.equal(calls.length, 2);
    } finally {hub.dispose();}
  });
}

test("human assignment/role labels distinguish same-role agents without changing identity search or full readonly access", t => {
  const coordinator = new DelegationCoordinator("unused", "root");
  const a = snapshot("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {assignment:"# Audit parser\nFull original assignment",profile:"review"});
  const b = snapshot("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", {assignment:"Audit scheduler",profile:"review"});
  t.mock.method(coordinator,"list",()=>[a,b]);
  t.mock.method(coordinator,"messages",()=>[fauxAssistantMessage(fauxToolCall("write",{path:"result.ts",content:"const result = 1;"},{id:"write-call"}),{stopReason:"toolUse"}),
    {role:"toolResult",toolName:"write",toolCallId:"write-call",timestamp:2,isError:false,content:[{type:"text",text:"Successfully wrote complete text."}]}]);
  const hub=createHub(coordinator,theme,effectiveKeys,()=>{},()=>{},dependencies,()=>27);
  const output=()=>stripAnsi(hub.render(90).join("\n"));
  try {
    const initial=output();assert.match(initial,/> └ Audit parser/);assert.match(initial,/Audit scheduler/);
    assert.doesNotMatch(initial,/aaaaaaaa|bbbbbbbb|Full original assignment/);
    const widget=createChildWidget(()=>[a,b],theme,()=>30).render(180).join("\n");
    assert.match(widget,/review.*Audit parser/);assert.match(widget,/review.*Audit scheduler/);assert.doesNotMatch(widget,/aaaaaaaa|bbbbbbbb/);
    hub.handleInput!("\t");assert.ok(output().includes(`Identity ${a.id} #1`));
    hub.handleInput!("\t");hub.handleInput!("\x1b[F");assert.match(output(),/Successfully wrote complete text/);
    hub.handleInput!("/");hub.handleInput!(b.id);hub.handleInput!("\r");
    assert.match(output(),/> └ Audit scheduler/);assert.doesNotMatch(output(),/> └ Audit parser/);
  } finally {hub.dispose();}
});

test("Hub native thread opens at live tail, detaches for laptop/page reading, follows updates and resumes on End", async t => {
  const coordinator=new DelegationCoordinator("unused","root");
  const child=snapshot("reader",{assignment:"Read newest output"});
  let messages: ReturnType<DelegationCoordinator["messages"]>=[{role:"user",timestamp:1,content:Array.from({length:100},(_,i)=>`NAV_LINE_${i}`).join("\n")}];
  let listener!: Parameters<DelegationCoordinator["subscribe"]>[0];
  t.mock.method(coordinator,"list",()=>[child]);t.mock.method(coordinator,"messages",()=>messages);
  t.mock.method(coordinator,"subscribe",(callback: typeof listener)=>{listener=callback;return()=>{};});
  t.mock.method(coordinator,"snapshot",()=>child);
  const steered: string[]=[];t.mock.method(coordinator,"steer",async(_ref:ChildRef,text:string)=>{steered.push(text);return "queued";});
  let rows=27;
  const hub=createHub(coordinator,theme,effectiveKeys,()=>{},()=>{},dependencies,()=>rows);
  const output=(width=90)=>stripAnsi(hub.render(width).join("\n"));
  const lines=()=>output().split("\n").filter(line=>line.includes("NAV_LINE_"));
  try {
    assert.match(output(),/NAV_LINE_99/);assert.match(output(),/LIVE/);
    hub.handleInput!("k");assert.match(output(),/READING/);
    hub.handleInput!("j");assert.match(output(),/LIVE/,"reaching bottom resumes follow visibly");
    hub.handleInput!("\x1b[5~");assert.match(output(),/READING/);assert.doesNotMatch(output(),/NAV_LINE_99/);
    hub.handleInput!("k");const before=lines();
    messages=[...messages,fauxAssistantMessage("NEWEST_MESSAGE")];
    assert.deepEqual(lines(),before,"appending messages must not move a detached reader");
    hub.handleInput!("j");assert.notDeepEqual(lines(),before,"laptop line scrolling moves content, not agents");
    hub.handleInput!("\x15");assert.match(output(),/READING/);
    hub.handleInput!("\x04");assert.match(output(),/READING/);
    hub.handleInput!("\x1b[F");assert.match(output(),/NEWEST_MESSAGE/);assert.match(output(),/LIVE/);
    const partial=fauxAssistantMessage("PARTIAL_NEWEST");
    listener({type:"sdk",child,event:{type:"message_update",message:partial,assistantMessageEvent:{type:"text_delta",contentIndex:0,delta:"PARTIAL_NEWEST",partial}}});
    assert.match(output(),/PARTIAL_NEWEST/);
    rows=14;assert.match(output(36),/PARTIAL_NEWEST/);assert.match(output(36),/LIVE/);
    messages=[...messages,partial];listener({type:"sdk",child,event:{type:"message_end",message:partial}});
    assert.match(output(36),/PARTIAL_NEWEST/);assert.match(output(36),/LIVE/);
    rows=27;hub.handleInput!("\t");assert.match(output(),/Identity reader #1/);assert.doesNotMatch(output(),/LIVE/);
    hub.handleInput!("\t");hub.handleInput!("\t");assert.match(output(),/LIVE/);
    hub.handleInput!("s");hub.handleInput!("j");hub.handleInput!("k");output();hub.handleInput!("\r");
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(steered,["jk"],"navigation aliases must not steal native input");
  } finally {hub.dispose();}
});

test("Hub normalized wheel is contained to its reading viewport, never the roster or underlying chat", t => {
  const coordinator=new DelegationCoordinator("unused","root");
  t.mock.method(coordinator,"list",()=>[snapshot("one"),snapshot("two")]);
  t.mock.method(coordinator,"messages",()=>[{role:"user",timestamp:1,content:Array.from({length:100},(_,i)=>`WHEEL_LINE_${i}`).join("\n")}]);
  const hub=createHub(coordinator,theme,effectiveKeys,()=>{},()=>{},dependencies,()=>27);
  const output=()=>stripAnsi(hub.render(90).join("\n"));
  const event={type:"wheel" as const,button:"none" as const,x:40,y:5,screenX:45,screenY:7,width:90,height:27,shift:false,alt:false,ctrl:false,wheelDelta:-3};
  try {
    output();assert.equal(hub.handleMouse?.(event)?.handled,true);assert.match(output(),/READING/);
    const before=output();assert.equal(hub.handleMouse?.({...event,x:3})?.handled,true);assert.equal(output(),before,"roster wheel must be contained without changing selection or thread");
    assert.match(output(),/> └ inspect one/);
    hub.handleMouse?.({...event,y:26});assert.equal(output(),before,"footer wheel must not move the reading viewport");
    hub.handleInput!("x");const confirmation=output();hub.handleMouse?.(event);assert.equal(output(),confirmation,"wheel must not disturb a pinned interaction");
    hub.handleInput!("\x1b");hub.handleInput!("\x1b[F");assert.match(output(),/LIVE/);
  } finally {hub.dispose();}
});

test("compact agent tree uses actual status/role/direct stats/activity with truthful queue/overflow and writer budget", () => {
  const children=[snapshot("A",{assignment:"Audit parser",toolCalls:3,telemetry:{requests:2,tokens:null,cost:null,context:null}}),
    snapshot("B",{assignment:"Check drain",status:"draining",writerLease:true}),
    ...Array.from({length:8},(_,i)=>snapshot(`q${i}`,{status:"queued"})),
    snapshot("done",{assignment:"Finished check",status:"settled",disposed:true,endedAt:2000})];
  const widget=createChildWidget(()=>children,theme,()=>30);
  const text=stripAnsi(widget.render(120).join("\n"));
  assert.match(text,/● Agents/);assert.match(text,/8 queued/);assert.match(text,/[├└]─/);
  assert.match(text,/scout.*Check drain/);assert.match(text,/└.*Tool: read/);assert.match(text,/more/);assert.match(text,/writer|Model-tool/);
  assert.doesNotMatch(text,/null|undefined|NaN|context.*%/);
  const measured=createChildWidget(()=>[snapshot("known",{toolCalls:3,telemetry:{requests:2,tokens:{input:3,output:5,cacheRead:2,cacheWrite:1,total:11},cost:0.125,context:null}})],theme);
  assert.match(stripAnsi(measured.render(180).join("\n")),/3 tools · 2 req · 11 tok · \$0.125/);
  for(const rows of [1,4,8,16,30])for(const width of [0,1,8,36,80,120]){
    const lines=createChildWidget(()=>children,theme,()=>rows).render(width);
    assert.ok(lines.length<=Math.max(1,Math.min(5,Math.floor(rows/4))));assert.ok(lines.every(line=>visibleWidth(line)<=width));
  }
});
