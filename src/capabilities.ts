import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WRITE_TOOLS } from "./profiles.ts";

export type ToolMetadata = ReturnType<ExtensionAPI["getAllTools"]>[number];
export type CapabilityDenial = { name: string; reason: string };

/** These controls belong to the child coordinator, never to the root dispatcher. */
const CONTROLS = new Set([
  "delegate_task",
  "delegate_coordinate",
  "subagent",
  "submit_result",
  "codemode",
  "tool_search",
]);

/** A leaf grant is an operator assertion about trusted code, not a JavaScript sandbox.
 * Undeclared orchestration is outside that contract; annotations never authorize forwarding.
 */
export function leafDenial(
  tool: ToolMetadata,
  grants: readonly string[],
  sameWorkspace: boolean,
): string | undefined {
  if (CONTROLS.has(tool.name)) return "owned or orchestrating control cannot be forwarded";
  if (tool.reachesTools) return "tool-to-tool forwarding has no child execution scope";
  if (tool.exposure === "hidden" || tool.exposure === "model-only") return "tool is not callable";
  if (tool.sourceInfo.path.startsWith("builtin:")) return "builtin is outside the profile ceiling";
  if (WRITE_TOOLS.includes(tool.name as (typeof WRITE_TOOLS)[number]))
    return "builtin replacements cannot be leaf grants";
  if (!grants.includes(tool.name))
    return "no operator-reviewed leaf grant (unknown execution capabilities)";
  if (!sameWorkspace) return "custom tool execution cwd cannot be rebound to the child workspace";
  return undefined;
}

export function toolProvenance(tool: ToolMetadata): string {
  return JSON.stringify([tool.sourceInfo, tool.exposure, tool.namespace]);
}
