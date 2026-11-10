import { stripVTControlCharacters as stripAnsi } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { createChildWidget, createHub, taskCard, transcriptLines, safe } from "../src/hub.ts";
import { DelegationCoordinator, type ChildRef, type ChildSnapshot } from "../src/coordinator.ts";
import { backgroundAnsi, oklchColor, styleText, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeStyle } from "@earendil-works/pi-coding-agent";

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
    keys, () => {}, () => {}, () => rows);
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
  assert.match(widget.render(100).join("\n"), /FLEET 0.*task-hub/);
  for (const status of ["queued", "setup", "running", "draining", "settled", "cancelled", "failed"] as const) {
    child = { depth: 1, limits: {deadlineMs: 600000, requests: 100, tools: 100, depth: 2, spawns: 8}, toolCalls: 0, createdAt: 1, endedAt: null, writerLease: false, id: "test", generation: 1, parentId: "parent", profile: "general", assignment: "test", activity: "", model: {provider: "test", id: "test"}, effort: "off", telemetry: {requests: null, tokens: null, cost: null, context: null}, status, progress: "old activity ".repeat(20) + "中文 👩‍💻 latest\u001b\u0007", result: "final result", disposed: ["settled", "failed", "cancelled"].includes(status) };
    const output = widget.render(80).join("\n");
    assert.ok(output.includes(status));
    assert.ok(widget.render(20)[0].startsWith("FLEET"));
    assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(stripAnsi(output).replaceAll("\n", "")));
    if (status === "running") assert.ok(output.includes("test"));
    else if (child.disposed) assert.ok(output.includes("final result"));
    for (const width of [0, 1, 2, 8, 20, 40]) assert.ok(widget.render(width).every(line => visibleWidth(line) <= width));
  }
  child = { ...child!, status: "running", profile: "implementation", writerLease: true, disposed: false };
  assert.match(widget.render(100).join("\n"), /no conflicting manual !\/!! or external edits/);
  child = { ...child!, status: "failed", error: "Cannot start\u001b\u0007" };
  assert.match(widget.render(140).join("\n"), /Cannot start/);
});

function snapshot(id: string, patch: Partial<ChildSnapshot> = {}): ChildSnapshot {
  return { id, depth: 1, limits: {deadlineMs: 600000, requests: 100, tools: 100, depth: 2, spawns: 8}, toolCalls: 0, generation: 1, parentId: "root", status: "running", profile: "scout", assignment: "inspect " + id,
    activity: "Tool: read", progress: "streaming", result: "", model: {provider: "controlled", id: "model"}, effort: null,
    telemetry: {requests: null, tokens: null, cost: null, context: null}, disposed: false, createdAt: 1000, endedAt: null, writerLease: false, ...patch };
}
const effectiveKeys = { matches: (data: string, action: string) => data === ({"tui.select.cancel": "\x1b", "tui.select.confirm": "\r", "tui.select.up": "\x1b[A", "tui.select.down": "\x1b[B", "tui.select.pageUp": "\x1b[5~", "tui.select.pageDown": "\x1b[6~"} as Record<string,string>)[action], getKeys: () => ["escape" as const, "enter" as const] };

test("fleet counts every lifecycle, bounds height independently of task count, and shows actual lease not profile", () => {
  const children = [snapshot("reader", {profile: "implementation"}), ...["setup", "running", "settled", "failed", "cancelled"].map(status => snapshot(status, {status: status as ChildSnapshot["status"], disposed: status !== "running" && status !== "setup"}))];
  const widget = createChildWidget(() => children, theme);
  const text = stripAnsi(widget.render(180).join("\n"));
  assert.match(text, /FLEET 6/); assert.match(text, /running 2/); assert.match(text, /failed 1/);
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
  const hub = createHub(coordinator, theme, effectiveKeys, () => renders++, () => closed++, () => 20);
  const output = () => stripAnsi(hub.render(100).join("\n"));
  assert.match(output(), /> └ first/);
  hub.handleInput!("\x1b[B"); assert.match(output(), /> └ second/);
  children = [...children, snapshot("new", {status: "settled", disposed: true})];
  listener!({type: "changed", child: children[2]}); assert.match(output(), /> └ second/);
  assert.match(output(), /Direct requests unavailable/);
  hub.handleInput!("\t"); assert.match(output(), /FULL LINE 0/);
  hub.handleInput!("\x1b[6~"); assert.doesNotMatch(output(), /FULL LINE 0 /);
  hub.handleInput!("\x1b[F"); assert.match(output(), /FULL LINE 99/);
  hub.handleInput!("\t"); assert.match(output(), /TOOLS/);
  hub.handleInput!("s"); hub.handleInput!("new direction"); hub.handleInput!("\r");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0], ["second", 7, "new direction"]);
  hub.handleInput!("x"); hub.handleInput!("\r"); assert.equal(calls.length, 1, "Enter never confirms stop");
  hub.handleInput!("\x1b"); hub.handleInput!("x"); hub.handleInput!("y");
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls[1], ["second", 7, "stop"]);
  hub.handleInput!("/"); hub.handleInput!("first"); hub.handleInput!("\r"); assert.match(output(), /> └ first/); assert.doesNotMatch(output(), /└ second/);
  hub.handleInput!("\r"); hub.handleInput!("\x1b"); assert.equal(closed, 2);
  assert.equal(calls.length, 2, "navigation/closing never invokes controls");
  hub.dispose(); assert.ok(detached); assert.ok(renders > 0);
});

test("cards and transcript project real messages and sanitize controls/bidi without exposing opaque provider payloads", () => {
  const child = snapshot("card", {transcript: "/session/transcript.jsonl", error: "Failed\x1b[31m\u202e"});
  assert.match(taskCard(child, true).join("\n"), /card #1.*scout.*running/);
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
    const hub = createHub(coordinator, theme, effectiveKeys, () => {}, () => {}, () => 24);
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
      assert.match(render(), /> └ B/, "ordinary roster fallback still works");
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
      begin(); hub.handleInput!("\x1b");
      assert.doesNotMatch(render(), /Target:/, "cancel clears pinned target");
      hub.handleInput!("\x1b[B");
      hub.handleInput!(action === "steer" ? "s" : action === "message" ? "m" : "x");
      assert.match(render(), /Target: B #9/, "next interaction captures its own target");
    } finally { hub.dispose(); }
  });
}
