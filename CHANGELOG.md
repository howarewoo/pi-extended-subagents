# Changelog

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
