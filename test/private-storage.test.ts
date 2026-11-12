import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fixture, eventually } from "./fixtures.ts";
import type { ChildSnapshot } from "../src/coordinator.ts";

const isolated = process.env.PI_PRIVATE_STORAGE_TEST === "1";
test(
  "new task and successor storage is private under a permissive POSIX umask",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    if (!isolated) {
      const env: NodeJS.ProcessEnv = { ...process.env, PI_PRIVATE_STORAGE_TEST: "1" };
      delete env.NODE_TEST_CONTEXT;
      const { stdout, stderr } = await promisify(execFile)(
        "/bin/sh",
        [
          "-c",
          'umask 000; exec "$@"',
          "sh",
          process.execPath,
          "--test",
          "--test-reporter=tap",
          fileURLToPath(import.meta.url),
        ],
        { env, timeout: 30000 },
      );
      assert.match(stdout, /# pass 1/);
      assert.equal(stderr, "");
      return;
    }
    assert.equal(process.umask(), 0);
    const f = await fixture(t, {
      speed: 0,
      response: (context) => {
        if (context.messages.at(-1)?.role === "toolResult")
          return fauxAssistantMessage("completed");
        const latest = context.messages.filter((message) => message.role === "user").at(-1);
        const text =
          typeof latest?.content === "string"
            ? latest.content
            : (latest?.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("") ?? "");
        for (const [prefix, name] of [
          ["LAUNCH ", "delegate_task"],
          ["COORD ", "delegate_coordinate"],
        ])
          if (text.startsWith(prefix))
            return fauxAssistantMessage(fauxToolCall(name, JSON.parse(text.slice(prefix.length))), {
              stopReason: "toolUse",
            });
        return fauxAssistantMessage(fauxToolCall("submit_result", { value: 7 }), {
          stopReason: "toolUse",
        });
      },
    });
    const mode = async (path: string) => (await stat(path)).mode & 0o777;
    const parent = join(f.root, "parent");
    const storage = join(parent, "delegation", f.session.sessionManager.getSessionId());
    const old = join(storage, "historical");
    await mkdir(old, { recursive: true, mode: 0o755 });
    const oldFile = join(old, "result.txt");
    await writeFile(oldFile, "existing record", { mode: 0o644 });
    const untouched = [parent, storage, old, oldFile];
    const before = await Promise.all(untouched.map(mode));
    await f.session.prompt(
      'LAUNCH {"assignment":"submit","profile":"general","resultSchema":{"type":"integer"},"background":false}',
    );
    const first = f.events.filter((event) => event.child.disposed).at(-1)!.child;
    const check = async (state: ChildSnapshot) => {
      assert.equal(state.status, "settled", String(state.error));
      assert.equal(state.outcome?.value, 7);
      const directory = dirname(state.artifacts!.text!);
      for (const path of [directory, join(directory, "agent"), join(directory, "transcripts")])
        assert.equal(await mode(path), 0o700, path);
      for (const path of [state.artifacts!.text!, state.artifacts!.structured!])
        assert.equal(await mode(path), 0o600, path);
      assert.equal(await readFile(state.artifacts!.text!, "utf8"), "completed");
      assert.equal(await readFile(state.artifacts!.structured!, "utf8"), "7");
      assert.equal(dirname(state.transcript!), join(directory, "transcripts"));
      assert.match(await readFile(state.transcript!, "utf8"), /submit_result/);
      return directory;
    };
    const firstDir = await check(first);
    const original = await readFile(first.transcript!, "utf8");
    await f.session.prompt(
      "COORD " +
        JSON.stringify({
          action: "followup",
          target: { id: first.id, generation: first.generation },
          assignment: "submit again",
        }),
    );
    await eventually(() =>
      f.events.some((event) => event.child.generation === 2 && event.child.disposed),
    );
    const second = f.events.filter((event) => event.child.generation === 2).at(-1)!.child;
    assert.equal(second.id, first.id);
    assert.equal(await check(second), firstDir + "-g2");
    assert.equal(await readFile(first.transcript!, "utf8"), original);
    assert.deepEqual(await Promise.all(untouched.map(mode)), before);
    assert.equal(await readFile(oldFile, "utf8"), "existing record");
  },
);
