import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";

test("production permits one child writer and concurrent read-only children, then releases ownership", async t => {
  const { launch, session, events } = await fixture(t, { speed: 500 });
  const first = await launch("long writer ".repeat(100), "implementation");
  await assert.rejects(launch("second writer", "implementation"), /writer conflict/);
  const readonly = await launch("readonly child");
  assert.notEqual(first.id, readonly.id);
  await session.prompt(`/task-stop ${first.id} ${first.generation}`);
  const next = await launch("new writer", "implementation", false);
  assert.equal(events.filter(event => event.child.id === next.id).at(-1)!.child.status, "settled");
});

test("production parent write/bash path visibly rejects while child holds writer", async t => {
  const { launch, session, model, root, events } = await fixture(t, { speed: 2000 });
  const child = await launch("long writer ".repeat(100), "implementation");
  await eventually(() => events.some(event => event.child.id === child.id && !!event.child.progress));
  model.setResponses([fauxAssistantMessage(fauxToolCall("write", { path: "parent-conflict.txt", content: "must not write" }), { stopReason: "toolUse" }), fauxAssistantMessage("parent done")]);
  await session.prompt("attempt parent mutation");
  const last = session.messages.filter(message => message.role === "toolResult" && message.toolName === "write").at(-1);
  assert.ok(last?.role === "toolResult" && last.isError);
  assert.match(JSON.stringify(last), /writer is held/);
  await assert.rejects(readFile(join(root, "parent-conflict.txt")), /ENOENT/);
  model.setResponses([fauxAssistantMessage(fauxToolCall("bash", { command: "touch bash-conflict.txt" }), { stopReason: "toolUse" }), fauxAssistantMessage("parent done")]);
  await session.prompt("attempt bash mutation");
  const bash = session.messages.filter(message => message.role === "toolResult" && message.toolName === "bash").at(-1);
  assert.ok(bash?.role === "toolResult" && bash.isError);
  await assert.rejects(readFile(join(root, "bash-conflict.txt")), /ENOENT/);
  model.setResponses([fauxAssistantMessage(fauxToolCall("capture_context", {}), { stopReason: "toolUse" }), fauxAssistantMessage("parent done")]);
  await session.prompt("attempt unknown parent tool");
  const unknown = session.messages.filter(message => message.role === "toolResult" && message.toolName === "capture_context").at(-1);
  assert.ok(unknown?.role === "toolResult" && unknown.isError, "unknown parent tools are not assumed read-only");
  await session.prompt(`/task-stop ${child.id} ${child.generation}`);
});

test("production sibling parent mutation reserves ownership during preflight before writer launch", async t => {
  const { session, model, events } = await fixture(t);
  model.setResponses([fauxAssistantMessage([
    fauxToolCall("bash", { command: "sleep 0.05" }),
    fauxToolCall("delegate_task", { assignment: "must not launch", profile: "implementation", background: false }),
  ], { stopReason: "toolUse" }), fauxAssistantMessage("parent done")]);
  await session.prompt("parallel preflight conflict");
  const task = session.messages.find(message => message.role === "toolResult" && message.toolName === "delegate_task");
  assert.ok(task?.role === "toolResult" && task.isError);
  assert.match(JSON.stringify(task), /in-flight parent mutation/);
  assert.equal(events.length, 0, "no child created on preflight conflict");
});

test("production delegated writes retain parent permission hooks", async t => {
  const { launch, root, events } = await fixture(t, {
    extra: pi => { pi.on("tool_call", event => { if (event.toolName === "write") return { block: true, reason: "operator denied write" }; }); },
    response: context => {
      const user = context.messages.find(message => message.role === "user");
      const text = typeof user?.content === "string" ? user.content : user?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
      if (text.startsWith("LAUNCH ")) return context.messages.at(-1)?.role === "toolResult" ? fauxAssistantMessage("parent done") : fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), { stopReason: "toolUse" });
      return context.messages.at(-1)?.role === "toolResult" ? fauxAssistantMessage("write was denied") : fauxAssistantMessage(fauxToolCall("write", { path: "denied.txt", content: "no" }), { stopReason: "toolUse" });
    },
  });
  const ref = await launch("write attempt", "implementation", false);
  await assert.rejects(readFile(join(root, "denied.txt")), /ENOENT/);
  assert.ok(events.some(event => event.child.id === ref.id && event.event?.type === "tool_execution_end" && event.event.isError));
});

test("manual shell events remain uncoordinated and do not disable production writers, including after reload", async t => {
  let laterHook = 0;
  const { session, launch, root, events } = await fixture(t, { extra: pi => { pi.on("user_bash", () => { laterHook++; }); } });
  await session.prompt("/task-profiles");
  assert.match(JSON.stringify(session.messages.at(-1)), /manual shells are uncoordinated/);
  await session.extensionRunner.emitUserBash({ type: "user_bash", command: "not executed by event-only test", cwd: root, excludeFromContext: false });
  assert.equal(laterHook, 1, "no replacement/handling of manual shell operations");
  const ref = await launch("writer remains available", "implementation", false);
  assert.equal(events.filter(event => event.child.id === ref.id).at(-1)!.child.status, "settled");
  await session.reload();
  const replacement = await launch("writer after reload", "implementation", false);
  assert.equal(events.filter(event => event.child.id === replacement.id).at(-1)!.child.status, "settled");
});
