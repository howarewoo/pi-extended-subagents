import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";

test("SDK provider errors settle as failed once; unknown telemetry is not invented as zero", async t => {
  const { direct, coordinator } = await fixture(t, { response: () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "controlled provider failed" }) });
  let terminal = 0;
  coordinator.subscribe(event => { if (event.child.disposed) terminal++; });
  const ref = await direct("fail request");
  const state = await coordinator.wait(ref);
  assert.equal(state.status, "failed"); assert.match(state.error!, /controlled provider failed/); assert.equal(terminal, 1);
  assert.equal(state.telemetry.requests, 1, "direct attempted request counted, provider subrequests unknown");
  assert.ok(state.telemetry.context === null || typeof state.telemetry.context === "object");
});

test("parent abort during foreground task cancels and drains the actual child without orphan work", async t => {
  const { session, events } = await fixture(t, { speed: 300 });
  const prompt = session.prompt("LAUNCH " + JSON.stringify({ assignment: "long foreground child ".repeat(200), profile: "general", background: false }));
  await eventually(() => events.some(event => event.child.status === "running"));
  await session.abort(); await prompt;
  const final = events.at(-1)!.child;
  assert.equal(final.status, "cancelled"); assert.equal(final.disposed, true);
  assert.match(await readFile(final.transcript!, "utf8"), /"stopReason":"aborted"/);
});

test("read-only child cannot reach write or delegate_task even when model requests them", async t => {
  const { root, direct, coordinator, events } = await fixture(t, { response: context => {
    if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("denied capability");
    return fauxAssistantMessage([fauxToolCall("write", { path: "forbidden.txt", content: "no" }), fauxToolCall("delegate_task", { assignment: "nested", profile: "general" })], { stopReason: "toolUse" });
  } });
  const ref = await direct("deny model attempts"); await coordinator.wait(ref);
  await assert.rejects(readFile(join(root, "forbidden.txt")), /ENOENT/);
  const ended = events.filter(event => event.child.id === ref.id && event.event?.type === "tool_execution_end");
  assert.equal(ended.length, 2);
  assert.ok(ended.every(event => event.event?.type === "tool_execution_end" && event.event.isError));
  assert.equal(coordinator.list().length, 1, "no self-spawned task");
});

test("missing parent tool and unsupported schema fields fail before child setup", async t => {
  const { session, launch, model, events } = await fixture(t);
  session.setActiveToolsByName(["delegate_task", "read"]);
  await assert.rejects(launch("missing tools"), /Parent tool grant unavailable/);
  assert.equal(events.length, 0);
  model.setResponses([fauxAssistantMessage(fauxToolCall("delegate_task", { assignment: "bad schema", profile: "general", extensions: ["ambient"] }), { stopReason: "toolUse" }), fauxAssistantMessage("parent done")]);
  await session.prompt("forbidden parameter");
  const task = session.messages.filter(message => message.role === "toolResult" && message.toolName === "delegate_task").at(-1);
  assert.ok(task?.role === "toolResult" && task.isError);
  assert.equal(events.length, 0);
});
