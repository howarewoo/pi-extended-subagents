import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";
import type { ChildSnapshot } from "../src/coordinator.ts";

const text = (context: Parameters<import("@earendil-works/pi-ai").FauxResponseFactory>[0]) => {
  const user = context.messages.filter(message => message.role === "user").at(-1);
  return typeof user?.content === "string" ? user.content : user?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
};

test("aborted active parent-dispatched tool drains before writer lease or scheduler permit release", { timeout: 10000 }, async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  const f = await fixture(t, { extra: pi => {
    pi.on("tool_call", async event => {
      if (event.toolName === "write" && !entered) { entered = true; await gate; }
    });
  }, response: context => {
    const assignment = text(context);
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
    return fauxAssistantMessage(fauxToolCall(assignment.startsWith("LAUNCH ") ? "delegate_task" : "write", assignment.startsWith("LAUNCH ") ? JSON.parse(assignment.slice(7)) : { path: assignment + ".txt", content: "written" }), { stopReason: "toolUse" });
  } });
  try {
    await f.session.prompt("LAUNCH " + JSON.stringify({ background: true, tasks: [
      { assignment: "first", profile: "implementation", limits: { deadlineMs: 100 } },
      { assignment: "second", profile: "implementation" },
    ] }));
    const result = f.session.messages.find(message => message.role === "toolResult" && message.toolName === "delegate_task");
    assert.ok(result?.role === "toolResult");
    const refs = (result.details as { children: ChildSnapshot[] }).children;
    await eventually(() => entered && f.events.some(event => event.child.id === refs[0].id && event.child.status === "draining"));
    const first = f.events.filter(event => event.child.id === refs[0].id).at(-1)!.child;
    assert.equal(first.disposed, false);
    assert.equal(first.writerLease, true);
    assert.equal(f.events.filter(event => event.child.id === refs[1].id).at(-1)!.child.status, "queued");
    release();
    await eventually(() => f.events.some(event => event.child.id === refs[1].id && event.child.disposed));
    const disposed = f.events.filter(event => event.child.disposed).map(event => event.child);
    assert.deepEqual(disposed.map(state => state.status), ["cancelled", "settled"]);
    assert.match(await readFile(disposed[1].transcript!, "utf8"), /written/);
    assert.equal(await readFile(join(f.root, "second.txt"), "utf8"), "written");
  } finally { release(); }
});

test("root writer admission queues while the current writer's forwarded write is in flight", { timeout: 10000 }, async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  const f = await fixture(t, { extra: pi => {
    pi.on("tool_call", async event => {
      if (event.toolName === "write" && !entered) { entered = true; await gate; }
    });
  }, response: context => {
    const assignment = text(context);
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
    return fauxAssistantMessage(fauxToolCall(assignment.startsWith("LAUNCH ") ? "delegate_task" : "write", assignment.startsWith("LAUNCH ") ? JSON.parse(assignment.slice(7)) : { path: assignment + ".txt", content: "written" }), { stopReason: "toolUse" });
  } });
  try {
    const first = await f.launch("first", "implementation");
    await eventually(() => entered);
    const second = await f.launch("second", "implementation");
    const latest = (id: string) => f.events.filter(event => event.child.id === id).at(-1)!.child;
    assert.equal(latest(first.id).writerLease, true);
    assert.equal(latest(second.id).status, "queued");
    assert.equal(latest(second.id).transcript, undefined);
    release();
    await eventually(() => latest(second.id).disposed);
    assert.equal(latest(first.id).status, "settled");
    assert.equal(latest(second.id).status, "settled");
    assert.equal(await readFile(join(f.root, "second.txt"), "utf8"), "written");
  } finally { release(); }
});

test("deadline during unabortable public auth setup retains capacity until setup drains, never dispatches late", { timeout: 10000 }, async t => {
  const f = await fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = ModelRegistry.prototype.getApiKeyAndHeaders;
  let entered = false;
  t.mock.method(ModelRegistry.prototype, "getApiKeyAndHeaders", async function(this: ModelRegistry, ...args: Parameters<typeof original>) {
    if (!entered) { entered = true; await gate; }
    return original.apply(this, args);
  });
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(join(f.root, "operator", "delegation.json"), JSON.stringify({ scheduling: { concurrency: 1 } }));
  try {
    // Parent inference uses its normal stream API; the adapter's explicit public
    // auth preflight is the blocked setup boundary, not a simulated scheduler.
    await f.session.prompt("LAUNCH " + JSON.stringify({ background: true, tasks: [
      { assignment: "auth wait", profile: "general", limits: { deadlineMs: 50 } },
      { assignment: "next", profile: "general" },
    ] }));
    await eventually(() => entered && f.events.some(event => event.child.status === "draining"));
    const ids = [...new Set(f.events.map(event => event.child.id))];
    assert.equal(ids.length, 2);
    assert.equal(f.events.filter(event => event.child.id === ids[0]).at(-1)!.child.disposed, false);
    assert.equal(f.events.filter(event => event.child.id === ids[1]).at(-1)!.child.status, "queued");
    release();
    await eventually(() => f.events.some(event => event.child.id === ids[1] && event.child.disposed));
    const first = f.events.filter(event => event.child.id === ids[0]).at(-1)!.child;
    assert.equal(first.status, "cancelled");
    assert.equal(first.telemetry.requests, null);
    assert.equal(first.limitReason, "deadline");
  } finally { release(); }
});

test("parent cancellation drains the actual nested tree before finalizing the ancestor", { timeout: 10000 }, async t => {
  const f = await fixture(t, { speed: 500, response: context => {
    const assignment = text(context);
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
    if (assignment === "grandchild") return fauxAssistantMessage("long nested response ".repeat(100));
    return fauxAssistantMessage(fauxToolCall("delegate_task", assignment.startsWith("LAUNCH ") ? JSON.parse(assignment.slice(7)) : { assignment: "grandchild", profile: "general" }), { stopReason: "toolUse" });
  } });
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(join(f.root, "operator", "delegation.json"), JSON.stringify({ general: { spawn: ["general"] } }));
  const child = await f.launch("child");
  await eventually(() => f.events.some(event => event.child.depth === 2 && event.child.status === "running"));
  await f.session.prompt(`/task-stop ${child.id} ${child.generation}`);
  const disposed = f.events.filter(event => event.child.disposed).map(event => event.child);
  assert.deepEqual(disposed.map(state => state.depth), [2, 1]);
  assert.ok(disposed.every(state => state.status === "cancelled"));
  assert.equal(disposed[0].parentId, child.id);
  for (const state of disposed) assert.match(await readFile(state.transcript!, "utf8"), /"stopReason":"aborted"/);
});

test("subtree stop aborts an ancestor tool before draining a descendant queued in the sequential root dispatcher", { timeout: 10000 }, async t => {
  let bashStarted = false;
  const f = await fixture(t, { extra: pi => {
    pi.on("tool_execution_start", event => { if (event.toolName === "bash") bashStarted = true; });
  }, response: context => {
    const assignment = text(context);
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
    if (assignment.startsWith("LAUNCH ")) return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(assignment.slice(7))), { stopReason: "toolUse" });
    if (assignment === "grandchild") return fauxAssistantMessage(fauxToolCall("read", { path: "input.txt" }), { stopReason: "toolUse" });
    return fauxAssistantMessage([
      fauxToolCall("bash", { command: "sleep 3" }),
      fauxToolCall("delegate_task", { assignment: "grandchild", profile: "general" }),
    ], { stopReason: "toolUse" });
  } });
  f.session.agent.toolExecution = "sequential";
  await writeFile(join(f.root, "input.txt"), "input");
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(join(f.root, "operator", "delegation.json"), JSON.stringify({ implementation: { spawn: ["general"] } }));
  const child = await f.launch("child", "implementation");
  await eventually(() => bashStarted && f.events.some(event => event.child.depth === 2 && event.event?.type === "tool_execution_start" && event.event.toolName === "read"));
  const start = Date.now();
  await f.session.prompt(`/task-stop ${child.id} ${child.generation}`);
  assert.ok(Date.now() - start < 1500, "stop must abort bash rather than wait for its natural exit");
  const disposed = f.events.filter(event => event.child.disposed).map(event => event.child);
  assert.deepEqual(disposed.map(state => state.depth), [2, 1]);
  assert.ok(disposed.every(state => state.status === "cancelled"));
  assert.equal(disposed.at(-1)!.writerLease, false);
});

test("reload cancels queued and active batch assignments and suppresses old-runtime final delivery", async t => {
  const f = await fixture(t, { speed: 500 });
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(join(f.root, "operator", "delegation.json"), JSON.stringify({ scheduling: { concurrency: 1 } }));
  await f.session.prompt("LAUNCH " + JSON.stringify({ background: true, tasks: [
    { assignment: "long ".repeat(100), profile: "general" }, { assignment: "never start", profile: "general" },
  ] }));
  const ids = [...new Set(f.events.map(event => event.child.id))];
  assert.equal(ids.length, 2);
  await f.session.reload();
  for (const id of ids) {
    const final = f.events.filter(event => event.child.id === id).at(-1)!.child;
    assert.equal(final.status, "cancelled"); assert.equal(final.disposed, true);
    assert.equal(f.events.filter(event => event.child.id === id && event.child.disposed).length, 1);
  }
  const queued = f.events.filter(event => event.child.id === ids[1]);
  assert.ok(queued.every(event => !event.child.transcript));
  assert.equal(f.session.messages.filter(message => message.role === "custom" && ids.some(id => JSON.stringify(message).includes(id))).length, 0);
});

test("shutdown at queued admission creates no SDK work and disposes each entry exactly once", async t => {
  const f = await fixture(t);
  f.coordinator.subscribe(event => { if (event.child.status === "queued") void f.coordinator.shutdown(); });
  const ref = await f.direct("never start");
  await f.coordinator.shutdown();
  assert.equal(f.coordinator.snapshot(ref)!.status, "cancelled");
  assert.equal(f.coordinator.snapshot(ref)!.transcript, undefined);
  assert.equal(f.events.filter(event => event.child.id === ref.id && event.child.disposed).length, 1);
});

test("cancelling a queue set cannot dequeue its later read-only member past a blocked writer", async t => {
  const f = await fixture(t, { speed: 100 });
  const active = await f.direct("long writer ".repeat(100), "implementation");
  const blocked = await f.direct("blocked writer", "implementation");
  const reader = await f.direct("blocked reader");
  assert.equal(f.coordinator.snapshot(blocked)!.status, "queued");
  assert.equal(f.coordinator.snapshot(reader)!.status, "queued");
  await f.coordinator.stopMany([blocked, reader]);
  assert.equal(f.coordinator.snapshot(reader)!.transcript, undefined);
  assert.equal(f.coordinator.snapshot(reader)!.status, "cancelled");
  assert.equal(f.coordinator.snapshot(active)!.writerLease, true);
  await f.coordinator.stop(active);
});
