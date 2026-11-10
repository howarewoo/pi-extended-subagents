import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("isolated real Pi CLI exit aborts the delegated child before scripted completion", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "extended-subagents-cli-"));
  try {
    const cli = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js", import.meta.url));
    const extension = fileURLToPath(new URL("../src/extension.ts", import.meta.url));
    const controlled = fileURLToPath(new URL("../examples/controlled-parent.ts", import.meta.url));
    const invocation = promisify(execFile)(process.execPath, [cli,
      "--offline", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates",
      "--no-themes", "--no-context-files", "--tools", "read,grep,find,ls,delegate_task", "--session-dir", join(root, "sessions"),
      "-e", extension, "-e", controlled, "-p", "delegate example",
    ], { cwd: root, timeout: 10000,
      env: { PATH: process.env.PATH, HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" } });
    // Pi consumes piped stdin before processing CLI prompts; signal EOF explicitly.
    invocation.child.stdin?.end();
    await invocation;
    const children = join(root, "sessions", "delegation");
    const parents = await readdir(children);
    assert.equal(parents.length, 1);
    const tasks = await readdir(join(children, parents[0]));
    assert.equal(tasks.length, 1);
    const transcripts = join(children, parents[0], tasks[0], "transcripts");
    const files = await readdir(transcripts);
    assert.equal(files.length, 1);
    const disk = await readFile(join(transcripts, files[0]), "utf8");
    assert.match(disk, /"stopReason":"aborted"/);
    assert.ok(!disk.includes('"stopReason":"stop"'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
