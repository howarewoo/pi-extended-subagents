import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { fixture, eventually } from "./fixtures.ts";

const latestUser = (context: Parameters<FauxResponseFactory>[0]) => {
  const user = context.messages.filter((message) => message.role === "user").at(-1);
  return typeof user?.content === "string"
    ? user.content
    : (user?.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("") ?? "");
};

test("completed restoration preserves exact SDK entry context, transcript, evidence and cumulative budgets", async (t) => {
  const contexts: Parameters<FauxResponseFactory>[0][] = [];
  const f = await fixture(t, {
    speed: 0,
    response: (context) => {
      contexts.push(structuredClone(context));
      if (latestUser(context) === "original" && context.messages.at(-1)?.role !== "toolResult")
        return fauxAssistantMessage(fauxToolCall("read", { path: "input.txt" }), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage(`answer ${latestUser(context)}`);
    },
  });
  await writeFile(join(f.root, "input.txt"), "original tool evidence");
  const ref = await f.direct("original", "general", { limits: { requests: 4 } });
  const first = await f.coordinator.wait(ref);
  assert.equal(first.status, "settled");
  assert.equal(first.retainedContext, true);
  const history = f.coordinator.messages(ref);
  const sessions = f.coordinator.sessions().length;
  for (const continuation of ["second", "third"]) {
    const result = await f.coordinator.resume(ref, continuation);
    assert.deepEqual(result, { id: ref.id, generation: ref.generation });
    const done = await f.coordinator.wait(ref);
    assert.equal(done.status, "settled", JSON.stringify(done));
    assert.equal(done.transcript, first.transcript);
    assert.equal(done.toolCalls, 1);
    assert.equal(f.coordinator.sessions().length, sessions);
    const sent = contexts.at(-1)!;
    assert.deepEqual(sent.messages.slice(0, history.length), history);
    assert.match(JSON.stringify(sent), /original tool evidence/);
    assert.match(JSON.stringify(sent), /delegation identity/);
    assert.equal(await readFile(first.artifacts!.text!, "utf8"), "answer original");
    assert.equal(await readFile(done.artifacts!.text!, "utf8"), `answer ${continuation}`);
  }
  const before = f.coordinator.snapshot(ref);
  assert.equal(before!.completedWindows!.length, 2);
  assert.equal(before!.telemetry.requests, 4);
  await assert.rejects(f.coordinator.resume(ref, "exhausted"), /cumulative.*budget/);
  assert.deepEqual(f.coordinator.snapshot(ref), before);
  assert.equal(
    JSON.stringify(f.coordinator.reopenTranscript(ref).messages),
    JSON.stringify(f.coordinator.messages(ref)),
  );
});

test("completed resume rejects revoked policy and unavailable state atomically, and stop wins a pending resume", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const ref = await f.direct("original");
  await f.coordinator.wait(ref);
  const original = f.coordinator.snapshot(ref);
  const count = f.events.length;
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(
    join(f.root, "operator", "delegation.json"),
    JSON.stringify({ general: { tools: ["read"] } }),
  );
  await assert.rejects(f.coordinator.resume(ref, "continue"), /grant revoked/);
  assert.deepEqual(f.coordinator.snapshot(ref), original);
  assert.equal(f.events.length, count);
  await writeFile(join(f.root, "operator", "delegation.json"), "{}");
  // Fault injection: loss of the canonical manager must not degrade into fresh context.
  const entry = (
    f.coordinator as unknown as { entries: Map<string, { sessionManager?: unknown }> }
  ).entries.get(ref.id)!;
  const manager = entry.sessionManager;
  entry.sessionManager = undefined;
  await assert.rejects(f.coordinator.resume(ref, "continue"), /canonical conversation state/);
  assert.deepEqual(f.coordinator.snapshot(ref), original);
  assert.equal(f.events.length, count);
  entry.sessionManager = manager;
  const auth = t.mock.method(ModelRegistry.prototype, "getApiKeyAndHeaders", async () => ({
    ok: false as const,
    error: "credentials revoked",
  }));
  await assert.rejects(f.coordinator.resume(ref, "revoked auth"), /credentials revoked/);
  assert.deepEqual(f.coordinator.snapshot(ref), original);
  assert.equal(f.events.length, count);
  auth.mock.restore();
  const transcript = await readFile(original!.transcript!, "utf8");
  await unlink(original!.transcript!);
  await assert.rejects(f.coordinator.resume(ref, "missing transcript"), /original transcript/);
  assert.deepEqual(f.coordinator.snapshot(ref), original);
  assert.equal(f.events.length, count);
  await writeFile(original!.transcript!, transcript);
  const pending = f.coordinator.resume(ref, "continue");
  await assert.rejects(f.coordinator.resume(ref, "duplicate"), /duplicate/);
  await f.coordinator.stop(ref);
  await assert.rejects(pending, /cancel|stopped/i);
  assert.deepEqual(
    f.coordinator.snapshot(ref),
    original,
    "stop retires a completed identity without erasing its outcome",
  );
  await assert.rejects(f.coordinator.resume(ref, "retired"), /stopped/);
});

test("a completed structured window needs a new submission; prior validated result and artifact remain evidence", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    response: (context) => {
      if (latestUser(context) === "original" && context.messages.at(-1)?.role !== "toolResult")
        return fauxAssistantMessage(fauxToolCall("submit_result", { value: 42 }), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage("prose only");
    },
  });
  const ref = await f.direct("original", "general", { resultSchema: { type: "integer" } });
  const first = await f.coordinator.wait(ref);
  assert.equal(first.status, "settled");
  assert.equal(first.outcome!.value, 42);
  await f.coordinator.resume(ref, "continue without a submission");
  const second = await f.coordinator.wait(ref);
  assert.equal(second.status, "failed");
  assert.match(second.error!, /not submitted/);
  assert.equal(second.outcome!.validation, "awaiting");
  assert.deepEqual(second.completedWindows![0].outcome, first.outcome);
  assert.equal(await readFile(first.artifacts!.structured!, "utf8"), "42");
  assert.equal(second.artifacts?.structured, undefined);
  await assert.rejects(f.coordinator.resume(ref, "cannot resume failure"), /failed/);
});

test("completed continuation cancellation drains its writer without losing earlier outcome", async (t) => {
  let entered = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    speed: 0,
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "write") {
          entered = true;
          await gate;
        }
      });
    },
    response: (context) =>
      latestUser(context) === "continue"
        ? fauxAssistantMessage(fauxToolCall("write", { path: "output.txt", content: "later" }), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("original evidence"),
  });
  try {
    const ref = await f.direct("original", "implementation");
    const first = await f.coordinator.wait(ref);
    await f.coordinator.resume(ref, "continue");
    await eventually(() => entered);
    const stop = f.coordinator.stop(ref);
    assert.equal(f.coordinator.snapshot(ref)!.writerLease, true);
    release();
    await stop;
    const cancelled = await f.coordinator.wait(ref);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.writerLease, false);
    assert.equal(cancelled.completedWindows![0].result, first.result);
    assert.equal(await readFile(first.artifacts!.text!, "utf8"), "original evidence");
    await assert.rejects(f.coordinator.resume(ref, "cannot restart"), /stopped/);
  } finally {
    release();
  }
});

test("completed restoration keeps the handed-off model, original system context and tool history without rearming prewalk", async (t) => {
  const seen: string[] = [];
  const f = await fixture(t, {
    speed: 0,
    response: () =>
      fauxAssistantMessage(
        fauxToolCall("write", { path: "prewalk.txt", content: "original write" }),
        { stopReason: "toolUse" },
      ),
  });
  const alt = fauxProvider({
    provider: "resume-target",
    models: [{ id: "target", reasoning: true }],
    tokensPerSecond: 0,
  });
  alt.setResponses([
    (context) => {
      seen.push(JSON.stringify(context));
      return fauxAssistantMessage("first target outcome");
    },
    (context) => {
      seen.push(JSON.stringify(context));
      return fauxAssistantMessage("continued target outcome");
    },
  ]);
  f.runtime.registerNativeProvider(alt.provider);
  const source = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  const target = { provider: "resume-target", id: "target", effort: "off" };
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(
    join(f.root, "operator", "delegation.json"),
    JSON.stringify({ implementation: { models: [source, target], prewalk: target } }),
  );
  const ref = await f.direct("plan and implement", "implementation");
  const first = await f.coordinator.wait(ref);
  assert.equal(first.prewalk?.status, "handed-off");
  f.runtime.unregisterProvider(source.provider);
  assert.equal(f.context.modelRegistry.find(source.provider, source.id), undefined);
  await f.coordinator.resume(ref, "continue implementation");
  const second = await f.coordinator.wait(ref);
  assert.equal(second.status, "settled", JSON.stringify(second));
  assert.equal(second.prewalk?.status, "handed-off");
  assert.deepEqual(second.model, first.model);
  assert.equal(second.toolCalls, 1);
  assert.equal(second.telemetry.requests, 3);
  assert.equal(second.transcript, first.transcript);
  assert.match(seen[1], /first target outcome/);
  assert.match(seen[1], /original write/);
  assert.match(seen[1], /Prewalk: investigate and plan/);
});

test("successful children resume only explicitly under the exact active parent; explicit retirement is sticky", async (t) => {
  let release!: () => void;
  let entered = 0;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    speed: 0,
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "read") {
          entered++;
          await gate;
        }
      });
    },
    response: (context) =>
      latestUser(context).includes("hold parent") && context.messages.at(-1)?.role !== "toolResult"
        ? fauxAssistantMessage(fauxToolCall("read", { path: "input.txt" }), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("completed evidence"),
  });
  await writeFile(join(f.root, "input.txt"), "parent gate");
  try {
    const parent = await f.direct("hold parent");
    await eventually(() => entered === 1);
    const child = await f.direct("child", "scout", { parent });
    const retired = await f.direct("retired child", "review", { parent });
    const first = await f.coordinator.wait(child);
    await f.coordinator.wait(retired);
    await f.coordinator.stop(retired);
    release();
    await f.coordinator.wait(parent);
    await assert.rejects(f.coordinator.resume(child, "inactive parent"), /parent.*active/);
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await f.coordinator.resume(parent, "hold parent again");
    await eventually(() => entered === 2);
    assert.equal(
      f.coordinator.snapshot(child)!.window,
      1,
      "parent resume does not resume children",
    );
    await assert.rejects(f.coordinator.resume(retired, "still retired"), /stopped/);
    await f.coordinator.resume(child, "explicit child continuation");
    const second = await f.coordinator.wait(child);
    assert.equal(second.status, "settled");
    assert.equal(second.window, 2);
    assert.equal(second.transcript, first.transcript);
    // Fault injection represents replacement of the exact original parent generation.
    const entries = (
      f.coordinator as unknown as { entries: Map<string, { state: { generation: number } }> }
    ).entries;
    const parentState = entries.get(parent.id)!.state;
    parentState.generation++;
    await assert.rejects(f.coordinator.resume(child, "wrong parent generation"), /stale/);
    parentState.generation--;
    await mkdir(join(f.root, "operator"), { recursive: true });
    await writeFile(
      join(f.root, "operator", "delegation.json"),
      JSON.stringify({ general: { spawn: [] } }),
    );
    await assert.rejects(f.coordinator.resume(child, "revoked lineage"), /spawn role revoked/);
  } finally {
    release();
  }
});
