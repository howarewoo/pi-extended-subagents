import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";
import type { ChildSnapshot } from "../src/coordinator.ts";

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const userText = (message: Parameters<FauxResponseFactory>[0]["messages"][number] | undefined) =>
  message?.role === "user"
    ? typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("")
    : "";

for (const action of ["followup", "revive", "resume"] as const) {
  test(`direct ${action} wakes idle parent with the drained returned generation`, async (t) => {
    const drain = gate();
    t.after(() => drain.resolve());
    const parentRequests: string[] = [];
    const f = await fixture(t, {
      speed: 0,
      extra: (pi) => {
        pi.on("tool_call", async (event) => {
          if (event.toolName === "read") await drain.promise;
        });
      },
      response: (context) => {
        if (userText(context.messages.find((m) => m.role === "user")).startsWith("ROOT ")) {
          parentRequests.push(JSON.stringify(context));
          const latest = userText(context.messages.at(-1));
          if (latest.startsWith("ROOT ")) {
            const { name, args } = JSON.parse(latest.slice(5));
            return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
          }
          return fauxAssistantMessage("parent yielded");
        }
        return userText(context.messages.at(-1)) === "replacement"
          ? fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt" }), {
              stopReason: "toolUse",
            })
          : fauxAssistantMessage("replacement outcome");
      },
    });
    await writeFile(join(f.root, "evidence.txt"), "gated evidence");
    const invoke = async (name: string, args: unknown) => {
      await f.session.prompt("ROOT " + JSON.stringify({ name, args }));
      const result = f.session.messages
        .filter((m) => m.role === "toolResult" && m.toolName === name)
        .at(-1);
      assert.ok(result?.role === "toolResult");
      return result;
    };
    const notices = () =>
      f.session.messages.filter((m) => m.role === "custom" && m.customType === "delegation");
    const first = await invoke("delegate_task", { assignment: "initial", profile: "scout" });
    assert.equal(first.isError, false);
    assert.equal(notices().length, 0, "foreground has no extra notice");
    const original = first.details as ChildSnapshot;
    const target = { id: original.id, generation: original.generation };
    if (action === "revive") await invoke("delegate_coordinate", { action: "park", target });
    const renewed = await invoke("delegate_coordinate", {
      action,
      target,
      assignment: "replacement",
    });
    assert.equal(renewed.isError, false);
    const next = renewed.details as ChildSnapshot;
    assert.equal(next.generation, action === "resume" ? 1 : 2);
    assert.equal(f.session.isStreaming, false, "parent is idle before replacement drains");
    assert.equal(notices().length, 0);
    const rejected = await invoke("delegate_coordinate", {
      action,
      target,
      assignment: "rejected",
    });
    assert.equal(rejected.isError, true);
    assert.equal(notices().length, 0, "rejected admission adds no subscription");
    const before = parentRequests.length;
    drain.resolve();
    await eventually(
      () => notices().length === 1 && parentRequests.length > before && !f.session.isStreaming,
    );
    const notice = notices()[0];
    assert.ok(notice.role === "custom");
    const content = String(notice.content);
    assert.match(content, /"status": "settled"/);
    assert.match(content, new RegExp(`"generation": ${next.generation}`));
    assert.match(content, /replacement outcome/);
    assert.ok(
      parentRequests
        .slice(before)
        .some((request) => request.includes(JSON.stringify(content).slice(1, -1))),
      "actual parent provider sees completion without another user prompt",
    );
    assert.equal(notices().length, 1);
  });
}

for (const batch of [false, true]) {
  test(`native background ${batch ? "batch queues behind busy parent" : "single wakes idle parent"} only after all drain`, async (t) => {
    const drains = [gate(), gate()];
    const busy = gate();
    const busyEntered = gate();
    t.after(() => {
      drains.forEach((d) => d.resolve());
      busy.resolve();
    });
    const parentRequests: string[] = [];
    const f = await fixture(t, {
      speed: 0,
      extra: (pi) => {
        pi.on("tool_call", async (event) => {
          if (event.toolName !== "read" && event.toolName !== "write") return;
          const path = String(event.input.path);
          if (path.endsWith("busy.txt")) {
            busyEntered.resolve();
            await busy.promise;
          } else await drains[path.endsWith("second.txt") ? 1 : 0].promise;
        });
      },
      response: (context) => {
        const first = userText(context.messages.find((m) => m.role === "user"));
        const latest = userText(context.messages.at(-1));
        if (first.startsWith("ROOT ")) {
          parentRequests.push(JSON.stringify(context));
          if (latest.startsWith("ROOT "))
            return fauxAssistantMessage(
              fauxToolCall("delegate_task", JSON.parse(latest.slice(5))),
              { stopReason: "toolUse" },
            );
          if (latest === "BUSY")
            return fauxAssistantMessage(fauxToolCall("read", { path: "busy.txt" }), {
              stopReason: "toolUse",
            });
          return fauxAssistantMessage("parent acknowledged");
        }
        return context.messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage("outcome " + first)
          : fauxAssistantMessage(
              fauxToolCall("write", { path: first + ".txt", content: "written " + first }),
              {
                stopReason: "toolUse",
              },
            );
      },
    });
    for (const name of ["first", "second", "busy"])
      await writeFile(join(f.root, name + ".txt"), name);
    const items = ["first", "second"].map((assignment) => ({
      assignment,
      profile: "implementation",
    }));
    await f.session.prompt(
      "ROOT " +
        JSON.stringify(
          batch ? { tasks: items, background: true } : { ...items[0], background: true },
        ),
    );
    const notices = () =>
      f.session.messages.filter((m) => m.role === "custom" && m.customType === "delegation");
    assert.equal(notices().length, 0);
    let running: Promise<void> | undefined;
    if (batch) {
      running = f.session.prompt("BUSY");
      await busyEntered.promise;
    }
    const before = parentRequests.length;
    drains[batch ? 1 : 0].resolve();
    if (batch) {
      await eventually(() =>
        f.events.some((e) => e.child.assignment === "second" && e.child.disposed),
      );
      assert.equal(notices().length, 0, "batch waits for last member");
      assert.equal(await readFile(join(f.root, "second.txt"), "utf8"), "written second");
      assert.ok(!f.events.some((e) => e.child.assignment === "first" && e.child.disposed));
      drains[0].resolve();
      await eventually(() =>
        f.events.some((e) => e.child.assignment === "first" && e.child.disposed),
      );
      assert.equal(parentRequests.length, before, "completion does not interrupt busy tool");
      busy.resolve();
      await running;
    }
    await eventually(
      () => notices().length === 1 && parentRequests.length > before && !f.session.isStreaming,
    );
    const notice = notices()[0];
    assert.ok(notice.role === "custom");
    const content = String(notice.content);
    assert.ok(
      parentRequests
        .slice(before)
        .some((request) => request.includes(JSON.stringify(content).slice(1, -1))),
      "actual provider receives queued outcome",
    );
    const states = JSON.parse(content.slice(content.indexOf("\n") + 1));
    assert.deepEqual(
      (batch ? states : [states]).map((s: ChildSnapshot) => [s.assignment, s.status]),
      (batch ? ["first", "second"] : ["first"]).map((a) => [a, "settled"]),
    );
    assert.equal(notices().length, 1);
  });
}
