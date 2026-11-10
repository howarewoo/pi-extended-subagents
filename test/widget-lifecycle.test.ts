import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, initTheme, ModelRuntime, SessionManager, SettingsManager,
  type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, type FauxResponseFactory } from "@earendil-works/pi-ai";
import { colorToRgb, indexedColor, rgbColor, ProcessTerminal, TuiMainScreen, visibleWidth, type Component } from "@earendil-works/pi-tui";
import extension from "../src/extension.ts";
import { createHub } from "../src/hub.ts";
import { DelegationCoordinator } from "../src/coordinator.ts";

test("real extension widget lifecycle and neutral Hub surfaces for native dark/light and tinted custom palettes", { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "extended-subagents-widget-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "operator");
  t.after(() => { if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir; });
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [extension] });
  await loader.reload();
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    modelsStorePath: join(root, "cache.json"), refreshOnCreate: false });
  const model = fauxProvider({ tokensPerSecond: 400, tokenSize: {min: 1, max: 1} });
  const respond: FauxResponseFactory = context => {
    model.appendResponses([respond]);
    const user = context.messages.find(message => message.role === "user");
    const text = typeof user?.content === "string" ? user.content : user?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
    if (text === "launch") return context.messages.at(-1)?.role === "toolResult" ? fauxAssistantMessage("parent done") : fauxAssistantMessage(fauxToolCall("delegate_task", {assignment: "widget assignment ".repeat(30), profile: "general", background: true}), {stopReason: "toolUse"});
    return fauxAssistantMessage("child streaming ".repeat(50));
  };
  model.setResponses([respond]);
  runtime.registerNativeProvider(model.provider);
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime,
    model: model.getModel(), resourceLoader: loader, tools: ["delegate_task", "read", "grep", "find", "ls"], settingsManager: settings,
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
      assert.equal(key, "delegation");
      calls.push(content !== undefined);
      widget = typeof content === "function" ? content(tui, this.theme) : undefined;
    },
  };
  await session.bindExtensions({ mode: "tui", uiContext: ui });
  assert.match(widget!.render(80).join("\n"), /FLEET 0/g);
  const panelLevels: number[] = [];
  for (const name of ["dark", "light", "tinted-custom"] as const) {
    if (name !== "tinted-custom") initTheme(name, false);
    const palette = { fg: ui.theme.fg.bind(ui.theme), style: ui.theme.style.bind(ui.theme),
      colors: { customMessageBg: name === "tinted-custom" ? rgbColor(255, 0, 128) : ui.theme.colors.customMessageBg } };
    const hub = createHub(new DelegationCoordinator(root, "parent"), palette,
      { matches: () => false, getKeys: () => [] }, () => {}, () => {});
    try {
      const levels = [1, 4, 8, 40].flatMap(width => hub.render(width).map(line => {
        const ansi = line.match(/^\x1b\[48;(?:2;(\d+);(\d+);(\d+)|5;(\d+))m/);
        assert.ok(ansi, `${name}: explicit opaque background, not terminal default`);
        const color = ansi[4] ? colorToRgb(indexedColor(Number(ansi[4])))
          : { r: Number(ansi[1]), g: Number(ansi[2]), b: Number(ansi[3]) };
        assert.equal(color.r, color.g, `${name}: no red/green tint`);
        assert.equal(color.g, color.b, `${name}: no green/blue tint`);
        assert.equal(visibleWidth(line), width);
        assert.ok(line.endsWith("\x1b[49m"));
        assert.doesNotMatch(line, /\x1b\[0m(?!\x1b\[48;)/, "truncation reset must immediately restore the panel background");
        return color.r;
      }));
      assert.ok(levels.every(level => level === levels[0]), "every panel row has the same neutral background");
      panelLevels.push(levels[0]);
    } finally { hub.dispose(); }
  }
  assert.ok(panelLevels[0] < panelLevels[1], "native light surface is lighter than native dark");
  initTheme("dark", false);
  await session.prompt("launch");
  assert.match(widget!.render(80).join("\n"), /running/);
  const afterStart = renders;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(renders > afterStart, "actual child deltas request widget renders");
  const task = session.messages.find(message => message.role === "toolResult" && message.toolName === "delegate_task");
  assert.ok(task?.role === "toolResult");
  const identity = task.details as {id: string; generation: number};
  const callsBeforeStop = model.state.callCount;
  await session.prompt(`/task-stop ${identity.id} ${identity.generation}`);
  assert.equal(model.state.callCount, callsBeforeStop, "stop control makes no inference request");
  assert.match(widget!.render(80).join("\n"), /cancelled/);
  const oldWidget = widget!;
  await session.reload();
  assert.deepEqual(calls, [true, false, true]);
  assert.notEqual(widget, oldWidget);
  assert.equal(model.state.callCount, callsBeforeStop, "reload makes no inference request");
  assert.match(widget!.render(80).join("\n"), /FLEET 0/g);
  const afterReload = renders;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(renders, afterReload, "old child no longer drives the replacement widget");
  assert.ok(model.state.callCount >= 3, "controlled parent and delegated child used actual provider dispatch");
});
