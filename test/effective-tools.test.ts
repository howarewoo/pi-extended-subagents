import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";
import { Type } from "typebox";
import { resolveProfile } from "../src/profiles.ts";
import type { StartTask, ChildSnapshot } from "../src/coordinator.ts";

const userText = (context: Parameters<FauxResponseFactory>[0]) => {
  const user = context.messages.findLast(message => message.role === "user");
  return typeof user?.content === "string" ? user.content : user?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
};
function taskResult(f: Awaited<ReturnType<typeof fixture>>) {
  const result = f.session.messages.findLast(message => message.role === "toolResult" && message.toolName === "delegate_task");
  assert.ok(result?.role === "toolResult"); return result;
}

test("ordinary SDK default loadout delegates a two-scout background batch through actual read hooks only", async t => {
  const declarations: string[][] = [];
  let reads = 0;
  const f = await fixture(t, { tools: "default", speed: 0, extra: pi => {
    pi.on("tool_call", event => { if (event.toolName === "read") reads++; });
  }, response: context => {
    const text = userText(context);
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
    if (text.startsWith("LAUNCH ")) return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {stopReason: "toolUse"});
    declarations.push(context.messages.flatMap(message => message.role === "system" ? message.toolsAdded ?? [] : []).map(tool => tool.name));
    return fauxAssistantMessage(fauxToolCall("read", {path: "input.txt"}), {stopReason: "toolUse"});
  } });
  await writeFile(join(f.root, "input.txt"), "default-scope payload");
  const before = f.session.getActiveToolNames();
  for (const name of ["read", "bash", "edit", "write"]) assert.ok(before.includes(name));
  for (const name of ["grep", "find", "ls"]) assert.ok(!before.includes(name));
  await f.session.prompt("LAUNCH " + JSON.stringify({background: true, tasks: [
    {profile: "scout", assignment: "reader alpha"}, {profile: "scout", assignment: "reader beta"},
  ]}));
  assert.equal(taskResult(f).isError, false, JSON.stringify(taskResult(f)));
  const accepted = (taskResult(f).details as {children: ChildSnapshot[]}).children;
  await eventually(() => accepted.every(ref => f.events.some(event => event.child.id === ref.id && event.child.disposed)));
  assert.equal(reads, 2);
  assert.deepEqual(declarations, [["read"], ["read"]]);
  assert.deepEqual(f.session.getActiveToolNames(), before, "delegation must not activate parent tools");
  for (const ref of accepted) {
    const final = f.events.filter(event => event.child.id === ref.id).at(-1)!.child;
    assert.equal(final.status, "settled");
    assert.deepEqual(final.tools, ["read"]);
    assert.match(await readFile(final.transcript!, "utf8"), /default-scope payload/);
  }
});


for (const loadout of ["default", ["read", "capture_context", "delegate_task", "delegate_coordinate"]] as const) {
  test(`implementation uses effective ${typeof loadout === "string" ? "default mutating" : "read-only"} subset and truthful writer ownership`, async t => {
    const f = await fixture(t, {tools: typeof loadout === "string" ? loadout : [...loadout], speed: 0});
    const ref = await f.direct("implementation scope", "implementation");
    const final = await f.coordinator.wait(ref);
    assert.deepEqual(final.tools, typeof loadout === "string" ? ["read", "write", "edit", "bash"] : ["read"]);
    assert.equal(f.events.some(event => event.child.id === ref.id && event.child.writerLease), typeof loadout === "string");
    assert.equal(final.writerLease, false);
  });
}

test("empty effective later profile atomically rejects a batch and owned tools cannot manufacture builtin rights", async t => {
  const f = await fixture(t, {tools: "default", speed: 0});
  await mkdir(join(f.root, "operator"), {recursive: true});
  await writeFile(join(f.root, "operator", "delegation.json"), JSON.stringify({general: {tools: ["grep"], coordination: ["inbox"], spawn: ["general"]}}));
  await f.session.prompt("LAUNCH " + JSON.stringify({tasks: [
    {assignment: "valid first", profile: "scout"},
    {assignment: "empty later", profile: "general", resultSchema: {type: "integer"}},
  ]}));
  assert.equal(taskResult(f).isError, true);
  assert.match(JSON.stringify(taskResult(f)), /no callable parent builtin tools/);
  assert.equal(f.events.length, 0);
  await assert.rejects(access(join(f.root, "parent", "delegation")), /ENOENT/);
  f.session.setActiveToolsByName(["delegate_task"]);
  await f.session.prompt('LAUNCH {"profile":"scout","taskFile":"input.txt"}');
  assert.match(JSON.stringify(taskResult(f)), /taskFile requires a callable parent read tool/);
  assert.equal(f.events.length, 0);
});

test("inactive builtin replacement is not forwarded; callable replacement fails provenance before admission", async t => {
  let customCalls = 0;
  const f = await fixture(t, {tools: "default", speed: 0, extra: pi => {
    pi.registerTool({name: "grep", label: "synthetic replacement", description: "must not delegate", defaultActive: false,
      parameters: Type.Object({}), execute: async () => { customCalls++; return {content: [], details: {}}; }});
  } });
  const first = await f.launch("read subset", "scout", false);
  assert.deepEqual(f.events.find(event => event.child.id === first.id)!.child.tools, ["read"]);
  const before = f.events.length;
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "grep"]);
  await f.session.prompt('LAUNCH {"profile":"scout","assignment":"reject active replacement"}');
  assert.equal(taskResult(f).isError, true);
  assert.match(JSON.stringify(taskResult(f)), /unmodified built-in parent tool: grep/);
  assert.equal(f.events.length, before);
  assert.equal(customCalls, 0);
});

test("central direct admission requires live provenance validator and never broadens old generations after activation", async t => {
  const f = await fixture(t, {tools: "default", speed: 0});
  let input!: StartTask;
  const start = f.coordinator.start.bind(f.coordinator);
  t.mock.method(f.coordinator, "start", (value: StartTask) => {input = value; return start(value);});
  const first = await f.direct("original", "scout"); await f.coordinator.wait(first);
  assert.deepEqual(f.coordinator.snapshot(first)!.tools, ["read"]);
  assert.throws(() => f.coordinator.admit([{...input, assertTools: undefined!}]), /provenance validator/);
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "grep", "find", "ls"]);
  const next = f.coordinator.renew(first, {...input, assignment: "followup"}); await f.coordinator.wait(next);
  assert.deepEqual(f.coordinator.snapshot(next)!.tools, ["read"]);
  f.coordinator.park(next);
  const third = f.coordinator.renew(next, {...input, assignment: "revival"}); await f.coordinator.wait(third);
  assert.deepEqual(f.coordinator.snapshot(third)!.tools, ["read"]);
  const [fresh] = f.coordinator.admit([{...input, assignment: "new identity"}]); await f.coordinator.wait(fresh);
  assert.deepEqual(f.coordinator.snapshot(fresh)!.tools, ["read", "grep", "find", "ls"]);
  assert.deepEqual(f.coordinator.snapshot(first)!.tools, ["read"], "history keeps original effective grants");
  await mkdir(join(f.root, "operator"), {recursive: true});
  await writeFile(join(f.root, "operator", "delegation.json"), JSON.stringify({scout: {tools: ["grep"]}}));
  const current = await resolveProfile("scout", f.root, false);
  const count = f.coordinator.generations(first.id).length;
  assert.throws(() => f.coordinator.renew(third, {...input, ...current, assignment: "cannot regain grep"}), /no callable parent builtin tools/);
  assert.equal(f.coordinator.generations(first.id).length, count);
});

test("ordinary default nested scout inherits effective read authority; root read permission hooks still block", async t => {
  let reads = 0;
  const f = await fixture(t, {tools: "default", speed: 0, extra: pi => {
    pi.on("tool_call", event => { if (event.toolName === "read") {reads++; return {block: true, reason: "root permission refusal"};} });
  }, response: context => {
    const text = userText(context);
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
    if (text.startsWith("LAUNCH ")) return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {stopReason: "toolUse"});
    if (text === "nested parent") return fauxAssistantMessage(fauxToolCall("delegate_task", {profile: "scout", assignment: "leaf"}), {stopReason: "toolUse"});
    return fauxAssistantMessage(fauxToolCall("read", {path: "input.txt"}), {stopReason: "toolUse"});
  } });
  await mkdir(join(f.root, "operator"), {recursive: true});
  await writeFile(join(f.root, "operator", "delegation.json"), JSON.stringify({scout: {spawn: ["scout"]}}));
  await writeFile(join(f.root, "input.txt"), "never visible");
  await f.launch("nested parent", "scout", false);
  const children = [...new Map(f.events.map(event => [event.child.id, event.child])).values()];
  assert.equal(children.length, 2);
  assert.ok(children.every(child => JSON.stringify(child.tools) === '["read"]'));
  const leaf = children.find(child => child.depth === 2)!;
  assert.equal(leaf.parentId, children.find(child => child.depth === 1)!.id);
  assert.equal(reads, 1);
  const transcript = await readFile(leaf.transcript!, "utf8");
  assert.match(transcript, /root permission refusal/);
  assert.doesNotMatch(transcript, /never visible/);
});

for (const change of ["deactivate", "replace"] as const) test(`forwarded read rechecks live ${change} authority after a held real permission hook`, {timeout: 10000}, async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let markEntered!: () => void;
  const entered = new Promise<void>(resolve => {markEntered = resolve;});
  let reads = 0, customCalls = 0;
  const f = await fixture(t, {tools: "default", speed: 0, extra: pi => {
    pi.on("tool_call", async event => { if (event.toolName === "read") {reads++; markEntered(); await gate;} });
    pi.registerCommand("replace-read", {description: "Synthetic test revocation", handler: async () => {
      pi.registerTool({name: "read", label: "synthetic read", description: "must not forward", parameters: Type.Object({path: Type.String()}),
        execute: async () => {customCalls++; return {content: [{type: "text", text: "unsafe replacement"}], details: {}};}});
    }});
  }, response: context => {
    const text = userText(context);
    if (text.startsWith("LAUNCH ")) return context.messages.at(-1)?.role === "toolResult" ? fauxAssistantMessage("background accepted") : fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {stopReason: "toolUse"});
    const results = context.messages.filter(message => message.role === "toolResult");
    return results.length < 2 ? fauxAssistantMessage(fauxToolCall("read", {path: "input.txt"}), {stopReason: "toolUse"}) : fauxAssistantMessage("done");
  } });
  try {
    await writeFile(join(f.root, "input.txt"), "permitted first read");
    const ref = await f.launch("two reads", "scout"); await entered;
    if (change === "deactivate") f.session.setActiveToolsByName(f.session.getActiveToolNames().filter(name => name !== "read"));
    else await f.session.prompt("/replace-read");
    release();
    await eventually(() => f.events.some(event => event.child.id === ref.id && event.child.disposed));
    const final = f.events.filter(event => event.child.id === ref.id).at(-1)!.child;
    assert.deepEqual(final.tools, ["read"], "snapshot retains admitted ceiling, not newly substituted backend");
    const transcript = await readFile(final.transcript!, "utf8");
    assert.match(transcript, change === "deactivate" ? /no longer callable: read/ : /unmodified built-in parent tool: read/);
    assert.equal(reads, 1, "later dispatch must not reach a replaced/revoked root tool");
    assert.equal(customCalls, 0);
  } finally {release();}
});

test("native root followup/revive retain default admitted ceiling after parent activation; fresh identity uses current subset", async t => {
  const f = await fixture(t, {tools: "default", speed: 0, response: context => {
    const text = userText(context);
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
    if (text.startsWith("LAUNCH ") || text.startsWith("COORD ")) return fauxAssistantMessage(fauxToolCall(text.startsWith("LAUNCH ") ? "delegate_task" : "delegate_coordinate", JSON.parse(text.slice(text.startsWith("LAUNCH ") ? 7 : 6))), {stopReason: "toolUse"});
    return fauxAssistantMessage("bounded assignment complete");
  } });
  const first = await f.launch("original", "scout", false);
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "grep", "find", "ls"]);
  const coordinate = async (action: string, target: {id: string; generation: number}) => {
    await f.session.prompt("COORD " + JSON.stringify({action, target: {id: target.id, generation: target.generation}, ...(["followup", "revive"].includes(action) ? {assignment: "next"} : {})}));
    const result = f.session.messages.findLast(message => message.role === "toolResult" && message.toolName === "delegate_coordinate");
    assert.ok(result?.role === "toolResult" && !result.isError, JSON.stringify(result));
    return result.details as unknown as ChildSnapshot;
  };
  const second = await coordinate("followup", first);
  await eventually(() => f.events.some(event => event.child.id === second.id && event.child.generation === 2 && event.child.disposed));
  assert.deepEqual(second.tools, ["read"]);
  await coordinate("park", {id: second.id, generation: 2});
  const third = await coordinate("revive", {id: second.id, generation: 2});
  assert.equal(third.generation, 3); assert.deepEqual(third.tools, ["read"]);
  const fresh = await f.launch("fresh", "scout", false);
  assert.deepEqual((taskResult(f).details as ChildSnapshot).tools, ["read", "grep", "find", "ls"]);
  assert.notEqual(fresh.id, first.id);
});
