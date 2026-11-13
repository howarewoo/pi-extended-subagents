import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { InteractiveMode } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";

// Exercise the pinned host's actual startup formatter, not a copy of its naming rules.
// This internal API is test-only; the extension does not patch Pi's startup UI.
test("npm package startup label is exactly the scoped package name", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
  const path = fileURLToPath(new URL("../index.ts", import.meta.url));
  const mode = Object.create(InteractiveMode.prototype);
  const labels = mode.getCompactExtensionLabels([
    {
      path,
      sourceInfo: {
        source: `npm:${manifest.name}`,
        scope: "user",
        baseDir: fileURLToPath(new URL("..", import.meta.url)),
      },
    },
  ]);
  assert.deepEqual(labels, ["@howarewoo/pi-subagents"]);
});
