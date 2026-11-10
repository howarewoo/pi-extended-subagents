import test from "node:test";
import assert from "node:assert/strict";
import { createChildWidget, createHub } from "../src/hub.ts";
import { ProofCoordinator, type ChildSnapshot } from "../src/coordinator.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const keys = { matches: (data: string, action: string) => data === "escape" && action === "tui.select.cancel",
  getKeys: () => ["escape" as const] };
const theme = { fg: (_color: string, text: string) => text,
  bg: (color: string, text: string) => { assert.equal(color, "customMessageBg"); return `\x1b[48;5;17m${text}\x1b[49m`; } };

test("hub frames, pads and paints every cell, adapts to tiny geometry and invalidates theme output", () => {
  const coordinator = new ProofCoordinator("unused-render-only");
  let rows = 24;
  let palette = 17;
  const hub = createHub(coordinator, { ...theme, bg: (_color, text) => `\x1b[48;5;${palette}m${text}\x1b[49m` },
    keys, () => {}, () => {}, () => rows);
  try {
    for (const width of [0, 1, 2, 3, 4, 8, 20, 40, 80]) {
      for (rows of [1, 2, 3, 4, 5, 6, 7, 24]) {
        const rendered = hub.render(width);
        assert.ok(rendered.length <= rows);
        assert.ok(rendered.every(line => visibleWidth(line) === width));
        assert.ok(rendered.every(line => line.startsWith("\x1b[48;5;17m") && line.endsWith("\x1b[49m")));
        if (width >= 4 && rows >= 3) {
          assert.match(rendered[0], /╭.*╮/);
          assert.match(rendered.at(-1)!, /╰.*╯/);
          assert.ok(rendered.slice(1, -1).every(line => line.includes("│ ") && line.includes(" │")));
        }
      }
    }
    rows = 24;
    assert.match(hub.render(80).join("\n"), /Agent Hub · controlled proof/);
    assert.match(hub.render(80).join("\n"), /escape\/escape: close · child continues/);
    palette = 18;
    hub.invalidate();
    assert.ok(hub.render(80).every(line => line.startsWith("\x1b[48;5;18m")));
  } finally { hub.dispose(); }
});

test("widget retains each child state, sanitizes terminal content and shows latest activity at narrow widths", () => {
  let child: ChildSnapshot | undefined;
  const widget = createChildWidget(() => child, theme);
  assert.match(widget.render(100).join("\n"), /not-started.*proof-hub/);
  for (const status of ["starting", "running", "completed", "cancelled", "failed"] as const) {
    child = { status, progress: "old activity ".repeat(20) + "中文 👩‍💻 latest\u001b\u0007", result: "final result", disposed: false };
    const output = widget.render(80).join("\n");
    assert.ok(output.includes(status));
    assert.ok(widget.render(20)[0].startsWith(status));
    assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(output.replaceAll("\n", "")));
    if (status === "running") assert.ok(output.includes("latest"));
    else assert.ok(output.includes("final result"));
    for (const width of [0, 1, 2, 8, 20, 40]) assert.ok(widget.render(width).every(line => visibleWidth(line) <= width));
  }
  child = { ...child!, status: "failed", error: "Cannot start\u001b\u0007" };
  assert.match(widget.render(80).join("\n"), /Cannot start/);
});
