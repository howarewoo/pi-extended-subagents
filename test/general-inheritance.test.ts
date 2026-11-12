import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseFactory,
  type JsonObject,
} from "@earendil-works/pi-ai";
import { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";
import { fixture, eventually } from "./fixtures.ts";
import type { ChildSnapshot } from "../src/coordinator.ts";

const response: FauxResponseFactory = (context) => {
  const user = context.messages.findLast((message) => message.role === "user");
  const text =
    typeof user?.content === "string"
      ? user.content
      : (user?.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("") ?? "");
  if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
  if (text.startsWith("COORD "))
    return fauxAssistantMessage(fauxToolCall("delegate_coordinate", JSON.parse(text.slice(6))), {
      stopReason: "toolUse",
    });
  if (text.startsWith("LAUNCH "))
    return fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
      stopReason: "toolUse",
    });
  const calls = JSON.parse(text) as { name: string; args: JsonObject }[];
  return fauxAssistantMessage(
    calls.map((call) => fauxToolCall(call.name, call.args)),
    { stopReason: "toolUse" },
  );
};
async function configure(root: string, general: Record<string, unknown>) {
  await mkdir(join(root, "operator"), { recursive: true });
  await writeFile(join(root, "operator", "delegation.json"), JSON.stringify({ general }));
}
function final(f: Awaited<ReturnType<typeof fixture>>, id: string): ChildSnapshot {
  return f.events.filter((event) => event.child.id === id).at(-1)!.child;
}

test("general inherits actual builtin and reviewed leaf effects, but not parent prompt/history or reaching controls", async (t) => {
  let leafCalls = 0,
    orchestrations = 0;
  let skillPath = "";
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: (pi) => {
      pi.on("before_agent_start", (event) => {
        if (skillPath)
          event.systemPromptOptions.skills = [
            {
              name: "parent-skill",
              description: "available parent skill",
              filePath: skillPath,
              baseDir: skillPath.slice(0, skillPath.lastIndexOf("/")),
              sourceInfo: createSyntheticSourceInfo(skillPath, { source: "sdk" }),
              disableModelInvocation: false,
            },
          ];
        return { systemPrompt: event.systemPrompt + "\nPRIVATE_PARENT_INSTRUCTIONS" };
      });
      pi.registerTool({
        name: "trusted_leaf",
        label: "leaf",
        description: "Reviewed fixture writes one file, never calls Pi tools",
        parameters: Type.Object({}),
        execute: async (_id, _args, _signal, _update, ctx) => {
          leafCalls++;
          await writeFile(join(ctx.cwd, "leaf.txt"), "leaf effect");
          return { content: [{ type: "text", text: "leaf effect" }], details: {} };
        },
      });
      pi.registerTool({
        name: "reaching",
        label: "reaching",
        description: "cannot forward",
        reachesTools: () => "all",
        parameters: Type.Object({}),
        execute: async (_id, _args, _signal, _update, ctx) => {
          orchestrations++;
          const result = await ctx.executeTool("write", { path: "escape.txt", content: "escape" });
          return result.result;
        },
      });
      pi.on("tool_call", (event) =>
        event.toolName === "write" && event.input.path === "blocked.txt"
          ? { block: true, reason: "root permission denial" }
          : undefined,
      );
    },
  });
  skillPath = join(f.root, "SKILL.md");
  await writeFile(
    skillPath,
    "---\nname: parent-skill\ndescription: available parent skill\n---\nSkill instructions only when read.",
  );
  await configure(f.root, { leafTools: ["trusted_leaf", "reaching", "codemode"] });
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "trusted_leaf", "reaching"]);
  // A parent-only history message must not appear in the fresh child transcript.
  f.session.sessionManager.appendMessage({
    role: "user",
    content: "PRIVATE_PARENT_HISTORY",
    timestamp: Date.now(),
  });
  const calls = [
    { name: "write", args: { path: "allowed.txt", content: "builtin effect" } },
    { name: "write", args: { path: "blocked.txt", content: "denied" } },
    { name: "trusted_leaf", args: {} },
    { name: "reaching", args: {} },
  ];
  const ref = await f.launch(JSON.stringify(calls), "general", false);
  const state = final(f, ref.id);
  assert.equal(state.status, "settled");
  assert.deepEqual(state.tools, ["read", "write", "edit", "bash"]);
  assert.deepEqual(state.leafTools, ["trusted_leaf"]);
  assert.deepEqual(state.skills, [skillPath]);
  assert.ok(
    state.capabilityDenials?.some(
      (d) => d.name === "reaching" && /child execution scope/.test(d.reason),
    ),
  );
  assert.ok(state.capabilityDenials?.some((d) => d.name === "delegate_task"));
  assert.equal(await readFile(join(f.root, "allowed.txt"), "utf8"), "builtin effect");
  assert.equal(await readFile(join(f.root, "leaf.txt"), "utf8"), "leaf effect");
  await assert.rejects(access(join(f.root, "blocked.txt")), /ENOENT/);
  await assert.rejects(access(join(f.root, "escape.txt")), /ENOENT/);
  assert.equal(leafCalls, 1);
  assert.equal(orchestrations, 0);
  assert.ok(f.events.some((event) => event.child.id === ref.id && event.child.writerLease));
  const transcript = await readFile(state.transcript!, "utf8");
  assert.match(transcript, /parent-skill/);
  assert.match(transcript, /Complete the assigned analysis/);
  assert.match(transcript, /root permission denial/);
  assert.doesNotMatch(transcript, /PRIVATE_PARENT/);
});

test("leaf tools are denied without review or for a different cwd", async (t) => {
  let effects = 0;
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: (pi) => {
      pi.registerTool({
        name: "leaf",
        label: "leaf",
        description: "reviewable leaf",
        parameters: Type.Object({}),
        execute: async () => {
          effects++;
          return { content: [], details: {} };
        },
      });
    },
  });
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "leaf"]);
  const assignment = JSON.stringify([{ name: "leaf", args: {} }]);
  const first = await f.launch(assignment, "general", false);
  assert.match(
    final(f, first.id).capabilityDenials!.find((d) => d.name === "leaf")!.reason,
    /no operator-reviewed/,
  );
  await configure(f.root, { leafTools: ["leaf"] });
  await mkdir(join(f.root, "other"));
  await f.session.prompt(
    "LAUNCH " + JSON.stringify({ profile: "general", assignment, cwd: "other" }),
  );
  const state = f.events.at(-1)!.child;
  assert.match(
    state.capabilityDenials!.find((d) => d.name === "leaf")!.reason,
    /cwd cannot be rebound/,
  );
  assert.equal(effects, 0);
});

for (const revoke of ["config", "callable", "reaches", "provenance"] as const)
  test(`leaf forwarding rechecks live ${revoke} revocation`, async (t) => {
    let effects = 0;
    let root = "";
    const f = await fixture(t, {
      speed: 0,
      tools: "default",
      response: (context, ...rest) => {
        const results = context.messages.filter((message) => message.role === "toolResult");
        const user = context.messages.findLast((message) => message.role === "user");
        if (JSON.stringify(user).includes("LAUNCH "))
          return results.some((result) => result.toolName === "delegate_task")
            ? fauxAssistantMessage("done")
            : response(context, ...rest);
        return results.length < 2
          ? fauxAssistantMessage(fauxToolCall("leaf", {}), { stopReason: "toolUse" })
          : fauxAssistantMessage("done");
      },
      extra: (pi) => {
        const definition = {
          name: "leaf",
          label: "leaf",
          description: "reviewed leaf",
          parameters: Type.Object({}),
          execute: async () => {
            effects++;
            if (revoke === "config") await configure(root, { leafTools: [] });
            if (revoke === "callable")
              pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "leaf"));
            if (revoke === "reaches") pi.registerTool({ ...definition, reachesTools: () => "all" });
            if (revoke === "provenance")
              pi.registerTool({ ...definition, namespace: { name: "changed" } });
            return { content: [], details: {} };
          },
        };
        pi.registerTool(definition);
      },
    });
    root = f.root;
    await configure(root, { leafTools: ["leaf"] });
    f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "leaf"]);
    const ref = await f.launch("[]", "general", false);
    const state = final(f, ref.id);
    assert.equal(effects, 1);
    assert.match(await readFile(state.transcript!, "utf8"), /revoked|no longer callable/);
  });

test(
  "general leaf writer stays serialized and cancellation drains a held actual SDK hook",
  { timeout: 10000 },
  async (t) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    let effects = 0;
    const f = await fixture(t, {
      speed: 0,
      tools: "default",
      response,
      extra: (pi) => {
        pi.registerTool({
          name: "leaf",
          label: "leaf",
          description: "reviewed leaf",
          parameters: Type.Object({}),
          execute: async () => {
            effects++;
            return { content: [], details: {} };
          },
        });
        pi.on("tool_call", async (event) => {
          if (event.toolName === "leaf") {
            entered = true;
            await gate;
          }
        });
      },
    });
    await configure(f.root, { tools: ["read"], leafTools: ["leaf"] });
    f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "leaf", "capture_context"]);
    try {
      const first = await f.direct(JSON.stringify([{ name: "leaf", args: {} }]), "general");
      await eventually(() => entered);
      assert.equal(final(f, first.id).writerLease, true);
      const second = await f.direct("[]", "general");
      assert.equal(final(f, second.id).status, "queued");
      const stopping = f.coordinator.stop(first);
      await eventually(() => final(f, first.id).status === "draining");
      assert.equal(final(f, first.id).disposed, false);
      assert.equal(final(f, first.id).writerLease, true);
      release();
      await stopping;
      await eventually(() => final(f, second.id).disposed);
      assert.equal(final(f, first.id).status, "cancelled");
      assert.equal(final(f, first.id).writerLease, false);
      assert.equal(effects, 0, "SDK cancellation after permission hook prevents the leaf effect");
    } finally {
      release();
    }
  },
);

test("new leaf grants cannot broaden an admitted ancestor ceiling", async (t) => {
  const f = await fixture(t, {
    speed: 100,
    tools: "default",
    extra: (pi) => {
      pi.registerTool({
        name: "leaf",
        label: "leaf",
        description: "reviewed leaf",
        parameters: Type.Object({}),
        execute: async () => ({ content: [], details: {} }),
      });
    },
  });
  await configure(f.root, { tools: ["read"], spawn: ["general"] });
  let input: Parameters<typeof f.coordinator.start>[0] | undefined;
  const start = f.coordinator.start.bind(f.coordinator);
  t.mock.method(f.coordinator, "start", (value: Parameters<typeof start>[0]) => {
    input = value;
    return start(value);
  });
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "leaf"]);
  const parent = await f.direct("parent ".repeat(1000));
  assert.ok(input);
  await configure(f.root, { tools: ["read"], spawn: ["general"], leafTools: ["leaf"] });
  const { resolveProfile } = await import("../src/profiles.ts");
  const selected = await resolveProfile("general", f.root, false);
  await assert.rejects(
    () =>
      f.coordinator.admit([
        { ...input!, ...selected, parent, assignment: "cannot regain root leaf" },
      ]),
    /broaden ancestor grants/,
  );
  await f.coordinator.stop(parent);
});

test("actual SDK renewal removes revoked leaf/skill grants and cannot regain them later", async (t) => {
  const effects: string[] = [];
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: (pi) => {
      for (const name of ["leaf_a", "leaf_b"])
        pi.registerTool({
          name,
          label: name,
          description: "reviewed leaf",
          parameters: Type.Object({}),
          execute: async () => {
            effects.push(name);
            return { content: [], details: {} };
          },
        });
    },
  });
  const skills = [join(f.root, "skill-a.md"), join(f.root, "skill-b.md")];
  for (const [index, path] of skills.entries())
    await writeFile(
      path,
      `---\nname: skill-${index}\ndescription: renewal skill\n---\nInstructions.`,
    );
  await configure(f.root, { tools: ["read"], leafTools: ["leaf_a"], skills: [skills[0]] });
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "leaf_a", "leaf_b"]);
  const assignment = JSON.stringify([
    { name: "leaf_a", args: {} },
    { name: "leaf_b", args: {} },
  ]);
  const first = await f.launch(assignment, "general", false);
  assert.deepEqual(final(f, first.id).leafTools, ["leaf_a"]);
  assert.deepEqual(final(f, first.id).skills, [skills[0]]);
  assert.deepEqual(effects, ["leaf_a"]);
  for (const [index, grant] of ["leaf_b", "leaf_a"].entries()) {
    await configure(f.root, {
      tools: ["read"],
      leafTools: [grant],
      skills: [skills[index === 0 ? 1 : 0]],
    });
    await f.session.prompt(
      "COORD " +
        JSON.stringify({
          action: "followup",
          target: { id: first.id, generation: index + 1 },
          assignment,
        }),
    );
    const result = f.session.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "delegate_coordinate",
    );
    assert.ok(result?.role === "toolResult" && !result.isError, JSON.stringify(result));
    await eventually(() => {
      const state = final(f, first.id);
      return state.generation === index + 2 && state.disposed;
    });
    const state = final(f, first.id);
    assert.deepEqual(state.leafTools, []);
    assert.deepEqual(state.skills, []);
    assert.equal(state.status, "settled");
  }
  assert.deepEqual(
    effects,
    ["leaf_a"],
    "neither new nor previously revoked grants regain authority",
  );
});

test("review never authorizes owned names, noncallable exposure or even an empty reaching declaration", async (t) => {
  let effects = 0;
  const names = ["codemode", "tool_search", "hidden_leaf", "model_leaf", "empty_reaching"];
  const f = await fixture(t, {
    speed: 0,
    tools: "default",
    response,
    extra: (pi) => {
      for (const name of names)
        pi.registerTool({
          name,
          label: name,
          description: "review cannot authorize this tool",
          parameters: Type.Object({}),
          exposure:
            name === "hidden_leaf" ? "hidden" : name === "model_leaf" ? "model-only" : "direct",
          ...(name === "empty_reaching" ? { reachesTools: () => [] } : {}),
          execute: async () => {
            effects++;
            return { content: [], details: {} };
          },
        });
    },
  });
  await configure(f.root, { leafTools: names });
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), ...names]);
  const ref = await f.launch(
    JSON.stringify(names.map((name) => ({ name, args: {} }))),
    "general",
    false,
  );
  const state = final(f, ref.id);
  assert.deepEqual(state.leafTools, []);
  for (const name of names)
    assert.ok(
      state.capabilityDenials?.some((denial) => denial.name === name),
      name,
    );
  assert.equal(effects, 0);
});

test("leaf grants cannot bypass either supported builtin ceilings or unsupported builtin names", async () => {
  const { leafDenial } = await import("../src/capabilities.ts");
  for (const name of ["write", "powershell"])
    assert.match(
      leafDenial(
        {
          name,
          description: "builtin outside ceiling",
          parameters: Type.Object({}),
          exposure: "direct",
          sourceInfo: createSyntheticSourceInfo(`builtin:${name}`, { source: "sdk" }),
        },
        [name],
        true,
      )!,
      /outside the profile ceiling/,
    );
});
