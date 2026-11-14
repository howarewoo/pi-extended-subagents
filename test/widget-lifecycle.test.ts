import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  initTheme,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  InMemoryCredentialStore,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import {
  colorToRgb,
  indexedColor,
  rgbColor,
  ProcessTerminal,
  TuiMainScreen,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { eventually } from "./fixtures.ts";
import extension from "../src/pi-extended-subagents.ts";
import { createHub } from "../src/hub.ts";
import { DelegationCoordinator, type RegistryEvent } from "../src/coordinator.ts";

test(
  "real extension widget lifecycle and neutral Hub surfaces for native dark/light and tinted custom palettes",
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "extended-subagents-widget-"));
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(root, "operator");
    let session: AgentSession | undefined;
    t.after(async () => {
      try {
        if (session) {
          await session.abort();
          await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        }
      } finally {
        session?.dispose();
        if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
        await rm(root, { recursive: true, force: true });
      }
    });
    let markRunning!: () => void;
    let markDelta!: () => void;
    let running = new Promise<void>((resolve) => {
      markRunning = resolve;
    });
    let delta = new Promise<void>((resolve) => {
      markDelta = resolve;
    });
    let rendersAtStart = 0;
    let rendersAtDelta = 0;
    let renders = 0;
    const events: RegistryEvent[] = [];
    const settings = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: join(root, "agent"),
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        extension,
        (pi) => {
          pi.events.on("delegation:registry", (data) => {
            const event = data as RegistryEvent;
            events.push(event);
            if (event.event?.type === "agent_start") {
              rendersAtStart = renders;
              markRunning();
            }
            if (
              event.event?.type === "message_update" &&
              event.event.assistantMessageEvent.type === "text_delta"
            ) {
              rendersAtDelta = renders;
              markDelta();
            }
          });
        },
      ],
    });
    await loader.reload();
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      modelsStorePath: join(root, "cache.json"),
      refreshOnCreate: false,
    });
    const model = fauxProvider({ tokensPerSecond: 400, tokenSize: { min: 1, max: 1 } });
    const respond: FauxResponseFactory = (context) => {
      model.appendResponses([respond]);
      const user = context.messages.find((message) => message.role === "user");
      const text =
        typeof user?.content === "string"
          ? user.content
          : (user?.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("") ?? "");
      if (text === "launch")
        return !(
          context.messages.at(-1)?.role === "user" &&
          JSON.stringify(context.messages.at(-1)?.content).includes('"launch"')
        )
          ? fauxAssistantMessage("parent done")
          : fauxAssistantMessage(
              fauxToolCall("delegate_task", {
                assignment: "widget assignment ".repeat(30),
                profile: "general",
                background: true,
              }),
              { stopReason: "toolUse" },
            );
      return fauxAssistantMessage("child streaming ".repeat(50));
    };
    model.setResponses([respond]);
    runtime.registerNativeProvider(model.provider);
    ({ session } = await createAgentSession({
      cwd: root,
      agentDir: join(root, "agent"),
      modelRuntime: runtime,
      model: model.getModel(),
      resourceLoader: loader,
      tools: ["delegate_task", "read", "grep", "find", "ls"],
      settingsManager: settings,
      sessionManager: SessionManager.create(root, join(root, "transcripts")),
    }));
    initTheme("dark", false);
    const tui = new TuiMainScreen(new ProcessTerminal()); // Not started: no terminal input/output in this lifecycle test.
    t.mock.method(tui, "requestRender", () => {
      renders++;
    });
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
    const errors: unknown[] = [];
    await session.bindExtensions({
      mode: "tui",
      uiContext: ui,
      onError: (error) => {
        errors.push(error);
      },
    });
    assert.deepEqual(widget!.render(80), [], "no pinned line before a subagent starts");
    const panelLevels: number[] = [];
    for (const name of ["dark", "light", "tinted-custom"] as const) {
      if (name !== "tinted-custom") initTheme(name, false);
      const palette = {
        fg: ui.theme.fg.bind(ui.theme),
        style: ui.theme.style.bind(ui.theme),
        colors: {
          customMessageBg:
            name === "tinted-custom" ? rgbColor(255, 0, 128) : ui.theme.colors.customMessageBg,
        },
      };
      const hub = createHub(
        new DelegationCoordinator(root, "parent"),
        palette,
        { matches: () => false, getKeys: () => [] },
        () => {},
        () => {},
        { tui, cwd: root },
      );
      try {
        const levels = [1, 4, 8, 40].flatMap((width) =>
          hub.render(width).map((line) => {
            const ansi = line.match(/^\x1b\[48;(?:2;(\d+);(\d+);(\d+)|5;(\d+))m/);
            assert.ok(ansi, `${name}: explicit opaque background, not terminal default`);
            const color = ansi[4]
              ? colorToRgb(indexedColor(Number(ansi[4])))
              : { r: Number(ansi[1]), g: Number(ansi[2]), b: Number(ansi[3]) };
            assert.equal(color.r, color.g, `${name}: no red/green tint`);
            assert.equal(color.g, color.b, `${name}: no green/blue tint`);
            assert.equal(visibleWidth(line), width);
            assert.ok(line.endsWith("\x1b[49m"));
            assert.doesNotMatch(
              line,
              /\x1b\[0m(?!\x1b\[48;)/,
              "truncation reset must immediately restore the panel background",
            );
            return color.r;
          }),
        );
        assert.ok(
          levels.every((level) => level === levels[0]),
          "every panel row has the same neutral background",
        );
        panelLevels.push(levels[0]);
      } finally {
        hub.dispose();
      }
    }
    assert.ok(panelLevels[0] < panelLevels[1], "native light surface is lighter than native dark");
    initTheme("dark", false);
    await session.prompt("launch");
    // Background acknowledgment is setup/queued, not an SDK running acknowledgment.
    await Promise.all([running, delta]);
    assert.match(widget!.render(80).join("\n"), /Subagents.*running/);
    assert.ok(rendersAtDelta > rendersAtStart, "actual child text delta requests widget renders");
    const task = session.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "delegate_task",
    );
    assert.ok(task?.role === "toolResult");
    const identity = task.details as { id: string; generation: number };
    const callsBeforeStop = model.state.callCount;
    await session.prompt(`/subagent-stop ${identity.id} ${identity.generation}`);
    assert.equal(model.state.callCount, callsBeforeStop, "stop control makes no inference request");
    assert.match(widget!.render(80).join("\n"), /cancelled/);
    const oldWidget = widget!;
    await eventually(() => !session.isStreaming);
    const callsBeforeReload = model.state.callCount;
    await session.reload();
    assert.deepEqual(calls, [true, false, true]);
    assert.notEqual(widget, oldWidget);
    assert.equal(model.state.callCount, callsBeforeReload, "reload makes no inference request");
    assert.deepEqual(widget!.render(80), [], "fresh runtime hides the unused subagent widget");
    running = new Promise<void>((resolve) => {
      markRunning = resolve;
    });
    delta = new Promise<void>((resolve) => {
      markDelta = resolve;
    });
    await session.prompt("launch");
    await Promise.all([running, delta]);
    assert.match(widget!.render(80).join("\n"), /running/);
    assert.match(
      oldWidget.render(80).join("\n"),
      /cancelled/,
      "replacement activity cannot retarget the detached old observer",
    );
    const second = events.at(-1)!.child;
    assert.equal(second.disposed, false);
    const callsBeforeActiveReload = model.state.callCount;
    await session.reload();
    assert.equal(
      model.state.callCount,
      callsBeforeActiveReload,
      "active reload drains without new inference",
    );
    assert.deepEqual(calls, [true, false, true, false, true]);
    const drained = events.filter((event) => event.child.id === second.id).at(-1)!.child;
    assert.equal(drained.status, "cancelled");
    assert.equal(drained.disposed, true);
    assert.deepEqual(
      widget!.render(80),
      [],
      "active reload drains and hides the fresh empty widget",
    );
    assert.deepEqual(errors, [], "reload and drain must not use stale extension contexts");
    assert.ok(
      model.state.callCount >= 3,
      "controlled parent and delegated child used actual provider dispatch",
    );
  },
);
