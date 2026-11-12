# Changelog

## [Unreleased]

- Simplify README installation and update guidance now that the repository rename is complete. Keep current npm/Git sources, duplicate-loading precautions and a link to the historical package migration instructions.

## [0.2.0]

Requires Node 22.19+ and stable Pi 1.5.2 or newer. Tested host: Pi 1.5.2; newer stable
hosts are allowed, not guaranteed compatible. The npm package remains `@howarewoo/pi-subagents`.

- Prepare the GitHub repository rename from `howarewoo/pi-extended-subagents` to `howarewoo/pi-subagents`: update canonical links, Git installation examples, package metadata and the release repository guard. The npm package remains `@howarewoo/pi-subagents`; the production entrypoint and runtime behavior are unchanged. The repository owner must coordinate the GitHub rename and verify npm trusted publishing before the next release; these external settings are not changed here.

- Simplify the README: put delegation examples before comparisons and architectural rationale, shorten repeated explanations, and make native controls and execution limits easier to scan. Preserve examples, section anchors and safety boundaries.
- Replace the README's unknown tintinweb messaging comparison with source-verified limited support: parent-to-child steering and result return, without built-in child-initiated or sibling messaging.
- Clarify in the README and advanced policy documentation that worktree lifecycle management is intentionally caller-owned, not a deferred extension feature; distinguish it from deferred filesystem isolation. Existing `cwd` support, parent permission hooks and global writer serialization are unchanged; workspace selection is not filesystem containment.
- Compact collapsed Delegate results to task headlines and statuses, keeping error and pause reasons visible. Use Pi’s global tool-output toggle (`Ctrl+O` by default, or the configured binding) to reveal detailed cards; model-facing results, saved artifacts and Subagent Hub behavior are unchanged.
- Enable child-local codemode for every subagent profile, including nested agents, when codemode is enabled in the parent. Scripts expose only child-authorized tools, with the `models` API disabled; existing permission hooks, workspace mapping, tool budgets and cancellation remain enforced. Failed or permission-blocked edits and writes do not trigger the prewalk model handoff.
- Remove persistent writer warnings from the pinned Subagents widget and Subagent Hub footer, freeing space for task activity. Keep the coordination caveat in Hub Details and the README; writer serialization is unchanged.
- Remove unused provider-secret bindings and credential examples from the Pullfrog workflow while retaining its OIDC App token integration.
- Create new task/generation, agent and transcript directories with private POSIX mode `0700`, preserving exclusive creation and `0600` outcome artifacts. Existing records and parent/global storage permissions are unchanged; Windows access control remains dependent on filesystem ACLs.
- Enforce live initiator/ancestor grant revocation for nested task-file reads, spawning and coordination before protected effects; malformed policy fails closed. Already in-flight work and accepted mailbox effects are not rolled back.

### Release isolation

- Separate release validation, human-protected npm publication and GitHub release creation into jobs with distinct credentials. Publish only the exact smoke-tested tarball after mandatory SHA-512 and release-identity verification; suppress npm lifecycle scripts.
- Repository owners must configure the `npm` environment approval and release-tag protections, and verify npm trusted publishing before a live release. These account settings are not configured by the workflow.

### Breaking — minimum supported Pi version

- Require stable Pi 1.5.2 or newer for delegated execution, including native and compatibility launches, resume, followup, revive and direct coordinator execution. Below-minimum, prerelease, malformed and unknown versions reject before task-file reads, child allocation, task-directory setup or child model requests, with an error naming the detected version and minimum stable version. Newer stable patch, minor and major versions are allowed; standard build metadata has equal precedence. Tested host remains Pi 1.5.2, not a compatibility guarantee for future allowed stable versions.
- Keep required wildcard host peers and pinned SDK development packages unchanged. Wildcard peers are a Pi packaging requirement, not a promise of support for every host. Root status, stop/cleanup and diagnostics remain usable where the host can load the extension; arbitrary ancient SDK module-load compatibility is not promised.
- Migration from 0.1.x: let active tasks drain, install stable Pi 1.5.2 or newer, update the extension to `@howarewoo/pi-subagents@0.2.0` and restart Pi. Shutdown or reload aborts and drains active children rather than migrating them.

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
