import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFleetProvider } from "../examples/controlled-fleet.ts";
import { createChildWidget, transcriptLines, taskCard } from "../src/hub.ts";
import { fixture, eventually } from "./fixtures.ts";

test("real SDK concurrent readers/writer/failure feed fleet, cards and full transcripts", {timeout: 20000}, async t => {
  // Reuse the exact opt-in interactive scenario's controlled response factory.
  const controlled = createFleetProvider(10000);
  const f = await fixture(t, {speed: 10000, response: controlled.respond});
  await writeFile(join(f.root, "input.txt"), "Real tool payload\n" + "full input\n".repeat(100));
  // Launch via actual parent task tool: all children share its authoritative extension registry.
  await f.session.prompt("fleet example");
  await eventually(() => new Set(f.events.map(event => event.child.id)).size === 4);
  await eventually(() => f.events.filter(event => event.child.disposed).length >= 4, 12000);
  const latest = new Map(f.events.map(event => [event.child.id, event.child]));
  const children = [...latest.values()];
  assert.equal(children.length, 4);
  assert.equal(children.filter(child => child.status === "settled").length, 3);
  assert.equal(children.filter(child => child.status === "failed").length, 1);
  assert.ok(children.every(child => child.createdAt <= child.endedAt!));
  assert.ok(children.every(child => !child.writerLease && child.disposed));
  const activeWriter = f.events.find(event => event.child.writerLease)?.child;
  assert.equal(activeWriter?.profile, "implementation");
  assert.ok(f.events.some(event => event.child.profile === "scout" && event.child.status === "running"));
  assert.ok(f.events.some(event => event.child.profile === "review" && event.child.status === "running"));
  assert.ok(f.events.some(event => event.event?.type === "tool_execution_end"));
  const widget = createChildWidget(() => children, {fg: (_color, text) => text});
  assert.match(widget.render(160).join("\n"), /settled 3.*failed 1/);
  const toolResults = f.session.messages.filter(message => message.role === "toolResult" && message.toolName === "delegate_task");
  assert.equal(toolResults.length, 4);
  assert.ok(toolResults.every(message => message.role === "toolResult" && !message.usage), "child usage never billed twice as parent tool usage");
  for (const child of children) {
    const card = taskCard(child).join("\n");
    assert.ok(card.includes(child.id)); assert.ok(card.includes(child.status)); assert.ok(card.includes(child.model.id));
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const messages = SessionManager.open(child.transcript!).buildSessionContext().messages;
    const lines = transcriptLines(messages).join("\n");
    if (child.status === "settled") { assert.match(lines, /toolResult/); assert.match(lines, /line 599/); }
    else assert.match(lines, /Controlled child failure/);
  }
});
