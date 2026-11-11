import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth, oklchColor } from "@earendil-works/pi-tui";
import { createProfileViewer, resolvedProfiles } from "../src/profile-viewer.ts";
import { bundledProfiles } from "../src/profiles.ts";
import extension from "../src/pi-extended-subagents.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
const keys = {
  matches: (data: string, action: string) =>
    data ===
    (
      {
        "tui.select.cancel": "\x1b",
        "tui.select.up": "up",
        "tui.select.down": "down",
        "tui.select.pageUp": "pgup",
        "tui.select.pageDown": "pgdown",
      } as Record<string, string>
    )[action],
  getKeys: () => ["escape" as const],
};
const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string) => text,
  colors: { customMessageBg: oklchColor(0.2, 0, 0) },
};

test("resolved command uses operator/trusted project settings and preserves non-TUI JSON envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "profile-viewer-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "operator");
  try {
    await mkdir(join(root, "operator"));
    await mkdir(join(root, ".pi"));
    await writeFile(
      join(root, "operator", "delegation.json"),
      JSON.stringify({
        scout: {
          description: "operator description",
          prompt: "operator prompt",
          tools: ["read"],
          spawn: ["review"],
          coordination: ["message"],
        },
      }),
    );
    await writeFile(
      join(root, ".pi", "delegation.json"),
      JSON.stringify({
        scout: { prompt: "project prompt", tools: [], spawn: [], coordination: [] },
      }),
    );
    assert.equal((await resolvedProfiles(root, false))[1].prompt, "operator prompt");
    const commands = new Map<
      string,
      { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> }
    >();
    const messages: { content: string }[] = [];
    extension({
      registerCommand: (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) =>
        commands.set(name, command),
      registerTool: () => {},
      on: () => {},
      registerMessageRenderer: () => {},
      sendMessage: (message: { content: string }) => messages.push(message),
    } as unknown as ExtensionAPI);
    const ctx = {
      cwd: root,
      isProjectTrusted: () => true,
      mode: "json",
      ui: {
        custom: () => {
          throw new Error("must not open TUI");
        },
      },
    } as unknown as ExtensionCommandContext;
    await commands.get("subagent-profiles")!.handler("", ctx);
    const value = JSON.parse(messages[0].content);
    assert.match(value.toolPolicy, /unknown/);
    assert.equal(value.profiles[1].prompt, "project prompt");
    assert.equal(value.profiles[1].description, "operator description");
    assert.deepEqual(value.profiles[1].tools, []);
    assert.deepEqual(value.profiles[1].spawn, []);
    assert.deepEqual(value.profiles[1].coordination, []);
    let opened = false;
    await commands.get("subagent-profiles")!.handler("", {
      ...ctx,
      mode: "tui",
      ui: {
        custom: async (_factory: unknown, options: { overlay: boolean }) => {
          opened = options.overlay;
        },
      },
    } as unknown as ExtensionCommandContext);
    assert.ok(opened);
    assert.equal(messages.length, 1);
    await writeFile(join(root, ".pi", "delegation.json"), "{bad");
    await assert.rejects(() => resolvedProfiles(root, true), /Invalid delegation config/);
    assert.equal((await resolvedProfiles(root, false)).length, 4);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("viewer selects arbitrary roles, scrolls complete sanitized details, stacks and fits tiny geometry", () => {
  const profiles = bundledProfiles();
  profiles.push({
    ...profiles[0],
    name: "future role",
    prompt: "line\n".repeat(60) + "END PROMPT\x1b[31m",
    skills: ["/synthetic/SKILL.md"],
  });
  let rows = 22;
  let closed = false;
  let refresh = 0;
  const viewer = createProfileViewer(
    profiles,
    theme,
    keys,
    () => refresh++,
    () => {
      closed = true;
    },
    () => rows,
  );
  const render = (width: number) => viewer.render(width).join("\n");
  assert.match(render(120), /general.*│.*general/);
  for (let i = 0; i < 4; i++) viewer.handleInput!("down");
  assert.match(render(120), /future role/);
  viewer.handleInput!("pgdown");
  assert.doesNotMatch(render(120), /Description/);
  viewer.handleInput!("\x1b[F");
  const end = render(120);
  assert.match(end, /Skills.*synthetic/);
  assert.match(end, /Models grant/);
  assert.doesNotMatch(end, /\x1b/);
  viewer.handleInput!("\x1b[H");
  assert.match(render(120), /Description/);
  viewer.handleInput!("up");
  assert.match(render(120), /implementation/);
  assert.match(render(42), /─{10}/);
  for (const width of [0, 1, 12, 23, 24, 42, 87, 88, 120])
    for (rows = 1; rows <= 25; rows++) {
      const lines = viewer.render(width);
      assert.ok(lines.length <= rows);
      assert.ok(
        lines.every((line) => visibleWidth(line) <= width),
        `width ${width}`,
      );
    }
  viewer.invalidate();
  viewer.handleInput!("\x1b");
  assert.ok(closed);
  assert.ok(refresh > 0);
});
