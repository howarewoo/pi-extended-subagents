import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/release-notes.mjs", import.meta.url));
const publishScript = fileURLToPath(new URL("../scripts/publish-package.mjs", import.meta.url));

for (const scenario of ["valid", "tag mismatch", "lock mismatch", "missing notes", "prerelease"])
  test(`release metadata: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-subagents-release-"));
    try {
      const version = scenario === "prerelease" ? "0.2.0-beta.1" : "0.2.0";
      await writeFile(join(root, "package.json"), JSON.stringify({ version, license: "MIT" }));
      await writeFile(
        join(root, "package-lock.json"),
        JSON.stringify({
          version,
          packages: { "": { version: scenario === "lock mismatch" ? "0.1.0" : version } },
        }),
      );
      await writeFile(
        join(root, "CHANGELOG.md"),
        `# Changelog\n\n## [${version}]\n\n${scenario === "missing notes" ? "" : "New release."}\n\n## [0.1.0]\n\nOld notes.\n`,
      );
      const output = join(root, "notes.md");
      const result = spawnSync(
        process.execPath,
        [script, scenario === "tag mismatch" ? "v0.3.0" : `v${version}`, output],
        { cwd: root, encoding: "utf8" },
      );
      if (scenario === "valid") {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await readFile(output, "utf8"), "New release.\n");
      } else {
        assert.notEqual(result.status, 0, "Invalid release must be rejected");
        assert.match(result.stderr, /AssertionError/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

for (const scenario of ["new", "identical", "different", "registry error"])
  test(`publication recovery: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-subagents-publish-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "@howarewoo/pi-subagents", version: "0.1.1" }),
      );
      const tarball = join(root, "release.tgz");
      await writeFile(tarball, "controlled tarball bytes");
      const integrity = `sha512-${createHash("sha512").update("controlled tarball bytes").digest("base64")}`;
      // Replace network and process publication in the subprocess, never contact npm or publish.
      const preload = `
        import assert from "node:assert/strict";
        import childProcess from "node:child_process";
        import { syncBuiltinESMExports } from "node:module";
        childProcess.execFileSync = (command, args) => {
          assert.equal(${JSON.stringify(scenario)}, "new", "Existing versions must not publish");
          assert.equal(command, "npm");
          assert.deepEqual(args, ["publish", ${JSON.stringify(tarball)}, "--access", "public"]);
          console.log("CONTROLLED_PUBLISH");
        };
        syncBuiltinESMExports();
        globalThis.fetch = async url => {
          assert.equal(url, "https://registry.npmjs.org/%40howarewoo%2Fpi-subagents/0.1.1");
          return {
            status: ${scenario === "new" ? 404 : scenario === "registry error" ? 503 : 200},
            json: async () => ({dist: {integrity: ${JSON.stringify(scenario === "different" ? "sha512-different" : integrity)}}})
          };
        };
      `;
      const result = spawnSync(
        process.execPath,
        ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, publishScript, tarball],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(result.status, ["new", "identical"].includes(scenario) ? 0 : 1, result.stderr);
      assert.equal(result.stdout.includes("CONTROLLED_PUBLISH"), scenario === "new");
      if (scenario === "different") assert.match(result.stderr, /different contents/);
      if (scenario === "registry error") assert.match(result.stderr, /Cannot verify/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
