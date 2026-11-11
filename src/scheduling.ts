import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export type ExecutionLimits = { deadlineMs: number; requests: number; tools: number; depth: number; spawns: number };
export type SchedulingPolicy = ExecutionLimits & { concurrency: number; queue: number; batch: number };
export const DEFAULT_POLICY: Readonly<SchedulingPolicy> = { concurrency: 2, queue: 32, batch: 16, depth: 2, spawns: 8, deadlineMs: 600000, requests: 100, tools: 100 };
const ceilings: SchedulingPolicy = { concurrency: 16, queue: 256, batch: 64, depth: 4, spawns: 32, deadlineMs: 3600000, requests: 1000, tools: 1000 };
export function narrowLimits<T extends object>(base: T, value: unknown, maximum: T = base): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Limits must be an object");
  const result = { ...base };
  for (const [key, number] of Object.entries(value)) {
    if (!Object.hasOwn(base, key) || !Number.isSafeInteger(number) || (number as number) < (key === "depth" || key === "spawns" || key === "queue" ? 0 : 1) || (number as number) > (maximum as Record<string, number>)[key]) throw new Error(`Invalid or broadened limit: ${key}`);
    (result as Record<string, unknown>)[key] = number;
  }
  return result;
}
export function validatePolicy(value: unknown): SchedulingPolicy { return narrowLimits({ ...DEFAULT_POLICY }, value, ceilings); }
export async function resolveScheduling(cwd: string, trusted: boolean, operatorDir = getAgentDir()): Promise<SchedulingPolicy> {
  async function load(path: string): Promise<unknown> {
    try { return JSON.parse(await readFile(path, "utf8")).scheduling ?? {}; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  }
  const operator = validatePolicy(await load(join(operatorDir, "delegation.json")));
  return trusted ? narrowLimits(operator, await load(join(cwd, CONFIG_DIR_NAME, "delegation.json"))) : operator;
}
