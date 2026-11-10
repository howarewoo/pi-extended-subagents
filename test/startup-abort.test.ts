import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProofCoordinator } from "../src/coordinator.ts";

test("acknowledged start is abortable before the first streamed delta", { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "extended-subagents-startup-"));
  const coordinator = new ProofCoordinator(root);
  try {
    await coordinator.start("must abort before completing");
    await coordinator.shutdown();
    const disk = await readFile(coordinator.snapshot().transcript!, "utf8");
    assert.match(disk, /"stopReason":"aborted"/);
    assert.ok(!disk.includes('"stopReason":"stop"'));
    assert.equal(coordinator.snapshot().progress, "");
    assert.equal(coordinator.snapshot().disposed, true);
  } finally {
    await coordinator.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
