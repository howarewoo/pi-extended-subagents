import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";
import { workspaceArguments } from "../src/workspace.ts";
import type { ChildSnapshot } from "../src/coordinator.ts";

const userText = (context: Parameters<FauxResponseFactory>[0]) => {
  const last = context.messages.at(-1);
  return last?.role === "user"
    ? typeof last.content === "string"
      ? last.content
      : last.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("")
    : "";
};
const controlled =
  (child: FauxResponseFactory): FauxResponseFactory =>
  (context, ...rest) => {
    const text = userText(context);
    if (text.startsWith("CALL "))
      return fauxAssistantMessage(fauxToolCall("subagent", JSON.parse(text.slice(5))), {
        stopReason: "toolUse",
      });
    const first = context.messages.find((message) => message.role === "user");
    const firstText =
      typeof first?.content === "string"
        ? first.content
        : (first?.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("") ?? "");
    if (firstText.startsWith("CALL ")) return fauxAssistantMessage("acknowledged");
    return child(context, ...rest);
  };
async function call(f: Awaited<ReturnType<typeof fixture>>, args: unknown) {
  await f.session.prompt("CALL " + JSON.stringify(args));
  const result = f.session.messages
    .filter((message) => message.role === "toolResult" && message.toolName === "subagent")
    .at(-1);
  assert.ok(result?.role === "toolResult");
  return result;
}

test("native discovery and worker tools operate in a real supplied Git worktree through root hooks", async (t) => {
  const seen: { name: string; input: Record<string, unknown>; cwd: string }[] = [];
  let prompt = "";
  let guidelines: string[] = [];
  const f = await fixture(t, {
    tools: "default",
    extra: (pi) => {
      pi.on("before_agent_start", (_event, ctx) => {
        prompt = ctx.getSystemPrompt();
        guidelines =
          pi.getAllTools().find((tool) => tool.name === "subagent")?.promptGuidelines ?? [];
      });
      pi.on("tool_call", (event, ctx) => {
        if (["read", "write", "edit", "bash"].includes(event.toolName))
          seen.push({ name: event.toolName, input: structuredClone(event.input), cwd: ctx.cwd });
      });
    },
    response: controlled((context) => {
      const assignment = context.messages.find((message) => message.role === "user");
      if (!JSON.stringify(assignment).includes("WORKER"))
        return fauxAssistantMessage("acknowledged");
      const step = context.messages.filter((message) => message.role === "toolResult").length;
      const calls = [
        ["read", { path: "input.txt" }],
        ["edit", { path: "input.txt", edits: [{ oldText: "worker-input", newText: "changed" }] }],
        ["write", { path: "output.txt", content: "worker output" }],
        [
          "bash",
          { command: "printf '%s' \"$PWD\" > shell-cwd.txt; git rev-parse --show-toplevel" },
        ],
      ] as const;
      return step < calls.length
        ? fauxAssistantMessage(fauxToolCall(calls[step][0], calls[step][1]), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("worker finished");
    }),
  });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", input: "" }).trim();
  git("init", "--quiet");
  const tree = git("mktree");
  const commit = git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit-tree",
    tree,
    "-m",
    "fixture",
  );
  const cwd = join(f.root, "worker's lane");
  git("worktree", "add", "--quiet", "--detach", cwd, commit);
  await writeFile(join(f.root, "input.txt"), "parent-input");
  await writeFile(join(cwd, "input.txt"), "worker-input");
  const result = await call(f, {
    agent: "worker",
    task: "WORKER: implement the approved task using supplied repository guidelines and task references",
    cwd,
    async: false,
  });
  assert.equal(result.isError, false, JSON.stringify(result));
  const state = result.details as ChildSnapshot & { taskId: string };
  assert.match(state.id, /^[0-9a-f-]{36}@1$/);
  assert.equal(state.cwd, await realpath(cwd));
  assert.equal(state.status, "settled");
  assert.ok(f.session.getActiveToolNames().includes("subagent"));
  assert.ok(guidelines.length > 0);
  assert.ok(
    guidelines.every((rule) => prompt.includes(rule)),
    "Pi projects the registered worker guidance into its native system prompt",
  );
  assert.equal(
    await readFile(join(cwd, "input.txt"), "utf8"),
    "changed",
    JSON.stringify({ seen, transcript: await readFile(state.transcript!, "utf8") }),
  );
  assert.equal(await readFile(join(f.root, "input.txt"), "utf8"), "parent-input");
  assert.equal(await readFile(join(cwd, "output.txt"), "utf8"), "worker output");
  assert.equal(await readFile(join(cwd, "shell-cwd.txt"), "utf8"), await realpath(cwd));
  await assert.rejects(access(join(f.root, "output.txt")), /ENOENT/);
  assert.deepEqual(
    seen.map((event) => event.name),
    ["read", "edit", "write", "bash"],
  );
  for (const event of seen) {
    assert.equal(event.cwd, f.root, "permission context remains the real root context");
    if (event.name === "bash") assert.match(String(event.input.command), /^cd -- .*\|\| exit \$\?/);
    else
      assert.equal(
        String(event.input.path),
        join(await realpath(cwd), event.name === "write" ? "output.txt" : "input.txt"),
      );
  }
  const disk = await readFile(state.transcript!, "utf8");
  assert.match(disk, /worker-input/);
  assert.match(disk, /worker's lane/);
});

test("root refusal of an adapted write remains effective and failed cd never falls back to root", async (t) => {
  const f = await fixture(t, {
    tools: "default",
    extra: (pi) => {
      pi.on("tool_call", (event) => {
        if (event.toolName === "write")
          return { block: true, reason: "operator denied adapted write" };
      });
    },
    response: controlled((context) =>
      context.messages.at(-1)?.role === "toolResult"
        ? fauxAssistantMessage("done")
        : fauxAssistantMessage(fauxToolCall("write", { path: "denied.txt", content: "no" }), {
            stopReason: "toolUse",
          }),
    ),
  });
  const cwd = join(f.root, "workspace");
  await mkdir(cwd);
  const result = await call(f, { agent: "worker", task: "write", cwd, async: false });
  const state = result.details as ChildSnapshot;
  await assert.rejects(access(join(cwd, "denied.txt")), /ENOENT/);
  await assert.rejects(access(join(f.root, "denied.txt")), /ENOENT/);
  assert.match(await readFile(state.transcript!, "utf8"), /operator denied adapted write/);
  const args = workspaceArguments(
    "bash",
    { command: "touch unsafe.txt; true || touch also-unsafe.txt" },
    join(cwd, "missing"),
    f.root,
  ) as { command: string };
  assert.throws(() => execFileSync("bash", ["-c", args.command], { cwd: f.root, stdio: "pipe" }));
  await assert.rejects(access(join(f.root, "unsafe.txt")), /ENOENT/);
});

test("async completion wakes the idle parent exactly once; resume preserves workspace and stale controls refuse", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let wakes = 0;
  const f = await fixture(t, {
    tools: "default",
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "read") await gate;
      });
      pi.on("before_agent_start", (event) => {
        if (event.messageType === "custom" && event.message.customType === "delegation") wakes++;
      });
    },
    response: controlled((context) =>
      userText(context).startsWith("READ")
        ? fauxAssistantMessage(fauxToolCall("read", { path: "input.txt" }), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("done"),
    ),
  });
  const cwd = join(f.root, "lane");
  await mkdir(cwd);
  await writeFile(join(cwd, "input.txt"), "lane");
  try {
    const first = await call(f, { agent: "scout", task: "READ", cwd });
    assert.equal(first.isError, false, JSON.stringify(first));
    const state = first.details as ChildSnapshot & { taskId: string };
    assert.equal(wakes, 0);
    release();
    await eventually(() => wakes === 1 && !f.session.isStreaming);
    assert.equal(
      f.session.messages.filter(
        (message) => message.role === "custom" && message.customType === "delegation",
      ).length,
      1,
    );
    const moved = await call(f, {
      action: "resume",
      id: state.id,
      message: "must not move",
      cwd: f.root,
    });
    assert.equal(moved.isError, true);
    const resumed = await call(f, {
      action: "resume",
      id: state.id,
      message: "READ the same workspace again",
    });
    assert.equal(resumed.isError, false, JSON.stringify(resumed));
    const next = resumed.details as ChildSnapshot;
    assert.equal(next.id, `${state.taskId}@2`);
    assert.equal(next.cwd, await realpath(cwd));
    await eventually(
      () =>
        f.events.some(
          (event) =>
            event.child.id === state.taskId && event.child.generation === 2 && event.child.disposed,
        ) && !f.session.isStreaming,
    );
    const stale = await call(f, { action: "stop", id: state.id });
    assert.equal(stale.isError, true);
    assert.match(JSON.stringify(stale), /stale/);
    const status = await call(f, { action: "status", id: next.id });
    assert.equal(status.isError, false);
    assert.equal((status.details as { snapshot: ChildSnapshot }).snapshot.status, "settled");
  } finally {
    release();
  }
});

test("workspace preflight is atomic, search defaults are rebound, and shorthands fail rather than retarget", async (t) => {
  const f = await fixture(t, {
    tools: "default",
    response: controlled(() => fauxAssistantMessage("done")),
  });
  const invalid = await call(f, {
    tasks: [
      { agent: "scout", task: "valid" },
      { agent: "worker", task: "invalid", cwd: join(f.root, "missing") },
    ],
    async: false,
  });
  assert.equal(invalid.isError, true);
  assert.equal(f.events.length, 0);
  const cwd = join(f.root, "lane");
  await mkdir(cwd);
  for (const name of ["grep", "find", "ls"] as const)
    assert.deepEqual(workspaceArguments(name, { pattern: "x" }, cwd, f.root), {
      pattern: "x",
      path: cwd,
    });
  for (const path of ["~/secret", "@input.txt", "narrow\u202fspace"])
    assert.throws(() => workspaceArguments("read", { path }, cwd, f.root), /ordinary/);
  const unknown = await call(f, { agent: "invented-agent", task: "must not become a writer" });
  assert.equal(unknown.isError, true);
  assert.equal(f.events.length, 0);
});

test("denying the compatibility tool prevents child admission", async (t) => {
  const f = await fixture(t, {
    tools: "default",
    extra: (pi) => {
      pi.on("tool_call", (event) => {
        if (event.toolName === "subagent")
          return { block: true, reason: "operator denies delegation" };
      });
    },
    response: controlled(() => fauxAssistantMessage("must not launch")),
  });
  const denied = await call(f, { agent: "worker", task: "denied" });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /operator denies delegation/);
  assert.equal(f.events.length, 0);
});

test("compatibility writers queue across workspaces and cannot admit a conflicting parent write", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  const child = controlled((context) =>
    userText(context).startsWith("WRITE")
      ? fauxAssistantMessage(fauxToolCall("write", { path: "output.txt", content: "written" }), {
          stopReason: "toolUse",
        })
      : fauxAssistantMessage("done"),
  );
  const f = await fixture(t, {
    tools: "default",
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "write" && !entered) {
          entered = true;
          await gate;
        }
      });
    },
    response: (context, ...rest) =>
      userText(context) === "ROOT_WRITE"
        ? fauxAssistantMessage(
            fauxToolCall("write", { path: "parent.txt", content: "must reject" }),
            { stopReason: "toolUse" },
          )
        : child(context, ...rest),
  });
  const a = join(f.root, "a"),
    b = join(f.root, "b");
  await mkdir(a);
  await mkdir(b);
  try {
    const first = await call(f, { agent: "worker", task: "WRITE first", cwd: a });
    assert.equal(first.isError, false);
    await eventually(() => entered);
    const second = await call(f, { agent: "worker", task: "WRITE second", cwd: b });
    assert.equal(second.isError, false, JSON.stringify(second));
    assert.equal((second.details as ChildSnapshot).status, "queued");
    await f.session.prompt("ROOT_WRITE");
    const denied = f.session.messages
      .filter((message) => message.role === "toolResult" && message.toolName === "write")
      .at(-1);
    assert.ok(denied?.role === "toolResult" && denied.isError);
    assert.match(JSON.stringify(denied), /writer is held/);
    release();
    const task = second.details as ChildSnapshot & { taskId: string };
    await eventually(
      () =>
        f.events.some((event) => event.child.id === task.taskId && event.child.disposed) &&
        !f.session.isStreaming,
    );
    assert.equal(await readFile(join(a, "output.txt"), "utf8"), "written");
    assert.equal(await readFile(join(b, "output.txt"), "utf8"), "written");
    await assert.rejects(access(join(f.root, "parent.txt")), /ENOENT/);
  } finally {
    release();
  }
});

test("explicitly granted nested delegation inherits the immediate parent's workspace and root read hooks", async (t) => {
  const f = await fixture(t, {
    tools: "default",
    response: controlled((context) => {
      const text = userText(context);
      if (text === "CHILD")
        return fauxAssistantMessage(
          fauxToolCall("delegate_task", { assignment: "GRAND", profile: "general" }),
          { stopReason: "toolUse" },
        );
      if (text === "GRAND")
        return fauxAssistantMessage(fauxToolCall("read", { path: "input.txt" }), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage("done");
    }),
  });
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(
    join(f.root, "operator", "delegation.json"),
    JSON.stringify({ general: { tools: ["read", "grep", "find", "ls"], spawn: ["general"] } }),
  );
  const cwd = join(f.root, "nested-lane");
  await mkdir(cwd);
  await writeFile(join(cwd, "input.txt"), "nested lane payload");
  await writeFile(join(f.root, "input.txt"), "wrong root payload");
  const result = await call(f, { agent: "general", task: "CHILD", cwd, async: false });
  assert.equal(result.isError, false, JSON.stringify(result));
  const grandchild = f.events.findLast((event) => event.child.depth === 2)!.child;
  assert.equal(grandchild.status, "settled");
  assert.equal(grandchild.cwd, await realpath(cwd));
  assert.deepEqual(grandchild.tools, ["read"]);
  assert.equal(grandchild.writerLease, false);
  const transcript = await readFile(grandchild.transcript!, "utf8");
  assert.match(transcript, /nested lane payload/);
  assert.doesNotMatch(transcript, /wrong root payload/);
});

test("compatibility model selection is exact and task files resolve in the selected workspace without importing its policy", async (t) => {
  const compatibleResponse = controlled(() => fauxAssistantMessage("done"));
  const f = await fixture(t, {
    tools: "default",
    response: (context, ...rest) =>
      userText(context).startsWith("NATIVE ")
        ? fauxAssistantMessage(
            fauxToolCall("delegate_task", JSON.parse(userText(context).slice(7))),
            { stopReason: "toolUse" },
          )
        : compatibleResponse(context, ...rest),
  });
  const model = f.model.getModel();
  await mkdir(join(f.root, "operator"), { recursive: true });
  await writeFile(
    join(f.root, "operator", "delegation.json"),
    JSON.stringify({
      scout: { models: [{ provider: model.provider, id: model.id, effort: "off" }] },
    }),
  );
  const result = await call(f, {
    agent: "scout",
    task: "exact",
    model: `${model.provider}/${model.id}:off`,
    async: false,
  });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual((result.details as ChildSnapshot).model, {
    provider: model.provider,
    id: model.id,
  });
  const invalid = await call(f, { agent: "worker", task: "no inferred provider", model: model.id });
  assert.equal(invalid.isError, true);
  assert.match(JSON.stringify(invalid), /exact provider/);
  const cwd = join(f.root, "policy-lane");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(
    join(cwd, ".pi", "delegation.json"),
    JSON.stringify({ scout: { tools: ["bash"] } }),
  );
  await writeFile(join(cwd, "task.txt"), "explicit task from selected workspace");
  await f.session.prompt(
    "NATIVE " + JSON.stringify({ profile: "scout", taskFile: "task.txt", cwd, background: false }),
  );
  const native = f.session.messages
    .filter((message) => message.role === "toolResult" && message.toolName === "delegate_task")
    .at(-1);
  assert.ok(native?.role === "toolResult" && !native.isError, JSON.stringify(native));
  assert.equal(
    (native.details as ChildSnapshot).assignment,
    "explicit task from selected workspace",
  );
  assert.deepEqual((native.details as ChildSnapshot).tools, ["read"]);
});
