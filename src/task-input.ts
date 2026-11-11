import { stat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionToolContext, ReadToolDetails } from "@earendil-works/pi-coding-agent";

function hasDeniedTaskComponent(path: string): boolean {
  return path.split(/[\\/]/).some(part => part.startsWith(".") || part === "node_modules");
}

/** Content is obtained only through the effective public read dispatcher, never raw filesystem reads. */
export async function readTaskInput(path: string, ctx: ExtensionToolContext, signal?: AbortSignal, beforeRead?: () => void, cwd = ctx.cwd): Promise<string> {
  if (!path || isAbsolute(path) || path.includes("\0") || hasDeniedTaskComponent(path)) throw new Error("taskFile must be an explicit non-hidden workspace-relative path without traversal");
  if (!ctx.tools.some(tool => tool.name === "read")) throw new Error("taskFile requires a callable parent read tool");
  const base = await realpath(cwd);
  const target = resolve(base, path);
  const checkedPath = await realpath(target);
  const inside = relative(base, checkedPath);
  if (!inside || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) throw new Error("taskFile escapes workspace");
  if (hasDeniedTaskComponent(inside)) throw new Error("taskFile resolved target must be non-hidden and outside node_modules");
  const before = await stat(target);
  if (!before.isFile() || before.size === 0 || before.size > 50000) throw new Error("taskFile must be a nonempty regular text file of at most 50000 bytes");
  signal?.throwIfAborted();
  beforeRead?.();
  const outcome = await ctx.executeTool("read", { path: target }, { signal });
  if (outcome.isError) throw new Error("taskFile read denied or failed: " + outcome.result.content.filter(block => block.type === "text").map(block => block.text).join("\n"));
  const details = outcome.result.details as ReadToolDetails | undefined;
  if (details?.truncation?.truncated || outcome.result.content.length !== 1 || outcome.result.content[0].type !== "text") throw new Error("taskFile must be complete untruncated text");
  const text = outcome.result.content[0].text;
  if (!text.trim() || text.includes("\0") || text.includes("\ufffd") || Buffer.byteLength(text) > 50000) throw new Error("taskFile must contain nonempty UTF-8 text without replacement characters or NUL");
  const after = await stat(target);
  if (await realpath(target) !== checkedPath || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("taskFile changed during preflight; retry");
  return text;
}
