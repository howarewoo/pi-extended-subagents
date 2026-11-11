import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture } from "./fixtures.ts";

test("public exact extension path executes only explicit fixture module with discovery disabled; it is trusted executable code", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "advanced-resources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".pi", "extensions"), { recursive: true });
  const selected = join(root, "selected.ts"),
    marker = join(root, "explicit-marker");
  await writeFile(
    selected,
    `import { writeFileSync } from "node:fs"; export default function () { writeFileSync(${JSON.stringify(marker)}, "explicit fixture executed"); }`,
  );
  await writeFile(
    join(root, ".pi", "extensions", "ambient.ts"),
    'throw new Error("ambient extension must not execute");',
  );
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, "agent"),
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [selected],
  });
  await loader.reload();
  assert.equal(loader.getExtensions().errors.length, 0);
  assert.equal(loader.getExtensions().extensions.length, 1);
  assert.equal(await readFile(marker, "utf8"), "explicit fixture executed");
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
});

test("public ordinary prompt rejects active-session side turn; steering is not ephemeral transcript-free probing", async (t) => {
  let entered!: () => void, release!: () => void;
  const active = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    speed: 0,
    response: (context) =>
      context.messages.at(-1)?.role === "toolResult"
        ? fauxAssistantMessage("finished")
        : fauxAssistantMessage(fauxToolCall("read", { path: "synthetic.txt" }), {
            stopReason: "toolUse",
          }),
    extra: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "read") {
          entered();
          await gate;
          return { block: true, reason: "synthetic gate" };
        }
      });
    },
  });
  const run = f.session.prompt("active synthetic request");
  try {
    await active;
    await assert.rejects(f.session.prompt("probe without transcript"), /streaming|already|steer/i);
    assert.equal("runEphemeralTurn" in f.session, false);
    assert.equal(
      f.model.getPendingResponseCount(),
      1,
      "rejected side prompt dispatched no extra provider request",
    );
  } finally {
    release();
    await run;
  }
});
