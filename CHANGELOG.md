# Changelog

## [Unreleased]

- Create new task/generation, agent and transcript directories with private POSIX mode `0700`, preserving exclusive creation and `0600` outcome artifacts. Existing records and parent/global storage permissions are unchanged; Windows access control remains dependent on filesystem ACLs.
- Enforce live initiator/ancestor grant revocation for nested task-file reads, spawning and coordination before protected effects; malformed policy fails closed. Already in-flight work and accepted mailbox effects are not rolled back.

### Breaking — next minor release

- Require exactly Pi 1.5.2 for delegated execution, including native and compatibility launches, resume, followup, revive and direct coordinator execution. Older, newer, prerelease and unknown versions reject before task-file reads, child allocation, task-directory setup or child model requests, with an error naming detected and supported versions.
- Keep required wildcard host peers and pinned SDK development packages unchanged. Wildcard peers are a Pi packaging requirement, not a promise of support for every host. Root status, stop/cleanup and diagnostics remain usable where the host can load the extension; arbitrary ancient SDK module-load compatibility is not promised.
- Migration: let active tasks drain, install Pi 1.5.2 and restart Pi. Check this restriction before updating Pi independently. Treat this as breaking in the next 0.x minor release; no package version bump is included here.

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
