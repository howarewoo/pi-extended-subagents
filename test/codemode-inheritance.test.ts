import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, access, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { createCodemodeExtension, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
  type JsonObject,
} from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";

const response: FauxResponseFactory = (context) => {
  if (context.messages.findLast((message) => message.role !== "system")?.role === "toolResult")
    return fauxAssistantMessage("done");
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
  if (text.startsWith("NEST "))
    return fauxAssistantMessage(
      fauxToolCall("delegate_task", { profile: "review", assignment: text.slice(5) }),
      { stopReason: "toolUse" },
    );
  return fauxAssistantMessage(fauxToolCall("codemode", { code: text }), { stopReason: "toolUse" });
};
function final(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  return f.events.filter((event) => event.child.id === id).at(-1)!.child;
}
function activate(f: Awaited<ReturnType<typeof fixture>>) {
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "codemode"]);
}

for (const profile of ["general", "scout", "review", "implementation"])
  test(`${profile} inherits a real local sandbox with scoped discovery and no models`, async (t) => {
    let parentCodemodeCalls = 0;
    const f = await fixture(t, {
      speed: 0,
      tools: "default",
      response,
      extra: (pi) => {
        createCodemodeExtension()(pi);
        pi.registerTool({
          name: "root_secret",
          label: "secret",
          description: "ROOT_PRIVATE_DESCRIPTION",
          parameters: Type.Object({}),
          execute: async () => {
            throw new Error("must not run");
          },
        });
        pi.on("tool_call", (event) => {
          if (event.toolName === "codemode") parentCodemodeCalls++;
        });
      },
    });
    activate(f);
    await writeFile(join(f.root, "evidence.txt"), "sandbox evidence");
    const code = `text({models: typeof models, node: typeof process, fetch: typeof fetch, names: ALL_TOOLS.map(t => t.name), search: await searchTools("ROOT_PRIVATE_DESCRIPTION"), forbidden: await describeTool("root_secret"), namespace: await describeNamespace("root_secret")}); text(await tools.read({path:"evidence.txt"})); try { await tools.write({path:"attempt.txt",content:"effect"}); text("wrote"); } catch(e) { text("denied:" + e.message); }`;
    const ref = await f.launch(code, profile, false);
    const state = final(f, ref.id);
    assert.equal(state.status, "settled");
    const transcript = await readFile(state.transcript!, "utf8");
    const result = JSON.parse(
      transcript.split("\n").find((line) => line.includes('"toolName":"codemode"'))!,
    );
    const output = JSON.stringify(result.message.content);
    assert.match(output, /Script completed/);
    assert.match(output, /sandbox evidence/);
    assert.match(output, /\\"models\\":\\"undefined\\"/);
    assert.match(output, /\\"node\\":\\"undefined\\"/);
    assert.match(output, /\\"fetch\\":\\"undefined\\"/);
    assert.doesNotMatch(
      output,
      /ROOT_PRIVATE_DESCRIPTION|root_secret|delegate_task|submit_result|delegate_coordinate/,
    );
    assert.equal(parentCodemodeCalls, 0, "parent codemode is never dispatched");
    if (["scout", "review"].includes(profile)) {
      await assert.rejects(access(join(f.root, "attempt.txt")), /ENOENT/);
      assert.match(output, /denied/);
      assert.equal(state.writerLease, false);
    } else assert.equal(await readFile(join(f.root, "attempt.txt"), "utf8"), "effect");
    assert.equal(state.toolCalls, ["scout", "review"].includes(profile) ? 2 : 3);
  });

for (const availability of ["unavailable", "disabled"])
  test(`parent ${availability} does not enable child codemode`, async (t) => {
    const f = await fixture(t, {
      speed: 0,
      tools: "default",
      response,
      ...(availability === "disabled" ? { extra: createCodemodeExtension() } : {}),
    });
    const ref = await f.launch("return 1", "review", false);
    const state = final(f, ref.id);
    assert.match(await readFile(state.transcript!, "utf8"), /not found|Unknown tool|unknown tool/);
    assert.equal(state.toolCalls, 0);
  });

test("nested children inherit local codemode and retain the read-only ancestor ceiling", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: createCodemodeExtension(),
  });
  activate(f);
  await writeFile(join(f.root, "nested.txt"), "nested sandbox effect");
  const ref = await f.launch(
    'NEST text(await tools.read({path:"nested.txt"})); text(ALL_TOOLS.map(t=>t.name)); text(typeof models);',
    "scout",
    false,
  );
  const nested = f.events.map((event) => event.child).find((child) => child.parentId === ref.id)!;
  assert.ok(nested);
  const state = final(f, nested.id);
  assert.equal(state.status, "settled");
  assert.match(await readFile(state.transcript!, "utf8"), /nested sandbox effect/);
  assert.deepEqual(state.tools, ["read"]);
  assert.equal(state.toolCalls, 2);
});

test("codemode builtin calls map workspace paths through root permission hooks", async (t) => {
  const paths: string[] = [];
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: (pi) => {
      createCodemodeExtension()(pi);
      pi.on("tool_call", (event) => {
        if (event.toolName === "write") {
          paths.push(String(event.input.path));
          if (String(event.input.path).endsWith("blocked.txt"))
            return { block: true, reason: "root permission denial" };
        }
      });
    },
  });
  activate(f);
  await mkdir(join(f.root, "workspace"));
  await f.session.prompt(
    "LAUNCH " +
      JSON.stringify({
        profile: "implementation",
        cwd: "workspace",
        assignment:
          'await tools.write({path:"allowed.txt",content:"mapped"}); await tools.write({path:"blocked.txt",content:"denied"});',
      }),
  );
  const state = f.events.at(-1)!.child;
  assert.equal(await readFile(join(f.root, "workspace", "allowed.txt"), "utf8"), "mapped");
  await assert.rejects(access(join(f.root, "workspace", "blocked.txt")), /ENOENT/);
  assert.deepEqual(paths, [
    join(await realpath(f.root), "workspace", "allowed.txt"),
    join(await realpath(f.root), "workspace", "blocked.txt"),
  ]);
  assert.match(await readFile(state.transcript!, "utf8"), /root permission denial/);
});

test("sandbox tool calls consume the shared tool budget, not just the outer script", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: createCodemodeExtension(),
  });
  activate(f);
  const ref = await f.direct(
    'await tools.write({path:"over-budget.txt",content:"no"});',
    "implementation",
    { limits: { tools: 1 } },
  );
  await eventually(() => final(f, ref.id).disposed);
  const state = final(f, ref.id);
  assert.equal(state.limitReason, "tools");
  await assert.rejects(access(join(f.root, "over-budget.txt")), /ENOENT/);
});

test(
  "cancellation of a real sandbox drains root hooks before releasing the writer lease",
  { timeout: 10000 },
  async (t) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const f = await fixture(t, {
      speed: 0,
      tools: "default",
      response,
      extra: (pi) => {
        createCodemodeExtension()(pi);
        pi.on("tool_call", async (event) => {
          if (event.toolName === "write") {
            entered = true;
            await gate;
          }
        });
      },
    });
    activate(f);
    try {
      const ref = await f.direct(
        'await tools.write({path:"cancelled.txt",content:"no"});',
        "implementation",
      );
      await eventually(() => entered);
      const stopping = f.coordinator.stop(ref);
      await eventually(() => final(f, ref.id).status === "draining");
      assert.equal(final(f, ref.id).writerLease, true);
      assert.equal(final(f, ref.id).disposed, false);
      release();
      await stopping;
      assert.equal(final(f, ref.id).status, "cancelled");
      assert.equal(final(f, ref.id).writerLease, false);
      await assert.rejects(access(join(f.root, "cancelled.txt")), /ENOENT/);
    } finally {
      release();
    }
  },
);

for (const revoke of ["builtin", "profile", "codemode"])
  test(`real sandbox rechecks live ${revoke} revocation`, async (t) => {
    let root = "";
    let pi!: ExtensionAPI;
    const f = await fixture(t, {
      speed: 0,
      tools: "default",
      response: (context, ...rest) => {
        const user = context.messages.findLast((message) => message.role === "user");
        if (JSON.stringify(user).includes("LAUNCH ")) return response(context, ...rest);
        const results = context.messages.filter((message) => message.role === "toolResult");
        if (results.length === 1 && revoke === "codemode")
          return fauxAssistantMessage(
            fauxToolCall("codemode", { code: 'text("should not run");' }),
            { stopReason: "toolUse" },
          );
        return response(context, ...rest);
      },
      extra: (api) => {
        pi = api;
        createCodemodeExtension()(pi);
        pi.on("tool_result", async (event) => {
          if (event.toolName !== "read" || !String(event.input.path).endsWith("input.txt")) return;
          if (revoke === "profile")
            await writeFile(
              join(root, "operator", "delegation.json"),
              JSON.stringify({ review: { tools: ["ls"] } }),
            );
          else
            pi.setActiveTools(
              pi
                .getActiveTools()
                .filter((name) => name !== (revoke === "builtin" ? "read" : "codemode")),
            );
        });
      },
    });
    root = f.root;
    await mkdir(join(root, "operator"), { recursive: true });
    await writeFile(join(root, "input.txt"), "one read");
    activate(f);
    const ref = await f.launch(
      'text(await tools.read({path:"input.txt"})); text(await tools.read({path:"input.txt"}));',
      "review",
      false,
    );
    const transcript = await readFile(final(f, ref.id).transcript!, "utf8");
    assert.match(
      transcript,
      revoke === "codemode" ? /Parent codemode is no longer enabled/ : /revoked|no longer callable/,
    );
  });

test("nested root-context capture cannot enable codemode absent from its admitted parent", async (t) => {
  let pi!: ExtensionAPI;
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response: (context, ...rest) => {
      const user = context.messages.findLast((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : user?.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("");
      if (text === "parent without codemode") {
        const results = context.messages.filter((message) => message.role === "toolResult");
        if (!results.length)
          return fauxAssistantMessage(fauxToolCall("read", { path: "enable.txt" }), {
            stopReason: "toolUse",
          });
        if (results.length === 1)
          return fauxAssistantMessage(
            fauxToolCall("delegate_task", { profile: "review", assignment: "return 1;" }),
            { stopReason: "toolUse" },
          );
        return fauxAssistantMessage("done");
      }
      return response(context, ...rest);
    },
    extra: (api) => {
      pi = api;
      createCodemodeExtension()(pi);
      pi.on("tool_result", (event) => {
        if (event.toolName === "read" && String(event.input.path).endsWith("enable.txt"))
          pi.setActiveTools([...pi.getActiveTools(), "codemode"]);
      });
    },
  });
  await writeFile(join(f.root, "enable.txt"), "enable at root only");
  const ref = await f.launch("parent without codemode", "scout", false);
  const nested = f.events.map((event) => event.child).find((child) => child.parentId === ref.id)!;
  assert.ok(nested);
  assert.ok(f.session.getActiveToolNames().includes("codemode"));
  const state = final(f, nested.id);
  assert.match(await readFile(state.transcript!, "utf8"), /Tool codemode not found/);
  assert.equal(state.toolCalls, 0);
});

test("a sandbox write preserves the one-time role prewalk handoff", async (t) => {
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: createCodemodeExtension(),
  });
  activate(f);
  const target = { provider: "codemode-target", id: "implementation", effort: "high" as const };
  const alt = fauxProvider({
    provider: target.provider,
    models: [{ id: target.id, reasoning: true }],
    tokensPerSecond: 0,
  });
  alt.setResponses([fauxAssistantMessage("target after sandbox write")]);
  f.runtime.registerNativeProvider(alt.provider);
  const source = {
    provider: f.model.getModel().provider,
    id: f.model.getModel().id,
    effort: "off",
  };
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(
    join(f.root, "operator", "delegation.json"),
    JSON.stringify({ implementation: { models: [source, target], prewalk: target } }),
  );
  const ref = await f.launch(
    'await tools.write({path:"prewalk.txt",content:"sandbox edit"});',
    "implementation",
    false,
  );
  const state = final(f, ref.id);
  assert.equal(state.prewalk?.status, "handed-off");
  assert.equal(state.result, "target after sandbox write");
  assert.equal(state.toolCalls, 2);
  assert.equal(state.telemetry.requests, 2);
  assert.equal(await readFile(join(f.root, "prewalk.txt"), "utf8"), "sandbox edit");
});

for (const mode of ["sandbox", "direct"])
  for (const failure of ["blocked write", "failed edit"])
    test(`${mode} ${failure} does not trigger role prewalk handoff`, async (t) => {
      const toolName = failure === "blocked write" ? "write" : "edit";
      const args: JsonObject =
        toolName === "write"
          ? { path: "unchanged.txt", content: "must not write" }
          : {
              path: "unchanged.txt",
              edits: [{ oldText: "missing text", newText: "must not edit" }],
            };
      const assignment =
        mode === "sandbox"
          ? `text(await tools.${toolName}(${JSON.stringify(args)}));`
          : "direct failed mutation";
      const f = await fixture(t, {
        speed: 0,
        tools: "default",
        response: (context, ...rest) => {
          const user = context.messages.findLast((message) => message.role === "user");
          if (
            JSON.stringify(user).includes("direct failed mutation") &&
            !JSON.stringify(user).includes("LAUNCH ")
          ) {
            if (context.messages.some((message) => message.role === "toolResult"))
              return fauxAssistantMessage("source after failed mutation");
            return fauxAssistantMessage(fauxToolCall(toolName, args), { stopReason: "toolUse" });
          }
          return response(context, ...rest);
        },
        extra: (pi) => {
          createCodemodeExtension()(pi);
          pi.on("tool_call", (event) => {
            if (event.toolName === "write")
              return { block: true, reason: "root permission denial" };
          });
        },
      });
      activate(f);
      await writeFile(join(f.root, "unchanged.txt"), "original content");
      const target = { provider: "failed-mutation-target", id: "implementation", effort: "high" };
      const alt = fauxProvider({
        provider: target.provider,
        models: [{ id: target.id, reasoning: true }],
        tokensPerSecond: 0,
      });
      alt.setResponses([fauxAssistantMessage("unexpected handoff")]);
      f.runtime.registerNativeProvider(alt.provider);
      const source = {
        provider: f.model.getModel().provider,
        id: f.model.getModel().id,
        effort: "off",
      };
      await mkdir(join(f.root, "operator"), { recursive: true });
      await writeFile(
        join(f.root, "operator", "delegation.json"),
        JSON.stringify({ implementation: { models: [source, target], prewalk: target } }),
      );
      const ref = await f.launch(assignment, "implementation", false);
      const state = final(f, ref.id);
      assert.equal(state.status, "settled");
      assert.equal(state.prewalk?.status, "armed");
      assert.deepEqual(state.model, { provider: source.provider, id: source.id });
      assert.equal(state.telemetry.requests, 2);
      assert.equal(state.toolCalls, mode === "sandbox" ? 2 : 1);
      assert.notEqual(state.result, "unexpected handoff");
      assert.match(
        await readFile(state.transcript!, "utf8"),
        failure === "blocked write" ? /root permission denial/ : /Could not find/,
      );
      assert.equal(await readFile(join(f.root, "unchanged.txt"), "utf8"), "original content");
    });
