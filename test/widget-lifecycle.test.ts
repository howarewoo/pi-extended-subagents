import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, initTheme, ModelRuntime, SessionManager, SettingsManager,
  type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ProcessTerminal, TuiMainScreen, type Component } from "@earendil-works/pi-tui";
import extension from "../src/extension.ts";

test("real extension widget observes child updates, retains cancellation and detaches/clears on parent reload", { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "extended-subagents-widget-"));
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
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime,
    model: model.getModel(), resourceLoader: loader, tools: [], settingsManager: settings,
    sessionManager: SessionManager.create(root, join(root, "transcripts")) });
  t.after(() => session.dispose());
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal()); // Not started: no terminal input/output in this lifecycle test.
  let renders = 0;
  t.mock.method(tui, "requestRender", () => { renders++; });
  let widget: Component | undefined;
  const calls: boolean[] = [];
  const ui: ExtensionUIContext = {
    ...session.extensionRunner.getUIContext(),
    setWidget(key, content) {
      assert.equal(key, "extended-subagents-proof");
      calls.push(content !== undefined);
      widget = typeof content === "function" ? content(tui, this.theme) : undefined;
    },
  };
  await session.bindExtensions({ mode: "tui", uiContext: ui });
  assert.match(widget!.render(80).join("\n"), /not-started/);
  await session.prompt("/proof-start widget assignment");
  assert.match(widget!.render(80).join("\n"), /running/);
  const afterStart = renders;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(renders > afterStart, "actual child deltas request widget renders");
  await session.prompt("/proof-cancel");
  assert.match(widget!.render(80).join("\n"), /cancelled/);
  const oldWidget = widget!;
  await session.reload();
  assert.deepEqual(calls, [true, false, true]);
  assert.notEqual(widget, oldWidget);
  assert.match(widget!.render(80).join("\n"), /not-started/);
  const afterReload = renders;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(renders, afterReload, "old child no longer drives the replacement widget");
  assert.equal(model.state.callCount, 0);
});
