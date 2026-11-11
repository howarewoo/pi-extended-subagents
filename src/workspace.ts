import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { BuiltinTool } from "./profiles.ts";

function ordinaryPath(path: string): void {
  if (path.includes("\0") || /^[~@]/.test(path) || /[\u00a0\u202f]/.test(path)) throw new Error("Workspace paths must use ordinary absolute/relative spelling, not ~, @ or nonbreaking spaces");
}

/** Existing directory only; never allocate, change process cwd, or infer project trust. */
export function resolveWorkspace(cwd: string | undefined, parentCwd: string): string {
  const root = realpathSync(parentCwd);
  if (cwd === undefined || cwd === parentCwd || cwd === root) return root;
  const path = cwd;
  ordinaryPath(path);
  const directory = realpathSync(resolve(parentCwd, path));
  ordinaryPath(directory);
  if (!statSync(directory).isDirectory()) throw new Error("Delegation cwd must be an existing directory");
  return directory;
}

/** Root hooks see the actual absolute paths/command, not a fictitious child dispatch cwd. */
export function workspaceArguments(name: BuiltinTool, args: unknown, cwd: string, parentCwd: string): unknown {
  if (cwd === realpathSync(parentCwd)) return args;
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Expected builtin tool arguments");
  const input = args as Record<string, unknown>;
  if (name === "bash") {
    if (typeof input.command !== "string") throw new Error("Expected a bash command");
    const quoted = "'" + cwd.replaceAll("'", "'\\''") + "'";
    // A failed cd must exit before ANY user command, including a semicolon/OR list.
    return { ...input, command: `cd -- ${quoted} || exit $?\n${input.command}` };
  }
  const path = input.path ?? (["grep", "find", "ls"].includes(name) ? "." : undefined);
  if (typeof path !== "string") throw new Error("Expected a builtin path");
  ordinaryPath(path);
  return { ...input, path: resolve(cwd, path) };
}
