import test from "node:test";
import assert from "node:assert/strict";
import { createChildWidget, createHub } from "../src/hub.ts";
import { DelegationCoordinator, type ChildSnapshot } from "../src/coordinator.ts";
import { backgroundAnsi, oklchColor, styleText, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeStyle } from "@earendil-works/pi-coding-agent";

const keys = { matches: (data: string, action: string) => data === "escape" && action === "tui.select.cancel",
  getKeys: () => ["escape" as const] };
const theme = { fg: (_color: string, text: string) => text,
  colors: { customMessageBg: oklchColor(0.3, 0.1, 330) },
  style: (text: string, { bg }: ThemeStyle) => {
    assert.ok(bg && typeof bg !== "string", "panel must supply a concrete neutral color");
    return styleText(text, { bg }, "truecolor");
  } };

test("hub frames, pads and paints every cell, adapts to tiny geometry and invalidates theme output", () => {
  const coordinator = new DelegationCoordinator("unused-render-only", "parent");
  let rows = 24;
  const palette = { ...theme, colors: { ...theme.colors } };
  const darkBg = backgroundAnsi(oklchColor(0.3, 0, 0), "truecolor");
  const hub = createHub(coordinator, palette,
    keys, () => {}, () => {}, () => rows);
  try {
    for (const width of [0, 1, 2, 3, 4, 8, 20, 40, 80]) {
      for (rows of [1, 2, 3, 4, 5, 6, 7, 24]) {
        const rendered = hub.render(width);
        assert.ok(rendered.length <= rows);
        assert.ok(rendered.every(line => visibleWidth(line) === width));
        assert.ok(rendered.every(line => line.startsWith(darkBg) && line.endsWith("\x1b[49m")));
        if (width >= 4 && rows >= 3) {
          assert.match(rendered[0], /╭.*╮/);
          assert.match(rendered.at(-1)!, /╰.*╯/);
          assert.ok(rendered.slice(1, -1).every(line => line.includes("│ ") && line.includes(" │")));
        }
      }
    }
    rows = 24;
    assert.match(hub.render(80).join("\n"), /Delegation · latest task/);
    assert.match(hub.render(80).join("\n"), /escape\/escape: close · child continues/);
    palette.colors.customMessageBg = oklchColor(0.9, 0.1, 330);
    hub.invalidate();
    const lightBg = backgroundAnsi(oklchColor(0.9, 0, 0), "truecolor");
    assert.ok(hub.render(80).every(line => line.startsWith(lightBg)));
  } finally { hub.dispose(); }
});

test("widget retains each child state, sanitizes terminal content and shows latest activity at narrow widths", () => {
  let child: ChildSnapshot | undefined;
  const widget = createChildWidget(() => child, theme);
  assert.match(widget.render(100).join("\n"), /not-started.*task-hub/);
  for (const status of ["queued", "setup", "running", "draining", "settled", "cancelled", "failed"] as const) {
    child = { id: "test", generation: 1, parentId: "parent", depth: 1, writerLease: false, limits: { deadlineMs: 600000, requests: 100, tools: 100, depth: 2, spawns: 8 }, toolCalls: 0, profile: "general", assignment: "test", activity: "", model: {provider: "test", id: "test"}, effort: "off", telemetry: {requests: null, tokens: null, cost: null, context: null}, status, progress: "old activity ".repeat(20) + "中文 👩‍💻 latest\u001b\u0007", result: "final result", disposed: ["settled", "failed", "cancelled"].includes(status) };
    const output = widget.render(80).join("\n");
    assert.ok(output.includes(status));
    assert.ok(widget.render(20)[0].startsWith(status));
    assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(output.replaceAll("\n", "")));
    if (status === "running") assert.ok(output.includes("latest"));
    else if (child.disposed) assert.ok(output.includes("final result"));
    for (const width of [0, 1, 2, 8, 20, 40]) assert.ok(widget.render(width).every(line => visibleWidth(line) <= width));
  }
  child = { ...child!, status: "running", profile: "implementation", writerLease: true, disposed: false };
  assert.match(widget.render(100).join("\n"), /no conflicting manual !\/!! or external edits/);
  child = { ...child!, status: "failed", error: "Cannot start\u001b\u0007" };
  assert.match(widget.render(80).join("\n"), /Cannot start/);
});
