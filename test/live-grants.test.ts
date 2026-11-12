import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";
import { readTaskInput } from "../src/task-input.ts";
import { resolveProfile } from "../src/profiles.ts";

for (const revoked of ["read", "spawn", "both", "malformed", "control"] as const) {
  test(`real SDK nested taskFile current ${revoked} grants precede public content dispatch`, async (t) => {
    let root = "";
    let secretReads = 0;
    const f = await fixture(t, {
      speed: 0,
      response(context) {
        const last = context.messages.at(-1);
        const user = context.messages.filter((m) => m.role === "user").at(-1);
        const text =
          typeof user?.content === "string"
            ? user.content
            : user?.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("");
        if (text?.startsWith("LAUNCH ") && last?.role !== "toolResult")
          return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
            stopReason: "toolUse",
          });
        if (text === "probe") {
          if (last?.role !== "toolResult")
            return fauxAssistantMessage(fauxToolCall("read", { path: "public.txt" }), {
              stopReason: "toolUse",
            });
          if (last.toolName === "read")
            return fauxAssistantMessage(
              fauxToolCall("delegate_task", { profile: "review", taskFile: "secret.txt" }),
              { stopReason: "toolUse" },
            );
        }
        return fauxAssistantMessage("done");
      },
      extra(pi) {
        pi.on("tool_call", async (event) => {
          if (event.toolName !== "read") return;
          const path = String(event.input.path);
          if (path.endsWith("secret.txt")) secretReads++;
          if (path.endsWith("public.txt")) {
            const scout = {
              tools: revoked === "read" || revoked === "both" ? ["ls"] : ["read", "ls"],
              spawn: revoked === "spawn" || revoked === "both" ? [] : ["review"],
            };
            await writeFile(
              join(root, "operator", "delegation.json"),
              revoked === "malformed"
                ? "{"
                : JSON.stringify({ scout, review: { tools: ["ls"], spawn: [] } }),
            );
          }
        });
      },
    });
    root = f.root;
    await mkdir(join(root, "operator"), { recursive: true });
    await writeFile(
      join(root, "operator", "delegation.json"),
      JSON.stringify({
        scout: { tools: ["read", "ls"], spawn: ["review"] },
        review: { tools: ["ls"], spawn: [] },
      }),
    );
    await writeFile(join(root, "public.txt"), "public");
    await writeFile(join(root, "secret.txt"), "private assignment");
    const child = await f.launch("probe", "scout", true);
    await eventually(() => f.events.some((e) => e.child.id === child.id && e.child.disposed));
    const ids = new Set(f.events.map((e) => e.child.id));
    assert.equal(secretReads, revoked === "control" ? 1 : 0, "root content read dispatches");
    assert.equal(ids.size, revoked === "control" ? 2 : 1, "new children");
    if (revoked === "control")
      assert.ok(f.events.some((e) => e.child.assignment === "private assignment"));
  });
}

async function heldFixture(t: Parameters<typeof fixture>[0]) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let secretReads = 0;
  let heldReads = 0;
  t.after(release);
  const f = await fixture(t, {
    speed: 0,
    response(context) {
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
      const user = context.messages.findLast((m) => m.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : user?.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("");
      return text === "held"
        ? fauxAssistantMessage(fauxToolCall("read", { path: "held.txt" }), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("done");
    },
    extra(pi) {
      pi.on("tool_call", async (event) => {
        if (event.toolName !== "read") return;
        if (String(event.input.path).endsWith("held.txt")) {
          heldReads++;
          await gate;
        }
        if (String(event.input.path).endsWith("secret.txt")) secretReads++;
      });
    },
  });
  const actions = ["message", "inbox", "wait"];
  const grants = {
    general: { tools: ["read", "ls"], coordination: actions, spawn: ["scout", "review"] },
    scout: { tools: ["read", "ls"], coordination: actions, spawn: ["review"] },
    review: { tools: ["ls"], coordination: [], spawn: [] },
  };
  const config = async (value: object | string) => {
    await mkdir(join(f.root, "operator"), { recursive: true });
    await writeFile(
      join(f.root, "operator", "delegation.json"),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  await config(grants);
  await writeFile(join(f.root, "held.txt"), "held");
  await writeFile(join(f.root, "secret.txt"), "private assignment");
  return { f, grants, config, release, heldReads: () => heldReads, secretReads: () => secretReads };
}

test("nested general admission filters unavailable configured leaf tools", async (t) => {
  const { f, config, release, heldReads } = await heldFixture(t);
  await config({
    general: { tools: ["read"], spawn: ["general"], leafTools: ["unavailable_leaf"] },
  });
  const parent = await f.direct("held");
  await eventually(() => heldReads() === 1);
  const child = await f.direct("held", "general", { parent });
  await eventually(() => heldReads() === 2);
  for (const ref of [parent, child]) {
    const state = f.coordinator.snapshot(ref)!;
    assert.deepEqual(state.tools, ["read"]);
    assert.deepEqual(state.leafTools, []);
    assert.ok(
      state.capabilityDenials?.some(
        (denial) =>
          denial.name === "unavailable_leaf" && /metadata unavailable/.test(denial.reason),
      ),
    );
  }
  release();
});

test("nested general taskFile preflight filters unavailable configured leaf tools", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    response(context) {
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : user?.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("");
      const task = text?.startsWith("LAUNCH ")
        ? JSON.parse(text.slice(7))
        : text === "probe"
          ? { profile: "general", taskFile: "task.txt" }
          : undefined;
      return task
        ? fauxAssistantMessage(fauxToolCall("delegate_task", task), { stopReason: "toolUse" })
        : fauxAssistantMessage("done");
    },
  });
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(
    join(f.root, "operator", "delegation.json"),
    JSON.stringify({
      general: { tools: ["read"], spawn: ["general"], leafTools: ["unavailable_leaf"] },
    }),
  );
  await writeFile(join(f.root, "task.txt"), "nested assignment");
  await f.launch("probe", "general", false);
  const children = new Map(f.events.map((event) => [event.child.id, event.child]));
  assert.equal(children.size, 2);
  assert.ok([...children.values()].some((child) => child.assignment === "nested assignment"));
  for (const child of children.values()) {
    assert.deepEqual(child.tools, ["read"]);
    assert.deepEqual(child.leafTools, []);
    assert.equal(child.status, "settled");
  }
});

// Use a real captured public dispatcher, not a synthetic read result.

test("current ancestor revocation denies taskFile reads and spawning before effects", async (t) => {
  const { f, grants, config, release, secretReads, heldReads } = await heldFixture(t);
  const parent = await f.direct("held");
  const child = await f.direct("held", "scout", { parent });
  await eventually(() => heldReads() === 2);
  const profile = (await resolveProfile("review", f.root, false)).profile;
  await config({ ...grants, general: { ...grants.general, tools: ["ls"] } });
  const before = f.coordinator.snapshot(child)!;
  await assert.rejects(
    readTaskInput("secret.txt", f.context, undefined, () => f.coordinator.taskInputRead(child)),
    /read grant/,
  );
  assert.equal(secretReads(), 0);
  assert.equal(f.coordinator.snapshot(child)!.toolCalls, before.toolCalls);
  await config({ ...grants, general: { ...grants.general, spawn: [] } });
  await assert.rejects(f.coordinator.authorizeSpawn(child, profile), /spawn grant/);
  await assert.rejects(f.direct("must not launch", "review", { parent: child }), /spawn grant/);
  assert.equal(f.coordinator.snapshot(child)!.spawned, 0);
  assert.equal(new Set(f.events.map((e) => e.child.id)).size, 2);
  release();
});

test("coordination current revocation fails without sending, consuming mail or allocating waiters", async (t) => {
  const { f, grants, config, release, heldReads } = await heldFixture(t);
  const parent = await f.direct("held");
  const child = await f.direct("held", "scout", { parent });
  await eventually(() => heldReads() === 2);
  await f.coordinator.message(undefined, child, "retain me");
  for (const policy of [
    { ...grants, scout: { ...grants.scout, coordination: [] } },
    { ...grants, general: { ...grants.general, coordination: [] } },
    "{",
  ]) {
    await config(policy);
    await assert.rejects(f.coordinator.message(child, parent, "denied"), /denied|Invalid/);
    await assert.rejects(f.coordinator.inbox(child), /denied|Invalid/);
    for (let i = 0; i < 65; i++)
      await assert.rejects(f.coordinator.coordinateWait(child, undefined, 60000), /denied|Invalid/);
    assert.deepEqual(await f.coordinator.inbox(), []);
  }
  await config(grants);
  assert.deepEqual(
    (await f.coordinator.inbox(child)).map((m) => m.text),
    ["retain me"],
  );
  await f.coordinator.message(child, parent, "authorized");
  assert.deepEqual(
    (await f.coordinator.inbox(parent)).map((m) => m.text),
    ["authorized"],
  );
  const authorizedWait = f.coordinator.coordinateWait(child, undefined, 60000);
  await f.coordinator.message(undefined, child, "wake");
  assert.equal((await authorizedWait).status, "messages");
  const abort = new AbortController();
  const waiters = Array.from({ length: 64 }, () =>
    f.coordinator.coordinateWait(undefined, undefined, 60000, abort.signal),
  );
  await assert.rejects(f.coordinator.coordinateWait(undefined, undefined, 60000), /waiter limit/);
  abort.abort();
  assert.ok((await Promise.all(waiters)).every((w) => w.status === "cancelled"));
  release();
});

test("cancellation during async authorization wins before taskFile dispatch and budget use", async (t) => {
  const { f, release, secretReads, heldReads } = await heldFixture(t);
  let cancel = false;
  let stopping: Promise<void> | undefined;
  let child: Awaited<ReturnType<typeof f.direct>>;
  child = await f.direct("held", "scout", {
    availableSkills() {
      if (cancel) {
        cancel = false;
        stopping = f.coordinator.stop(child);
      }
      return [];
    },
  });
  await eventually(() => heldReads() === 1);
  const calls = f.coordinator.snapshot(child)!.toolCalls;
  cancel = true;
  await assert.rejects(
    readTaskInput("secret.txt", f.context, undefined, () => f.coordinator.taskInputRead(child)),
    /no longer active/,
  );
  assert.equal(secretReads(), 0);
  assert.equal(f.coordinator.snapshot(child)!.toolCalls, calls);
  release();
  await stopping;
});

for (const action of ["spawn", "message", "inbox", "wait"] as const) {
  test(`cancellation during ${action} authorization leaves protected effects untouched`, async (t) => {
    const { f, release, heldReads } = await heldFixture(t);
    let cancel = false;
    let stopping: Promise<void> | undefined;
    let child: Awaited<ReturnType<typeof f.direct>>;
    child = await f.direct("held", "scout", {
      availableSkills() {
        if (cancel) {
          cancel = false;
          stopping = f.coordinator.stop(child);
        }
        return [];
      },
    });
    await eventually(() => heldReads() === 1);
    const queued = await f.coordinator.message(undefined, child, "retained");
    const receipt = f.coordinator.coordinateWait(undefined, undefined, 60000, undefined, queued.id);
    cancel = true;
    const attempt =
      action === "spawn"
        ? f.coordinator.authorizeSpawn(
            child,
            (await resolveProfile("review", f.root, false)).profile,
          )
        : action === "message"
          ? f.coordinator.message(child, undefined, "must not send")
          : action === "inbox"
            ? f.coordinator.inbox(child)
            : f.coordinator.coordinateWait(child, undefined, 60000);
    await assert.rejects(attempt, /no longer active/);
    assert.deepEqual(await f.coordinator.inbox(), []);
    assert.equal(f.coordinator.snapshot(child)!.spawned, 0);
    assert.equal(queued.status, "accepted");
    release();
    await stopping;
    const result = await receipt;
    assert.equal(result.status, "message");
    if (result.status === "message") assert.equal(result.message.status, "not-running");
  });
}

test("taskFile reads authorize and check abort before charging; exhaustion never dispatches", async (t) => {
  const { f, grants, config, release, heldReads, secretReads } = await heldFixture(t);
  const child = await f.direct("held", "scout", { limits: { tools: 1 } });
  await eventually(() => heldReads() === 1);
  assert.equal(f.coordinator.snapshot(child)!.toolCalls, 1);
  const abort = new AbortController();
  abort.abort(new Error("read aborted"));
  await config({ ...grants, scout: { ...grants.scout, tools: ["ls"] } });
  await assert.rejects(f.coordinator.taskInputRead(child, abort.signal), /read grant/);
  await config(grants);
  await assert.rejects(f.coordinator.taskInputRead(child, abort.signal), /read aborted/);
  assert.equal(f.coordinator.snapshot(child)!.limitReason, undefined);
  assert.equal(f.coordinator.snapshot(child)!.toolCalls, 1);
  await assert.rejects(
    readTaskInput("secret.txt", f.context, undefined, () => f.coordinator.taskInputRead(child)),
    /Tool call limit/,
  );
  assert.equal(secretReads(), 0);
  assert.equal(f.coordinator.snapshot(child)!.toolCalls, 1);
  assert.equal(f.coordinator.snapshot(child)!.limitReason, "tools");
  release();
  assert.equal((await f.coordinator.wait(child)).status, "cancelled");
});

test("spawn authorization treats omitted and empty optional descendant grants alike", async (t) => {
  const { f, release, heldReads } = await heldFixture(t);
  const parent = await f.direct("held", "scout");
  await eventually(() => heldReads() === 1);
  const { profile } = await resolveProfile("review", f.root, false);
  for (const grants of [
    { leafTools: undefined, spawn: undefined, coordination: undefined },
    { leafTools: [], spawn: [], coordination: [] },
  ]) {
    await f.coordinator.authorizeSpawn(parent, { ...profile, ...grants });
    assert.equal(f.coordinator.snapshot(parent)!.spawned, 0);
  }
  release();
});
