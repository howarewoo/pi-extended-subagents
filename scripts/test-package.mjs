import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

// Install the actual tarball without host peers: Pi supplies those at load time.
const root = await mkdtemp(join(tmpdir(), "pi-subagents-packed-"));
try {
  let tarball = process.argv[2] && resolve(process.argv[2]);
  if (!tarball) {
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", root], {
        encoding: "utf8",
      }),
    );
    tarball = join(root, packed.filename);
  }
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: root, stdio: "inherit" },
  );
  const installed = join(root, "node_modules", "pi-extended-subagents");
  const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  const expected = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, expected.name);
  assert.equal(pkg.version, expected.version);
  for (const file of ["CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"])
    assert.ok((await readFile(join(installed, file), "utf8")).trim(), `Missing ${file}`);

  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, "agent"),
    settingsManager: SettingsManager.inMemory({ packages: [installed] }),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const [extension] = loaded.extensions;
  assert.equal(extension.path, join(installed, "src", "pi-extended-subagents.ts"));
  for (const tool of ["delegate_task", "delegate_coordinate", "subagent"])
    assert.ok(extension.tools.has(tool), `Packed extension did not register ${tool}`);
  assert.ok(extension.commands.has("agent-hub"));
  console.log(`Installed tarball loads in Pi: ${pkg.name}@${pkg.version}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
