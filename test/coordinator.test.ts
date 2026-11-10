import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProofCoordinator, proofResources } from "../src/coordinator.ts";
import { createHub } from "../src/hub.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentSession, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, getCurrentTools, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import extension from "../src/extension.ts";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "extended-subagents-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const coordinator = new ProofCoordinator(root);
  t.after(() => coordinator.shutdown());
  return { root, coordinator };
}
function streamed(coordinator: ProofCoordinator) {
  return new Promise<void>(resolve => {
    const unsubscribe = coordinator.subscribe(() => {
      if (coordinator.snapshot().progress) { unsubscribe(); resolve(); }
    });
  });
}

test("real SDK streams, queues steering, captures final output and reopens disk transcript without ambient resources", { timeout: 15000 }, async t => {
  const { root, coordinator } = await fixture(t);
  const extensions = join(root, "workspace", ".pi", "extensions");
  await mkdir(extensions, { recursive: true });
  await writeFile(join(extensions, "must-not-run.ts"), `throw new Error("ambient extension executed");`);
  await writeFile(join(root, "workspace", "AGENTS.md"), "AMBIENT_CONTEXT_MUST_NOT_APPEAR");
  const progress = streamed(coordinator);
  await coordinator.start("first assignment", 1000);
  await progress;
  assert.equal(coordinator.snapshot().status, "running");
  assert.equal(await coordinator.steer("queued steering"), "queued");
  await coordinator.wait();
  assert.equal(coordinator.snapshot().status, "completed");
  assert.match(coordinator.snapshot().result, /queued steering/);
  const reopened = coordinator.reopenTranscript();
  assert.deepEqual(getCurrentTools(reopened.messages), []);
  assert.ok(reopened.messages.filter(message => message.role === "assistant").length >= 2);
  assert.ok(!JSON.stringify(reopened).includes("AMBIENT_CONTEXT_MUST_NOT_APPEAR"));
  assert.ok((await readFile(coordinator.snapshot().transcript!, "utf8")).includes("queued steering"));
  const loader = proofResources();
  assert.deepEqual(loader.getExtensions().extensions, []);
  assert.deepEqual(loader.getSkills().skills, []);
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
  assert.deepEqual(loader.getPrompts().prompts, []);
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    modelsStorePath: join(root, "reopen-cache.json"), refreshOnCreate: false });
  const controlled = fauxProvider();
  runtime.registerNativeProvider(controlled.provider);
  const { session } = await createAgentSession({ cwd: join(root, "workspace"), agentDir: join(root, "agent"),
    modelRuntime: runtime, model: controlled.getModel(), resourceLoader: loader, tools: [],
    settingsManager: SettingsManager.inMemory(), sessionManager: SessionManager.open(coordinator.snapshot().transcript!) });
  try {
    assert.deepEqual(session.getActiveToolNames(), []);
    assert.match(session.getLastAssistantText()!, /queued steering/);
    assert.ok(!session.systemPrompt.includes("AMBIENT_CONTEXT_MUST_NOT_APPEAR"));
  } finally { session.dispose(); }
});

test("cancellation persists abort and shutdown disposes, is idempotent, and prevents later starts", { timeout: 15000 }, async t => {
  const { coordinator } = await fixture(t);
  const disposedFiles: (string | undefined)[] = [];
  const dispose = AgentSession.prototype.dispose;
  t.mock.method(AgentSession.prototype, "dispose", function (this: AgentSession) {
    disposedFiles.push(this.sessionFile);
    return dispose.call(this);
  });
  const progress = streamed(coordinator);
  await coordinator.start("long assignment", 100);
  await progress;
  await coordinator.shutdown();
  assert.equal(coordinator.snapshot().status, "cancelled");
  assert.equal(coordinator.snapshot().disposed, true);
  assert.deepEqual(disposedFiles, [coordinator.snapshot().transcript]);
  assert.equal(coordinator.reopenTranscript().messages.at(-1)?.role, "assistant");
  assert.match(await readFile(coordinator.snapshot().transcript!, "utf8"), /"stopReason":"aborted"/);
  await coordinator.shutdown();
  await assert.rejects(coordinator.start("too late"), /shut down/);
});

test("shutdown racing child creation waits for disposal without starting a model run", async t => {
  const { coordinator } = await fixture(t);
  const starting = coordinator.start("never run");
  await coordinator.shutdown();
  await starting;
  assert.equal(coordinator.snapshot().disposed, true);
  assert.equal(coordinator.snapshot().status, "cancelled");
  assert.equal(coordinator.snapshot().progress, "");
});

test("hub is width-safe, updates on streamed state and closing does not cancel execution", { timeout: 15000 }, async t => {
  const { coordinator } = await fixture(t);
  let renders = 0;
  let closed = false;
  const hub = createHub(coordinator, { fg: (_color, text) => text, bg: (_color, text) => text },
    { matches: (data, action) => data === "escape" && action === "tui.select.cancel", getKeys: () => ["escape"] },
    () => { renders++; }, () => { closed = true; });
  const progress = streamed(coordinator);
  await coordinator.start("中文 👩‍💻 \u001b]52;c;bad\u0007", 1000);
  await progress;
  for (const width of [0, 1, 2, 8, 40, 80]) {
    assert.ok(hub.render(width).every(line => visibleWidth(line) <= width));
  }
  hub.handleInput?.("escape");
  assert.equal(closed, true);
  hub.dispose();
  assert.equal(coordinator.snapshot().status, "running");
  const before = renders;
  await coordinator.wait();
  assert.equal(coordinator.snapshot().status, "completed");
  assert.equal(renders, before);
});

test("real parent reload emits shutdown and aborts the extension-owned child; RPC hub is guarded", { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "extended-subagents-parent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [extension] });
  await loader.reload();
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    modelsStorePath: join(root, "cache.json"), refreshOnCreate: false });
  const model = fauxProvider();
  runtime.registerNativeProvider(model.provider);
  const manager = SessionManager.create(root, join(root, "parent-transcripts"));
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime,
    model: model.getModel(), resourceLoader: loader, tools: [], settingsManager: settings, sessionManager: manager });
  t.after(() => session.dispose());
  await session.bindExtensions({ mode: "rpc" });
  await session.prompt("/proof-hub"); // would fail if it attempted a terminal-only custom UI
  await session.prompt("/proof-start parent-owned controlled child");
  const transcriptDir = join(manager.getSessionDir(), "extended-subagents-proof", manager.getSessionId(), "transcripts");
  // Wait for actual streaming before replacing the parent runtime.
  await new Promise(resolve => setTimeout(resolve, 200));
  await session.reload();
  const files = await readdir(transcriptDir);
  assert.equal(files.length, 1);
  const disk = await readFile(join(transcriptDir, files[0]), "utf8");
  assert.match(disk, /"stopReason":"aborted"/);
  assert.equal(model.state.callCount, 0, "slash commands and reload never called the parent model");
});
