import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture } from "./fixtures.ts";
import { resolveProfile } from "../src/profiles.ts";

const alternate = { provider: "alternate-controlled", id: "alternative", effort: "high" as const };
async function configure(root: string, value: unknown) {
  await mkdir(join(root, "operator"), { recursive: true });
  await writeFile(join(root, "operator", "delegation.json"), JSON.stringify(value));
}
function lastResult(session: Awaited<ReturnType<typeof fixture>>["session"]) {
  const result = session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "delegate_task",
  );
  assert.ok(result?.role === "toolResult");
  return result;
}

test("exact operator model/effort dispatch uses alternate native provider auth without fallback or parent usage", async (t) => {
  const { root, session, runtime, events } = await fixture(t);
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  alt.setResponses([fauxAssistantMessage("alternate selected")]);
  const seen: { id: string; effort?: string; key?: string }[] = [];
  runtime.registerNativeProvider({
    ...alt.provider,
    auth: {
      apiKey: {
        name: "controlled",
        resolve: async ({ credential }) =>
          credential?.type === "api_key" ? { auth: { apiKey: credential.key } } : undefined,
      },
    },
    streamSimple: (model, context, options) => {
      seen.push({ id: model.id, effort: options?.reasoning, key: options?.apiKey });
      return alt.provider.streamSimple(model, context, options);
    },
  });
  await runtime.setRuntimeApiKey(alternate.provider, "alternate-key-not-persisted");
  await configure(root, { general: { models: [alternate] } });
  await session.prompt(
    "LAUNCH " +
      JSON.stringify({ profile: "general", assignment: "use alternate", model: alternate }),
  );
  const state = events.at(-1)!.child;
  assert.equal(lastResult(session).isError, false);
  assert.deepEqual(state.model, { provider: alternate.provider, id: alternate.id });
  assert.equal(state.effort, "high");
  assert.equal(state.telemetry.requests, 1);
  assert.deepEqual(seen, [
    { id: alternate.id, effort: "high", key: "alternate-key-not-persisted" },
  ]);
  assert.doesNotMatch(await readFile(state.transcript!, "utf8"), /alternate-key-not-persisted/);
});

test("missing grants, unknown models, unsupported effort and invalid later batch deny before all setup", async (t) => {
  const { root, session, model, events } = await fixture(t);
  const selected = { provider: model.getModel().provider, id: model.getModel().id, effort: "off" };
  for (const request of [
    alternate,
    { ...selected, id: "unknown" },
    { ...selected, effort: "max" },
  ]) {
    const before = events.length;
    await session.prompt(
      "LAUNCH " +
        JSON.stringify({
          tasks: [
            { profile: "general", assignment: "valid" },
            { profile: "general", assignment: "denied", model: request },
          ],
        }),
    );
    assert.equal(lastResult(session).isError, true);
    assert.equal(events.length, before);
  }
  await configure(root, { general: { models: [{ ...selected, effort: "max" }] } });
  await session.prompt(
    "LAUNCH " +
      JSON.stringify({
        profile: "general",
        assignment: "unsupported",
        model: { ...selected, effort: "max" },
      }),
  );
  assert.equal(lastResult(session).isError, true);
  assert.equal(events.length, 0);
  assert.match(JSON.stringify(lastResult(session)), /Unsupported model effort/);
  await configure(root, { implementation: { models: [selected, alternate], prewalk: alternate } });
  await session.prompt(
    "LAUNCH " +
      JSON.stringify({
        tasks: [
          { profile: "general", assignment: "valid first" },
          { profile: "implementation", assignment: "unavailable later prewalk" },
        ],
      }),
  );
  assert.equal(lastResult(session).isError, true);
  assert.match(JSON.stringify(lastResult(session)), /unknown physical/);
  assert.equal(events.length, 0, "invalid later prewalk target cannot start earlier valid task");
});

test("project exact model allowlist may narrow but cannot mint model or prewalk authority", async (t) => {
  const { root } = await fixture(t);
  await configure(root, { general: { models: [alternate] } });
  await mkdir(join(root, ".pi"));
  await writeFile(
    join(root, ".pi", "delegation.json"),
    JSON.stringify({ general: { models: [] } }),
  );
  assert.deepEqual((await resolveProfile("general", root, true)).profile.models, []);
  await writeFile(
    join(root, ".pi", "delegation.json"),
    JSON.stringify({ general: { models: [{ ...alternate, effort: "low" }] } }),
  );
  await assert.rejects(resolveProfile("general", root, true), /mint model/);
  await writeFile(
    join(root, ".pi", "delegation.json"),
    JSON.stringify({ general: { prewalk: alternate } }),
  );
  await assert.rejects(resolveProfile("general", root, true), /mint prewalk/);
});

test("prewalk same SDK session switches once after completed write; direct requests and transcript retain both models", async (t) => {
  const { root, session, runtime, model, events } = await fixture(t, {
    speed: 0,
    response: (context) => {
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (text.startsWith("LAUNCH "))
        return context.messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage("done")
          : fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
              stopReason: "toolUse",
            });
      return fauxAssistantMessage(
        fauxToolCall("write", { path: "prewalk.txt", content: "planning model wrote" }),
        { stopReason: "toolUse" },
      );
    },
  });
  const source = { provider: model.getModel().provider, id: model.getModel().id, effort: "off" };
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  alt.setResponses([fauxAssistantMessage("target finished")]);
  runtime.registerNativeProvider(alt.provider);
  await configure(root, { implementation: { models: [source, alternate], prewalk: alternate } });
  await session.prompt(
    "LAUNCH " + JSON.stringify({ profile: "implementation", assignment: "plan then implement" }),
  );
  const state = events.at(-1)!.child;
  assert.equal(lastResult(session).isError, false, JSON.stringify(lastResult(session)));
  assert.equal(state.prewalk?.status, "handed-off");
  assert.deepEqual(state.model, { provider: alternate.provider, id: alternate.id });
  assert.equal(state.telemetry.requests, 2);
  assert.equal(state.toolCalls, 1);
  assert.equal(await readFile(join(root, "prewalk.txt"), "utf8"), "planning model wrote");
  const transcript = await readFile(state.transcript!, "utf8");
  assert.match(transcript, /target finished/);
  assert.match(transcript, /model_change/);
  const messages = transcript
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          message?: { role: string; usage?: { totalTokens: number; cost: { total: number } } };
        },
    )
    .filter((entry) => entry.message?.role === "assistant");
  assert.equal(messages.length, 2);
  assert.equal(
    state.telemetry.tokens!.total,
    messages.reduce((total, entry) => total + entry.message!.usage!.totalTokens, 0),
  );
  assert.equal(
    state.telemetry.cost,
    messages.reduce((total, entry) => total + entry.message!.usage!.cost.total, 0),
  );
});

test("live operator revocation before continuation denies the next direct dispatch", async (t) => {
  let root = "";
  const f = await fixture(t, {
    speed: 0,
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "read") {
          await configure(root, { general: { models: [] } });
          return { block: true, reason: "controlled denied read" };
        }
      });
    },
    response: (context) => {
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
      if (text.startsWith("LAUNCH "))
        return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage(fauxToolCall("read", { path: "denied.txt" }), {
        stopReason: "toolUse",
      });
    },
  });
  root = f.root;
  const selected = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  await configure(root, { general: { models: [selected] } });
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({
        profile: "general",
        assignment: "revoke before continuation",
        model: selected,
      }),
  );
  const state = f.events.at(-1)!.child;
  assert.equal(state.status, "failed");
  assert.equal(state.telemetry.requests, 1);
  assert.match(state.error!, /policy denied/);
  assert.equal(state.disposed, true);
});

test("request-narrowed ancestor allowlist denies otherwise operator-granted descendant model without child setup", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    response: (context) => {
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("observed");
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (text.startsWith("LAUNCH "))
        return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage(
        fauxToolCall("delegate_task", {
          profile: "general",
          assignment: "descendant",
          model: alternate,
        }),
        { stopReason: "toolUse" },
      );
    },
  });
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  f.runtime.registerNativeProvider(alt.provider);
  const source = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  await configure(f.root, {
    scout: { models: [source, alternate], spawn: ["general"] },
    general: { models: [alternate] },
  });
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({ assignment: "nested model denied", profile: "scout", models: [source] }),
  );
  const state = f.events.at(-1)!.child;
  assert.equal(
    f.events.some((event) => event.child.depth === 2),
    false,
  );
  assert.match(await readFile(state.transcript!, "utf8"), /ancestor model grants/);
});

test("prewalk target survives fresh-generation renewal without rearming; missing current grant denies renewal", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    response: (context) => {
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("observed");
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (text.startsWith("LAUNCH "))
        return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
          stopReason: "toolUse",
        });
      if (text.startsWith("COORD "))
        return fauxAssistantMessage(
          fauxToolCall("delegate_coordinate", JSON.parse(text.slice(6))),
          { stopReason: "toolUse" },
        );
      return fauxAssistantMessage(
        fauxToolCall("write", { path: "renewal.txt", content: "first generation" }),
        { stopReason: "toolUse" },
      );
    },
  });
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  alt.setResponses([fauxAssistantMessage("first target"), fauxAssistantMessage("renewed target")]);
  f.runtime.registerNativeProvider(alt.provider);
  const source = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  await configure(f.root, { implementation: { models: [source, alternate], prewalk: alternate } });
  await f.launch("initial prewalk", "implementation", false);
  const first = f.events.at(-1)!.child;
  await f.session.prompt(
    "COORD " +
      JSON.stringify({
        action: "followup",
        target: { id: first.id, generation: 1 },
        assignment: "fresh target",
      }),
  );
  const { eventually } = await import("./fixtures.ts");
  await eventually(() =>
    f.events.some((event) => event.child.generation === 2 && event.child.disposed),
  );
  const second = f.events.at(-1)!.child;
  assert.equal(second.prewalk?.status, "handed-off");
  assert.equal(second.telemetry.requests, 1);
  assert.equal(second.toolCalls, 0);
  assert.equal(second.result, "renewed target");
  assert.equal(first.prewalk?.status, "handed-off");
  assert.equal(first.generation, 1);
  await configure(f.root, { implementation: { models: [source] } });
  await f.session.prompt(
    "COORD " +
      JSON.stringify({
        action: "followup",
        target: { id: first.id, generation: 2 },
        assignment: "revoked",
      }),
  );
  const result = f.session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "delegate_coordinate",
  );
  assert.ok(result?.role === "toolResult" && result.isError);
  assert.equal(f.events.at(-1)!.child.generation, 2);
});

test("prewalk cancellation holds writer ownership through real permission drain and never dispatches target", async (t) => {
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, {
    speed: 0,
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "write") {
          entered();
          await gate;
          return { block: true, reason: "controlled write denied" };
        }
      });
    },
    response: (context) => {
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (text.startsWith("LAUNCH "))
        return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage(
        fauxToolCall("write", { path: "cancelled.txt", content: "must not write" }),
        { stopReason: "toolUse" },
      );
    },
  });
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  alt.setResponses([fauxAssistantMessage("must not dispatch")]);
  f.runtime.registerNativeProvider(alt.provider);
  const source = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  await configure(f.root, { implementation: { models: [source, alternate], prewalk: alternate } });
  let stop: Promise<void> | undefined;
  try {
    const ref = await f.launch("held prewalk", "implementation");
    await writing;
    stop = f.session.prompt(`/subagent-stop ${ref.id} ${ref.generation}`);
    const { eventually } = await import("./fixtures.ts");
    await eventually(() => f.events.at(-1)!.child.status === "draining");
    const held = f.events.at(-1)!.child;
    assert.equal(held.writerLease, true);
    assert.equal(held.disposed, false);
    assert.equal(held.prewalk?.status, "armed");
    release();
    await stop;
    const state = f.events.at(-1)!.child;
    assert.equal(state.status, "cancelled");
    assert.equal(state.telemetry.requests, 1);
    assert.equal(state.prewalk?.status, "armed");
    assert.equal(state.writerLease, false);
    assert.equal(alt.getPendingResponseCount(), 1);
    await assert.rejects(readFile(join(f.root, "cancelled.txt")), /ENOENT/);
  } finally {
    release();
    await stop;
  }
});

test("granted unknown or out-of-scope selections still deny atomically before dispatch", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const unknown = { ...alternate, id: "not-in-registry" };
  await configure(f.root, { general: { models: [unknown] } });
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({ profile: "general", assignment: "unknown granted", model: unknown }),
  );
  assert.equal(lastResult(f.session).isError, true);
  assert.match(JSON.stringify(lastResult(f.session)), /unknown physical/);
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
  });
  f.runtime.registerNativeProvider(alt.provider);
  await configure(f.root, { general: { models: [alternate] } });
  f.session.setScopedModels([{ model: f.model.getModel(), thinkingLevel: "off" }]);
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({ profile: "general", assignment: "outside scope", model: alternate }),
  );
  assert.equal(lastResult(f.session).isError, true);
  assert.match(JSON.stringify(lastResult(f.session)), /outside parent scoped/);
  assert.equal(f.events.length, 0);
  assert.equal(alt.getPendingResponseCount(), 0);
  const off = { ...alternate, effort: "off" };
  await configure(f.root, { general: { models: [alternate, off] } });
  f.session.setScopedModels([
    { model: f.model.getModel(), thinkingLevel: "off" },
    { model: alt.getModel(), thinkingLevel: "high" },
  ]);
  await f.session.prompt(
    "LAUNCH " + JSON.stringify({ profile: "general", assignment: "scope effort pin", model: off }),
  );
  assert.equal(lastResult(f.session).isError, true);
  assert.match(JSON.stringify(lastResult(f.session)), /scoped models\/effort/);
  f.session.setScopedModels([]);
  const invalid = fauxProvider({
    provider: alternate.provider,
    models: [{ id: "unbounded", maxTokens: 0, contextWindow: 0 }],
  });
  f.runtime.registerNativeProvider(invalid.provider);
  const bounded = { provider: alternate.provider, id: "unbounded", effort: "off" };
  await configure(f.root, { general: { models: [bounded] } });
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({ profile: "general", assignment: "invalid model limits", model: bounded }),
  );
  assert.equal(lastResult(f.session).isError, true);
  assert.match(JSON.stringify(lastResult(f.session)), /known finite context and output/);
  assert.equal(f.events.length, 0);
});

test("default descendant inherits its actual immediate parent's alternate model/effort, not root selection", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  const respond: Parameters<typeof alt.setResponses>[0][number] = (context) => {
    alt.appendResponses([respond]);
    if (context.messages.at(-1)?.role === "toolResult")
      return fauxAssistantMessage("nested finished");
    const user = context.messages.findLast((message) => message.role === "user");
    const text =
      typeof user?.content === "string"
        ? user.content
        : (user?.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("") ?? "");
    return text === "alternate parent"
      ? fauxAssistantMessage(
          fauxToolCall("delegate_task", { profile: "general", assignment: "inherited leaf" }),
          { stopReason: "toolUse" },
        )
      : fauxAssistantMessage("leaf on alternate");
  };
  alt.setResponses([respond]);
  f.runtime.registerNativeProvider(alt.provider);
  await configure(f.root, {
    scout: { models: [alternate], spawn: ["general"] },
    general: { spawn: [] },
  });
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({ profile: "scout", assignment: "alternate parent", model: alternate }),
  );
  assert.equal(lastResult(f.session).isError, false, JSON.stringify(lastResult(f.session)));
  const leaf = f.events.findLast((event) => event.child.depth === 2)!.child;
  assert.equal(leaf.status, "settled");
  assert.deepEqual(leaf.model, { provider: alternate.provider, id: alternate.id });
  assert.equal(leaf.effort, "high");
  assert.equal(leaf.telemetry.requests, 1);
  assert.equal(f.events.at(-1)!.child.telemetry.requests, 2);
});

test("revoking prewalk while its write permission runs prevents handoff even if target model grant remains", async (t) => {
  let root = "",
    source: { provider: string; id: string; effort: "off" };
  const f = await fixture(t, {
    speed: 0,
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "write") {
          await configure(root, { implementation: { models: [source, alternate] } });
          return { block: true, reason: "prewalk revoked during write" };
        }
      });
    },
    response: (context) => {
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      return text.startsWith("LAUNCH ")
        ? fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage(fauxToolCall("write", { path: "revoked.txt", content: "denied" }), {
            stopReason: "toolUse",
          });
    },
  });
  root = f.root;
  source = { provider: f.model.getModel().provider, id: f.model.getModel().id, effort: "off" };
  const alt = fauxProvider({
    provider: alternate.provider,
    models: [{ id: alternate.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  alt.setResponses([fauxAssistantMessage("must not dispatch")]);
  f.runtime.registerNativeProvider(alt.provider);
  await configure(root, { implementation: { models: [source, alternate], prewalk: alternate } });
  await f.session.prompt('LAUNCH {"profile":"implementation","assignment":"revoked prewalk"}');
  const state = f.events.at(-1)!.child;
  assert.equal(state.status, "failed");
  assert.match(state.error!, /prewalk grant revoked/);
  assert.equal(state.prewalk?.status, "armed");
  assert.equal(state.telemetry.requests, 1);
  assert.equal(alt.getPendingResponseCount(), 1);
});

test("explicit exact assignment suppresses inherited prewalk and remains pinned across renewal without role fallback", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    response: (context) => {
      if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("observed");
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (text.startsWith("LAUNCH "))
        return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
          stopReason: "toolUse",
        });
      if (text.startsWith("COORD "))
        return fauxAssistantMessage(
          fauxToolCall("delegate_coordinate", JSON.parse(text.slice(6))),
          { stopReason: "toolUse" },
        );
      return fauxAssistantMessage("exact worker finished");
    },
  });
  const source = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  // The dormant role target is deliberately unavailable: an exact assignment never selects it.
  await configure(f.root, {
    implementation: { models: [source, alternate], model: alternate, prewalk: alternate },
  });
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({ profile: "implementation", assignment: "exact assignment", model: source }),
  );
  assert.equal(lastResult(f.session).isError, false, JSON.stringify(lastResult(f.session)));
  const first = f.events.at(-1)!.child;
  assert.equal(first.prewalk?.status, "suppressed-exact");
  assert.equal(first.telemetry.requests, 1);
  assert.deepEqual(first.model, { provider: source.provider, id: source.id });
  assert.doesNotMatch(await readFile(first.transcript!, "utf8"), /Prewalk: investigate/);
  await f.session.prompt(
    "COORD " +
      JSON.stringify({
        action: "followup",
        target: { id: first.id, generation: 1 },
        assignment: "exact renewal",
      }),
  );
  const { eventually } = await import("./fixtures.ts");
  await eventually(() =>
    f.events.some((event) => event.child.generation === 2 && event.child.disposed),
  );
  const second = f.events.at(-1)!.child;
  assert.equal(second.status, "settled");
  assert.equal(second.prewalk?.status, "suppressed-exact");
  assert.equal(second.telemetry.requests, 1);
  assert.equal(second.effort, "off");
  assert.deepEqual(second.model, first.model);
  await configure(f.root, {
    implementation: { models: [alternate], model: alternate, prewalk: alternate },
  });
  const before = f.events.length;
  await f.session.prompt(
    "COORD " +
      JSON.stringify({
        action: "followup",
        target: { id: first.id, generation: 2 },
        assignment: "no fallback",
      }),
  );
  const result = f.session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "delegate_coordinate",
  );
  assert.ok(result?.role === "toolResult" && result.isError);
  assert.equal(f.events.length, before);
});

test("identical role prewalk target is an observable no-op with no planning nudge or extra dispatch", async (t) => {
  const f = await fixture(t, { speed: 0 });
  const source = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  await configure(f.root, { general: { models: [source], prewalk: source } });
  await f.launch("same target", "general", false);
  const state = f.events.at(-1)!.child;
  assert.equal(state.prewalk?.status, "no-op");
  assert.equal(state.telemetry.requests, 1);
  assert.doesNotMatch(await readFile(state.transcript!, "utf8"), /Prewalk: investigate/);
});
