# Changelog

## [0.1.1]

### Scoped npm package

- Rename the npm package from `pi-extended-subagents` to `@howarewoo/pi-subagents`. The GitHub repository and production entrypoint are unchanged; the package rename does not change runtime behavior.
- To prevent duplicate extension loading, run `pi remove npm:pi-extended-subagents`, then `pi install npm:@howarewoo/pi-subagents`, and restart Pi after active tasks finish.
- Tested host remains Pi 1.5.2; requires Node 22.19 or newer. Shutdown or reload aborts and drains active children rather than migrating them.

### Subagent terminology and command migration

- Standardize current UI and documentation on Subagent Hub, Subagent Profiles and one-word subagent terminology.
- Replace `/agent-hub`, `/task-profiles`, `/task-status`, `/task-steer` and `/task-stop` with `/subagent-hub`, `/subagent-profiles`, `/subagent-status`, `/subagent-steer` and `/subagent-stop`, respectively. Update saved instructions and command invocations; the old commands are not registered as aliases.
- Delegation APIs, permissions, lifecycle and control behavior are unchanged.

## [0.1.0]

Initial versioned release.

- Delegate single assignments and ordered batches through `delegate_task` and the native `subagent` interface.
- Use explicit role, tool, skill, model and nesting grants, with parent-owned permission hooks.
- Follow, steer and stop work in Agent Hub, with live transcripts and generation-pinned controls.
- Validate structured results and retain per-generation transcripts and artifacts.
- Serialize model-tool writers and abort/drain children when the parent shuts down or reloads.

### Compatibility and lifecycle

Tested against Pi 1.5.2; requires Node 22.19 or newer. Other Pi versions are not yet verified.
Only one extension providing `subagent` should be loaded. Updating does not migrate active tasks:
let them finish before updating, then restart Pi. Shutdown or reload aborts and drains children.
