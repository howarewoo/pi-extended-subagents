import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { DelegationCoordinator, type ChildSnapshot } from "../src/coordinator.ts";

test("foreground SDK stream coalesces previews without coalescing registry events", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const partials: ChildSnapshot[] = [];
  f.session.subscribe((event) => {
    if (event.type === "tool_execution_update" && event.toolName === "delegate_task")
      partials.push(event.partialResult.details as ChildSnapshot);
  });
  const errors: unknown[] = [];
  let deltas = 0;
  let reads = 0;
  let latest: ChildSnapshot | undefined;
  const snapshot = DelegationCoordinator.prototype.snapshot;
  t.mock.method(
    DelegationCoordinator.prototype,
    "snapshot",
    function (this: DelegationCoordinator, ...args: Parameters<typeof snapshot>) {
      reads++;
      latest = snapshot.apply(this, args);
      return latest;
    },
  );
  const subscribe = DelegationCoordinator.prototype.subscribe;
  t.mock.method(
    DelegationCoordinator.prototype,
    "subscribe",
    function (this: DelegationCoordinator, listener: Parameters<typeof subscribe>[0]) {
      return subscribe.call(this, (event) => {
        try {
          const beforeReads = reads;
          listener(event);
          if (event.event?.type === "message_update") {
            deltas++;
            assert.equal(reads, beforeReads, "delta does not rebuild the batch snapshots");
            if (deltas % 100 === 0) {
              t.mock.timers.tick(49);
              assert.equal(reads, beforeReads, "no preview before the 50ms boundary");
              t.mock.timers.tick(1);
              assert.equal(reads, beforeReads + 1);
              assert.equal(latest!.progress, event.child.progress, "flush reads latest progress");
            }
          } else if (event.child.status !== "queued") {
            assert.equal(reads, beforeReads + 1, "lifecycle preview construction is immediate");
          }
        } catch (error) {
          errors.push(error);
        }
      });
    },
  );
  // Enable only after fixture startup; the zero-speed faux provider needs no clock ticks.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await f.launch("stream ".repeat(400), "scout", false);
  const raw = f.events.filter((e) => e.event?.type === "message_update");
  assert.equal(raw.length, deltas, "all raw SDK deltas still reach public registry observers");
  assert.deepEqual(errors, []);
  assert.ok(deltas > 500);
  assert.ok(partials.length < deltas / 10, "representative stream constructs far fewer previews");
  assert.equal(partials.at(-1)!.disposed, true);
  assert.equal(partials.at(-1)!.status, "settled");
  const count = partials.length;
  t.mock.timers.tick(1000);
  assert.equal(partials.length, count, "completion clears pending updates");
  assert.equal(f.session.messages.filter((m) => m.role === "custom").length, 0);
  t.diagnostic(
    `${deltas} raw deltas; ${partials.length} partial previews; ${reads} snapshot reads`,
  );
  t.mock.timers.reset();
});

test("foreground without onUpdate does not snapshot or subscribe for presentation", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const warmup = await f.direct("warmup");
  await f.coordinator.wait(warmup);
  const snapshot = t.mock.method(DelegationCoordinator.prototype, "snapshot");
  const subscribe = t.mock.method(DelegationCoordinator.prototype, "subscribe");
  const tool = f.session.extensionRunner.getToolDefinition("delegate_task")!;
  const result = await tool.execute(
    "no-update",
    { assignment: "stream ".repeat(400), profile: "scout" },
    undefined,
    undefined,
    f.context,
  );
  assert.equal(result.isError, false);
  assert.equal(snapshot.mock.callCount(), 0);
  assert.equal(subscribe.mock.callCount(), 0);
  assert.ok(f.events.filter((event) => event.event?.type === "message_update").length > 500);
});

test("foreground batch retains input order and detached partial snapshots", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const warmup = await f.direct("warmup");
  await f.coordinator.wait(warmup);
  const tool = f.session.extensionRunner.getToolDefinition("delegate_task")!;
  const partials: ChildSnapshot[][] = [];
  const result = await tool.execute(
    "batch",
    {
      tasks: [
        { assignment: "first ".repeat(200), profile: "scout" },
        { assignment: "second", profile: "scout" },
      ],
    },
    undefined,
    (update) => {
      const states = (update.details as { children: ChildSnapshot[] }).children;
      partials.push(structuredClone(states));
      Reflect.set(states[0], "progress", "observer mutation");
    },
    f.context,
  );
  const children = (result.details as { children: ChildSnapshot[] }).children;
  assert.deepEqual(
    children.map((c) => c.assignment),
    ["first ".repeat(200), "second"],
  );
  assert.ok(children.every((c) => c.disposed && c.status === "settled"));
  assert.ok(children.every((c) => !c.progress.includes("observer mutation")));
  assert.ok(partials.length > 0);
  assert.ok(
    partials.every(
      (states) => states[0].assignment.startsWith("first ") && states[1].assignment === "second",
    ),
  );
  assert.equal(f.session.messages.filter((m) => m.role === "custom").length, 0);
});

test("foreground abort clears pending deltas and drains without a delayed update", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const warmup = await f.direct("warmup");
  await f.coordinator.wait(warmup);
  const controller = new AbortController();
  let updates = 0;
  let deltas = 0;
  const subscribe = DelegationCoordinator.prototype.subscribe;
  t.mock.method(
    DelegationCoordinator.prototype,
    "subscribe",
    function (this: DelegationCoordinator, listener: Parameters<typeof subscribe>[0]) {
      return subscribe.call(this, (event) => {
        listener(event);
        if (event.event?.type === "message_update" && ++deltas === 10) controller.abort();
      });
    },
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tool = f.session.extensionRunner.getToolDefinition("delegate_task")!;
  const result = await tool.execute(
    "abort",
    { assignment: "stream ".repeat(400), profile: "scout" },
    controller.signal,
    () => {
      updates++;
    },
    f.context,
  );
  assert.equal((result.details as ChildSnapshot).status, "cancelled");
  assert.equal((result.details as ChildSnapshot).disposed, true);
  assert.ok(deltas >= 10);
  const count = updates;
  t.mock.timers.tick(1000);
  assert.equal(updates, count);
  t.mock.timers.reset();
});
