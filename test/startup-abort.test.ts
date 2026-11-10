import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./fixtures.ts";

test("generation controls reject stale identities and stop drains setup before first streamed delta", { timeout: 10000 }, async t => {
  const { coordinator, direct } = await fixture(t, { speed: 10 });
  const ref = await direct("must abort before completing");
  await assert.rejects(coordinator.stop({ ...ref, generation: ref.generation + 1 }), /stale/);
  await assert.rejects(coordinator.steer({ ...ref, generation: 0 }, "stale"), /stale/);
  await coordinator.stop(ref);
  const state = coordinator.snapshot(ref)!;
  assert.equal(state.status, "cancelled"); assert.equal(state.disposed, true); assert.equal(state.progress, "");
  const disk = await readFile(state.transcript!, "utf8");
  assert.match(disk, /"stopReason":"aborted"/); assert.ok(!disk.includes('"stopReason":"stop"'));
});
