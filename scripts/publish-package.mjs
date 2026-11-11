import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const tarball = process.argv[2];
assert.ok(tarball, "Supply the verified release tarball");
const response = await fetch(
  `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`,
);
if (response.status === 404) {
  execFileSync("npm", ["publish", tarball, "--access", "public"], { stdio: "inherit" });
} else {
  assert.equal(response.status, 200, "Cannot verify existing npm version; refusing to publish");
  const published = await response.json();
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(tarball))
    .digest("base64")}`;
  assert.equal(
    published.dist?.integrity,
    integrity,
    "This version exists with different contents. Never overwrite it; prepare a new version.",
  );
  console.log(`${pkg.name}@${pkg.version} already published with identical contents; continuing`);
}
