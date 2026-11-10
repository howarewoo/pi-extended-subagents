// A direct isolated SDK exercise, not a model benchmark or standalone test runner.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProofCoordinator } from "../src/coordinator.ts";

const root = await mkdtemp(join(tmpdir(), "extended-subagents-exercise-"));
const child = new ProofCoordinator(root);
try {
  const firstDelta = new Promise<void>(resolve => {
    const unsubscribe = child.subscribe(() => {
      if (child.snapshot().progress) { unsubscribe(); resolve(); }
    });
  });
  await child.start("SDK lifecycle exercise", 1000);
  await firstDelta;
  assert.equal(await child.steer("steering reached the next real SDK turn"), "queued");
  await child.wait();
  assert.match(child.snapshot().result, /steering reached/);
  assert.ok(child.reopenTranscript().messages.length >= 4);
  console.log("Real Pi SDK: streamed progress, queued steering, final result, persistent transcript reopen: PASS");
} finally {
  await child.shutdown();
  assert.equal(child.snapshot().disposed, true);
  await rm(root, { recursive: true, force: true });
}
console.log("Parent-owned cleanup: PASS. Controlled Pi faux provider only; no paid/provider or interactive TUI verification.");
