import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";
import { DEFAULT_POLICY } from "../src/scheduling.ts";

test("production delegated writes retain parent permission hooks", async (t) => {
  const { launch, root, events } = await fixture(t, {
    extra: (pi) => {
      pi.on("tool_call", (event) => {
        if (event.toolName === "write") return { block: true, reason: "operator denied write" };
      });
    },
    response: (context) => {
      const user = context.messages.find((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (text.startsWith("LAUNCH "))
        return context.messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage("parent done")
          : fauxAssistantMessage(fauxToolCall("delegate_task", JSON.parse(text.slice(7))), {
              stopReason: "toolUse",
            });
      return context.messages.at(-1)?.role === "toolResult"
        ? fauxAssistantMessage("write was denied")
        : fauxAssistantMessage(fauxToolCall("write", { path: "denied.txt", content: "no" }), {
            stopReason: "toolUse",
          });
    },
  });
  const ref = await launch("write attempt", "implementation", false);
  await assert.rejects(readFile(join(root, "denied.txt")), /ENOENT/);
  assert.ok(
    events.some(
      (event) =>
        event.child.id === ref.id &&
        event.event?.type === "tool_execution_end" &&
        event.event.isError,
    ),
  );
});

test("manual shell events remain uncoordinated and do not disable production writers, including after reload", async (t) => {
  let laterHook = 0;
  const { session, launch, root, events } = await fixture(t, {
    extra: (pi) => {
      pi.on("user_bash", () => {
        laterHook++;
      });
    },
  });
  await session.prompt("/subagent-profiles");
  assert.match(JSON.stringify(session.messages.at(-1)), /caller coordinates collisions/);
  await session.extensionRunner.emitUserBash({
    type: "user_bash",
    command: "not executed by event-only test",
    cwd: root,
    excludeFromContext: false,
  });
  assert.equal(laterHook, 1, "no replacement/handling of manual shell operations");
  const ref = await launch("writer remains available", "implementation", false);
  assert.equal(events.filter((event) => event.child.id === ref.id).at(-1)!.child.status, "settled");
  await session.reload();
  const replacement = await launch("writer after reload", "implementation", false);
  assert.equal(
    events.filter((event) => event.child.id === replacement.id).at(-1)!.child.status,
    "settled",
  );
});

const userText = (context: Parameters<import("@earendil-works/pi-ai").FauxResponseFactory>[0]) => {
  const user = context.messages.filter((message) => message.role === "user").at(-1);
  return typeof user?.content === "string"
    ? user.content
    : (user?.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("") ?? "");
};

for (const mode of ["batch", "separate", "workspaces"] as const)
  test(
    `three SDK writers overlap through real hooks (${mode}); parent mutations coexist`,
    { timeout: 10000 },
    async (t) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let releaseOthers!: () => void;
      const others = new Promise<void>((resolve) => {
        releaseOthers = resolve;
      });
      const entered = new Set<string>();
      const f = await fixture(t, {
        speed: 0,
        extra: (pi) => {
          pi.on("tool_call", async (event) => {
            if (event.toolName === "write") {
              const path = String(event.input.path).split("/").at(-1)!;
              if (["A.txt", "B.txt", "C.txt"].includes(path)) {
                entered.add(path);
                await (path === "A.txt" ? gate : others);
              }
            }
            if (event.toolName === "write" && event.input.path === "denied-parent.txt")
              return { block: true, reason: "operator denied parent write" };
          });
        },
        response: (context) => {
          const text = userText(context);
          const first = context.messages.find((message) => message.role === "user");
          if (
            context.messages.at(-1)?.role === "toolResult" ||
            (JSON.stringify(first).includes("LAUNCH ") && !text.startsWith("LAUNCH "))
          )
            return fauxAssistantMessage("done");
          return fauxAssistantMessage(
            fauxToolCall(
              text.startsWith("LAUNCH ") ? "delegate_task" : "write",
              text.startsWith("LAUNCH ")
                ? JSON.parse(text.slice(7))
                : { path: text + ".txt", content: text },
            ),
            { stopReason: "toolUse" },
          );
        },
      });
      await mkdir(join(f.root, "operator"), { recursive: true });
      await writeFile(
        join(f.root, "operator", "delegation.json"),
        JSON.stringify({ scheduling: { concurrency: 3 } }),
      );
      const workspace = (name: string) => (mode === "workspaces" ? join(f.root, name) : f.root);
      if (mode === "workspaces") for (const name of ["A", "B", "C"]) await mkdir(workspace(name));
      try {
        if (mode !== "separate")
          await f.session.prompt(
            "LAUNCH " +
              JSON.stringify({
                tasks: ["A", "B", "C"].map((assignment) => ({
                  assignment,
                  profile: "implementation",
                  ...(mode === "workspaces" ? { cwd: workspace(assignment) } : {}),
                })),
                background: true,
              }),
          );
        else {
          await f.launch("A", "implementation");
          await eventually(() => entered.has("A.txt"));
          await f.launch("B", "implementation");
          await f.launch("C", "implementation");
        }
        await eventually(() => entered.size === 3);
        releaseOthers();
        await eventually(() =>
          ["B", "C"].every((name) =>
            f.events.some((event) => event.child.assignment === name && event.child.disposed),
          ),
        );
        const latest = (name: string) =>
          f.events.filter((event) => event.child.assignment === name).at(-1)!.child;
        assert.equal(latest("A").disposed, false);
        for (const name of ["B", "C"])
          assert.equal(await readFile(join(workspace(name), name + ".txt"), "utf8"), name);
        // Actual model-issued parent tools, not direct filesystem substitutes.
        f.model.setResponses([
          fauxAssistantMessage(fauxToolCall("write", { path: "parent.txt", content: "before" }), {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage(
            fauxToolCall("edit", { path: "parent.txt", oldText: "before", newText: "after" }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage(
            fauxToolCall("bash", { command: "printf shell > parent-shell.txt" }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage(fauxToolCall("capture_context", {}), { stopReason: "toolUse" }),
          fauxAssistantMessage("parent done"),
        ]);
        await f.session.prompt("parent effects while A is held");
        assert.equal(await readFile(join(f.root, "parent.txt"), "utf8"), "after");
        assert.equal(await readFile(join(f.root, "parent-shell.txt"), "utf8"), "shell");
        const results = f.session.messages.filter(
          (message) =>
            message.role === "toolResult" &&
            ["write", "edit", "bash", "capture_context"].includes(message.toolName),
        );
        assert.equal(results.length, 4);
        assert.ok(results.every((message) => message.role === "toolResult" && !message.isError));
        f.model.setResponses([
          fauxAssistantMessage(
            fauxToolCall("write", { path: "denied-parent.txt", content: "no" }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("denial acknowledged"),
          fauxAssistantMessage("done"),
        ]);
        await f.session.prompt("parent permission denial still applies");
        const denied = f.session.messages
          .filter((message) => message.role === "toolResult" && message.toolName === "write")
          .at(-1);
        assert.ok(denied?.role === "toolResult" && denied.isError);
        assert.match(JSON.stringify(denied), /operator denied parent write/);
        await assert.rejects(readFile(join(f.root, "denied-parent.txt")), /ENOENT/);
        assert.ok(f.events.every((event) => !event.child.writerLease));
        release();
        await eventually(() => latest("A").disposed);
        assert.equal(await readFile(join(workspace("A"), "A.txt"), "utf8"), "A");
        assert.equal(new Set(["A", "B", "C"].map((name) => latest(name).transcript)).size, 3);
        assert.equal(new Set(["A", "B", "C"].map((name) => latest(name).artifacts!.text)).size, 3);
        for (const name of ["A", "B", "C"]) {
          assert.equal(latest(name).status, "settled");
          assert.equal(await readFile(latest(name).artifacts!.text!, "utf8"), "done");
        }
      } finally {
        releaseOthers();
        release();
      }
    },
  );

test(
  "in-flight parent mutation does not prevent native writer admission",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { speed: 0 });
    f.session.agent.toolExecution = "parallel";
    f.model.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            command: "printf parent > parent.txt; while [ ! -f release ]; do sleep 0.01; done",
          }),
          fauxToolCall("delegate_task", {
            assignment: "child",
            profile: "implementation",
            background: true,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const prompting = f.session.prompt("overlap parent and child");
    try {
      await eventually(() => f.events.some((event) => event.child.status === "running"));
      await eventually(() => existsSync(join(f.root, "parent.txt")));
      assert.equal(f.session.isStreaming, true, "parent shell has not drained");
      assert.ok(f.events.every((event) => !event.child.writerLease));
      await writeFile(join(f.root, "release"), "release");
      await prompting;
      assert.equal(await readFile(join(f.root, "parent.txt"), "utf8"), "parent");
    } finally {
      await writeFile(join(f.root, "release"), "release");
      await prompting;
    }
  },
);

for (const cancellation of ["stop", "deadline"] as const)
  test(
    `concurrent sibling finishes while ${cancellation} retains only its own permit through drain`,
    { timeout: 10000 },
    async (t) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered = false;
      const f = await fixture(t, {
        speed: 0,
        extra: (pi) => {
          pi.on("tool_call", async (event) => {
            if (event.toolName === "write" && event.input.path === "held.txt") {
              entered = true;
              await gate;
            }
          });
        },
        response: (context) => {
          const text = userText(context);
          if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
          return fauxAssistantMessage(
            fauxToolCall("write", { path: text + ".txt", content: text }),
            { stopReason: "toolUse" },
          );
        },
      });
      await mkdir(join(f.root, "operator"), { recursive: true });
      await writeFile(
        join(f.root, "operator", "delegation.json"),
        JSON.stringify({ scheduling: { concurrency: 2 } }),
      );
      f.coordinator.configure({ ...DEFAULT_POLICY, concurrency: 2 });
      let stopping: Promise<void> | undefined;
      try {
        const first = await f.direct("held", "implementation", { limits: { deadlineMs: 1000 } });
        await eventually(() => entered);
        if (cancellation === "stop") stopping = f.coordinator.stop(first);
        else {
          // The native deadline initiates pause while the real hook remains held.
          await eventually(() => f.coordinator.snapshot(first)!.status === "pausing", 3000);
        }
        await eventually(() =>
          ["pausing", "draining"].includes(f.coordinator.snapshot(first)!.status),
        );
        const sibling = await f.direct("sibling", "implementation");
        const outcome = await f.coordinator.wait(sibling);
        assert.equal(outcome.status, "settled");
        assert.equal(await readFile(join(f.root, "sibling.txt"), "utf8"), "sibling");
        assert.equal(f.coordinator.snapshot(first)!.disposed, false);
        assert.ok(["pausing", "draining"].includes(f.coordinator.snapshot(first)!.status));
        release();
        await stopping;
        const drained = await f.coordinator.wait(first);
        assert.equal(drained.status, cancellation === "stop" ? "cancelled" : "paused");
        await assert.rejects(readFile(join(f.root, "held.txt")), /ENOENT/);
        if (cancellation === "deadline") {
          await f.coordinator.resume(first, "continued");
          const resumed = await f.coordinator.wait(first);
          assert.equal(resumed.status, "settled");
          assert.equal(resumed.id, first.id);
          assert.equal(await readFile(join(f.root, "continued.txt"), "utf8"), "continued");
        }
      } finally {
        release();
        await stopping;
      }
    },
  );
