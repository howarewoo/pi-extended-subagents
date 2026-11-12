# @howarewoo/pi-subagents

[![npm version](https://img.shields.io/npm/v/@howarewoo/pi-subagents)](https://www.npmjs.com/package/@howarewoo/pi-subagents)
[![npm downloads](https://img.shields.io/npm/dm/@howarewoo/pi-subagents)](https://www.npmjs.com/package/@howarewoo/pi-subagents)

Delegate work to subagents in Pi, follow their progress, and steer or stop them from Subagent Hub. Subagents use your selected model by default, with their own assignments and explicit tool grants.

![Terminal illustration of Subagent Hub with a four-task list on the left and the selected Reader alpha conversation on the right, including a native read-tool result containing synthetic input.](docs/images/subagent-hub.svg)

_Subagent Hub: tasks and conversations side by side, with each profile and status aligned beneath its agent’s name. Illustrated with synthetic demo data._

## Installation

Requires Node 22.19+ and **stable Pi 1.5.2 or newer** for delegated execution. Pi 1.5.2
is the minimum; newer stable patch, minor and major versions are allowed. Standard build
metadata does not affect version precedence. Below-minimum, prerelease, malformed and
unknown host versions are rejected before task-file reads, child allocation, disk setup
or child model requests. **Tested host: Pi 1.5.2**; allowing future stable versions is not
a tested compatibility guarantee. Wildcard host peer dependencies are required by Pi's
package format; they are not a compatibility promise. SDK development packages stay pinned.

If execution reports an unsupported host, install stable Pi 1.5.2 or newer and restart Pi
after active tasks drain. Where the host can load the extension, root status, stop/cleanup
and diagnostics remain available; arbitrary ancient SDKs may fail to load the module at all.
This minimum-host restriction is a breaking change for the next minor release; the package
version is not bumped here.

Install from npm:

```sh
pi install npm:@howarewoo/pi-subagents
```

### Migrate from the old package

If you installed `pi-extended-subagents`, remove it before installing the scoped package
so Pi does not load the extension twice:

```sh
pi remove npm:pi-extended-subagents
pi install npm:@howarewoo/pi-subagents
```

Use only one source. When switching from Git to npm, remove the Git registration first with
`pi remove git:github.com/howarewoo/pi-extended-subagents`. The Git repository has not moved;
`pi install git:github.com/howarewoo/pi-extended-subagents` remains an alternative.

Restart Pi and run `/subagent-profiles` to check the installation. If you already installed a local checkout, remove that registration first with `pi remove /path/to/pi-extended-subagents` to avoid loading it twice.

## Updates and rollback

Let active subagents finish before updating, then restart Pi. Shutdown or `/reload` aborts
and drains children; active tasks are not migrated to the new version. There is no extension-owned
auto-updater.

```sh
# Update an unpinned npm installation
pi update npm:@howarewoo/pi-subagents

# Or update all installed extension packages
pi update --extensions
```

Plain `pi update` updates Pi itself, not installed extension packages. For a Git installation,
use `pi update git:github.com/howarewoo/pi-extended-subagents`; an unpinned Git source tracks
the repository's default branch, including unreleased commits.

For a reproducible npm installation or rollback, select an exact published version:

```sh
pi install npm:@howarewoo/pi-subagents@0.1.1
```

For Git, select a published tag, for example
`pi install git:github.com/howarewoo/pi-extended-subagents@v0.1.1`.
Exact npm versions and Git tags stay pinned; updating does not advance them to the next release.
Install a different version explicitly to change the pin.

[CHANGELOG.md](CHANGELOG.md) lists user-facing changes and migrations. Pi shows new package
changelog entries on the next fresh launch after a version increase. See the
[maintainer release guide](docs/releases.md) for publishing and recovery.

## Feature comparison

Compared with two community alternatives using their documentation, checked on 2026-11-11. This is a feature comparison, not a performance or reliability benchmark. UI cells name documented surfaces; they do not imply other features are absent.

| Feature                  | @howarewoo/pi-subagents                                          | [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) | [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Background tasks         | Until parent exit or reload                                      | ✓ Supported                                                           | ✓ Supported                                                         |
| Nested delegation        | Opt-in; foreground only                                          | Opt-in                                                                | Opt-in                                                              |
| Task list / conversation | Subagent Hub: split panes; full-width thread on narrow terminals | Fleet inspector: roster and output pane                               | FleetView opens a separate conversation viewer                      |
| Message / tool rendering | Native Pi message and tool components                            | Structured Markdown/tool transcripts                                  | Markdown + session-registered tool renderers                        |
| Live follow / scrollback | ✓ Scroll up to pause; End to follow                              | ✓ Scroll away to pause; bottom resumes                                | ✓ Scroll up to pause; End to follow                                 |
| In-UI task controls      | Hub: steer, inbox, stop, wait, park                              | Inspector: steer/follow-up and stop async runs                        | Viewer: steer, stop, foreground-to-background handoff               |
| Tool / usage inspection  | Tools: sanitized arguments/results; Details: direct usage        | Expandable tool details + token counts                                | Expandable tool output + tokens; optional cost                      |
| Schema-validated results | ✓ Supported                                                      | ✓ Supported                                                           | Workflow agents only                                                |
| Managed Git worktrees    | — Not supported                                                  | ✓ Supported                                                           | ✓ Supported                                                         |
| Workflow scripts         | — Not supported                                                  | ✓ Supported                                                           | ✓ Supported                                                         |
| Scheduled runs           | — Not supported                                                  | ✓ Supported                                                           | Session-scoped agents only                                          |

Sources: [our contract](docs/delegation-contract.md); nicobailon's [README](https://github.com/nicobailon/pi-subagents/blob/c99503aed6d6b20d2397a1767f7d60730efe3963/README.md), [agents](https://github.com/nicobailon/pi-subagents/blob/c99503aed6d6b20d2397a1767f7d60730efe3963/docs/agents.md), [workflows](https://github.com/nicobailon/pi-subagents/blob/c99503aed6d6b20d2397a1767f7d60730efe3963/docs/workflows.md) and [observability](https://github.com/nicobailon/pi-subagents/blob/c99503aed6d6b20d2397a1767f7d60730efe3963/docs/observability.md); tintinweb's [README](https://github.com/tintinweb/pi-subagents/blob/8df7fa7d8e8130151a8fbfa991a1d3fa6b443739/README.md) and [workflows](https://github.com/tintinweb/pi-subagents/blob/8df7fa7d8e8130151a8fbfa991a1d3fa6b443739/docs/workflows.md).

## Native orchestration

Pi discovers the native `subagent` tool at startup through its tool description and coding-worker guidance; no enable call is needed. For replacement use, load only one extension providing `subagent`: Pi uses the first registration, not an automatic provider preference. Switching providers does not migrate or remove old runs.

```json
{
  "agent": "worker",
  "task": "Implement the approved change; follow the supplied repository guidelines and task references",
  "cwd": "/absolute/path/to/task-worktree"
}
```

`worker` uses the configured `implementation` profile. `scout`, `review` and `general` are also available. Calls are async by default and wake the parent after drain; set `async:false` to wait. Batches use `tasks:[{agent,task,cwd?}]`. Use the returned `id` with `action:"status"`, `"steer"`, `"stop"` or `"resume"`; steer/resume also need `message`. Resume continues a paused conversation in the same generation; for completed idle/parked work it starts a fresh generation, so include needed prior conclusions.

The coordinator supplies an existing workspace and the complete handoff, including accessible skill/reference paths. The extension does not create or manage worktrees. This is the [supported orchestration interface](docs/delegation-contract.md#native-orchestration-compatibility), not compatibility with every competing workflow script or custom agent definition.

## Use delegation

Choose a model through Pi's `/login` and `/model` setup. Delegation uses that provider and may incur charges; it does not automatically switch to a cheaper model.

Ask Pi:

> Use delegate_task with profile scout to locate the startup lifecycle code and report source locations. Run it in the foreground.

The corresponding tool call is:

```json
{
  "assignment": "Locate startup lifecycle code and report source locations",
  "profile": "scout",
  "background": false
}
```

Or submit a batch:

```json
{
  "tasks": [
    { "assignment": "Locate startup code", "profile": "scout" },
    { "assignment": "Review lifecycle tests", "profile": "review", "limits": { "requests": 20 } }
  ],
  "background": false
}
```

The default is 16 concurrent tasks, a 32-item queue and up to 16 tasks per batch. Every item passes preflight before any starts. One failed task does not cancel its siblings.

`scout` and `review` allow up to `read`, `grep`, `find` and `ls`. `general` and `implementation` also allow `write`, `edit` and `bash`. Each role receives only the builtins already callable in the parent. With Pi's default tools, scouts get `read` only. Tool calls retain the parent's permission hooks; incompatible tool overrides are rejected.

`general` also inherits the parent's available skills, not its instructions or conversation history. Its existing role prompt and supplied assignment remain intact. Operator/trusted-project configuration can narrow inheritance with `tools` and `skills` (explicit `[]` removes grants). General can write when its inherited builtin set includes writing tools.

Non-builtin inheritance is **restricted**: the operator may set `general.leafTools` to exact reviewed extension/MCP tool names in `delegation.json`. This is an assertion that the trusted implementation is a leaf: it never calls other Pi tools or changes the tool/model/session loadout. Unknown tools are denied, not automatically trusted from their descriptions or annotations. Declared reaching tools, codemode, tool search, owned delegation controls, hidden/model-only tools, and builtin replacements are never forwarded this way. Leaf tools are denied when child cwd differs from root cwd; only builtins have a workspace adapter. All admitted leaf tools conservatively require the global writer lease. See [restricted inheritance](docs/delegation-contract.md#restricted-general-inheritance) for the trust boundary and diagnostics.

Foreground calls return the final results. Set `background:true` to return immediately and receive one ordered completion message after the batch drains. Use the returned task ID and generation for controls:

```text
/subagent-profiles
/subagent-status
/subagent-status <id> <generation>
/subagent-steer <id> <generation> <text>
/subagent-stop <id> <generation>
/subagent-hub
```

## Subagent Profiles

Run `/subagent-profiles` to inspect the resolved profiles for the current workspace: bundled definitions, operator `delegation.json`, then trusted-project narrowing. It opens a read-only list/details overlay, not an editor. Reopen it after configuration changes to refresh the snapshot.

Use ↑/↓ to select a role; j/k, PgUp/PgDn and Home/End scroll details; Esc closes (configured selection bindings also apply). Narrow terminals stack the list above details; tiny terminals ask you to resize. Details show the description, prompt, builtin tool ceiling, exact skill paths, spawn/coordination ceilings and model/prewalk policy.

**Ceilings are not callable tools.** Pi's command context has no callable-tool dispatcher, so the viewer reports effective tools as unknown rather than treating active declarations as executable grants. Admission performs the real intersection and remaining checks; inspect a task's `tools` in `/subagent-status` or Hub Details. RPC, JSON and print modes retain the structured `{toolPolicy, profiles}` message instead of opening an overlay. Invalid configuration or missing/invalid granted skills fails resolution, as at admission.

![Native-renderer illustration of Subagent Profiles with a synthetic role list and selected general profile details.](docs/images/subagent-profiles.svg)

_Synthetic native-component output; not a terminal screenshot or live-provider verification._

## Subagent Hub

Subagent Hub shows the subagent list beside the selected conversation, using Pi's native message and tool rendering. On narrow terminals, the conversation takes the full width. A border-colored horizontal rule separates the conversation and task list from the visible footer; it is omitted when the footer is hidden at tiny sizes. Details includes results, artifacts, grants and usage; Tools shows full sanitized arguments and result text.

The thread follows new output until you scroll up. Press End to follow again. The pinned Subagents widget appears after the first task starts. Closing Subagent Hub does not stop the work.

These illustrations use native renderer output with synthetic data modeled on the [offline fleet demo](examples/controlled-fleet.ts); they are not terminal screenshots.

![Terminal illustration of the pinned Subagents widget showing four tasks: two running, one queued and one cancelled, with a live activity preview.](docs/images/subagent-widget.svg)

_Pinned Subagents widget: task counts and recent activity stay visible above the editor._

| Key                   | Action                                            |
| --------------------- | ------------------------------------------------- |
| ↑ / ↓                 | Select a subagent or historical generation        |
| j / k                 | Scroll down / up one line                         |
| Ctrl+u/d or PgUp/PgDn | Scroll a page                                     |
| Home / End            | Top / latest output                               |
| Tab                   | Switch between thread, details and tools          |
| /                     | Filter the subagent list                          |
| s / m                 | Steer / send an inbox message                     |
| x, then y             | Stop the selected subtree; Enter does not confirm |
| w / p                 | Wait briefly for an outcome / park an idle task   |
| Esc                   | Cancel input or close the Hub                     |

Mouse-wheel scrolling works in fullscreen mode. In regular mode, use the keyboard controls because the terminal owns mouse scrollback. Actions stay pinned to the original task and generation; controls refuse to submit if the window cannot show the full target.

## Messages and follow-up work

Use `delegate_coordinate` to message a running subagent, wait for an outcome or assign follow-up work. Include it in any explicit tool allowlist alongside `delegate_task`.

```json
{"action":"message","target":{"id":"<task-id>","generation":1},"text":"Check the shutdown path too","mode":"steer"}
{"action":"wait","target":{"id":"<task-id>","generation":1},"timeoutMs":30000}
{"action":"followup","target":{"id":"<task-id>","generation":1},"assignment":"Now review the cancellation path"}
```

Each line is a separate call. An accepted or queued message is not a delivery confirmation; even a delivered receipt does not prove the model understood it. Follow-ups start a new generation without replaying the old conversation, so include the context it needs. Follow-up and revival are model-tool operations, unavailable directly in Subagent Hub. Child messaging is off until explicitly granted. See the [coordination reference](docs/delegation-contract.md#live-parent-messaging-waits-and-presence).

### Task files and structured results

Use `taskFile` instead of `assignment` to read instructions from a workspace-relative text file. Add `resultSchema` when you need a validated JSON value:

```json
{
  "taskFile": "tasks/review.txt",
  "profile": "review",
  "resultSchema": {
    "type": "object",
    "properties": { "summary": { "type": "string" } },
    "required": ["summary"],
    "additionalProperties": false
  }
}
```

Task files must be regular UTF-8 files of 1 to 50000 bytes, outside hidden paths and `node_modules`. Reads use the parent's permission hooks. Schema-required children call `submit_result({value:...})`; missing or invalid results fail visibly. See [supported schemas](docs/delegation-contract.md#required-structured-results) and [task-file checks](docs/delegation-contract.md#checked-task-file-input).

## Configuration

No configuration is needed for the bundled roles. To change prompts or narrow tools, use `~/.pi/agent/delegation.json`:

```json
{
  "review": {
    "tools": ["read", "grep"],
    "skills": ["/absolute/operator-reviewed/review/SKILL.md"],
    "prompt": "Review this assignment and report concrete findings with source locations."
  }
}
```

All bundled profiles may delegate to `scout` and `review` by default, within a total depth of two (root 0, child 1, grandchild 2). Other nested targets and child messaging need explicit operator grants. Set `spawn: []` to revoke nesting. General inherits available parent skills; other roles need explicit skill grants. Trusted project configuration in `.pi/delegation.json` can narrow grants, never expand them. Children do not load ambient extension/MCP runtimes or context files; general can forward only the reviewed leaf tools described above.

Each task defaults to a 30-minute deadline (1800000ms), 100 model requests and 100 tool calls. The deadline pauses the active subtree after actual tool/provider drain, releasing capacity and writer leases while retaining each idle SDK session and its full conversation. Use `subagent` resume or root-only `delegate_coordinate` `{action:"resume",target:{id,generation},assignment:"Continue…"}` to append a continuation to the same identity and conversation. Resume resets only the deadline window, not cumulative request/tool/spawn counters. Resume the parent first, then explicitly selected children; descendants never resume automatically. Stop, shutdown and hard request/tool limits still cancel and dispose. Unresponsive code must drain before either pause or cancellation can release resources. See [limits and nesting](docs/delegation-contract.md#capacity-and-bounded-execution), [Subagent Profiles](docs/delegation-contract.md#subagent-profiles-and-explicit-spawn-grants), and [exact model selection and prewalk](docs/advanced-policies.md).

## Shared checkout and lifetime

Subagents use your checkout by default, or an existing directory selected by `cwd`. File paths and shell commands are explicitly adapted through the original parent permission hooks; hooks still run in the parent context and may deny the selected paths. Writing tasks serialize through one global model-tool writer lease, even across worktrees. It does not coordinate manually entered `!`/`!!` commands, external editors, other terminals, other Pi sessions or arbitrary extension JavaScript. Avoid conflicting edits while a subagent is writing. A supplied worktree is not an OS sandbox; there is no automatic copy/apply or cleanup.

Work belongs to the live parent runtime. Shutdown or reload aborts and drains children; there is no restart recovery or cross-parent revival. Saved transcripts and results can contain sensitive task, tool and model output. Treat them like your main Pi transcripts.

### Why worktrees are managed externally

The separation is intentional: the extension owns subagent execution, coordination and UI; an external coordinator or worktree tool owns worktree creation, branch and base selection, integration and cleanup.

Worktrees are supported and useful for subagent orchestration. Create a worktree externally or select an existing workspace, then pass its path as `cwd` for the assigned subagent, as in the [native orchestration example](#native-orchestration). Separate worktrees do not bypass the global model-tool writer lease or provide an OS sandbox. The extension does not automatically commit, apply changes or clean up worktrees.

### Why workflows and scheduling stay external

This package is a focused delegation method, not a general-purpose automation framework. It provides explicit assignments and grants, bounded execution, coordination, and inspectable results in Subagent Hub. Ordered batches and live coordination are supported orchestration features, distinct from workflow scripts and scheduled runs.

Workflow scripting and scheduling can live in separate packages that compose the public delegation tools and own when and how to delegate within the live parent runtime. They need not be built into this subagent integration. This separation implies neither a new built-in integration nor automatic inheritance of workflows, tools or context, and does not promise compatibility with existing third-party packages.

## Documentation

- [Delegation contract](docs/delegation-contract.md): tools, permissions, lifecycle and storage.
- [Advanced policies](docs/advanced-policies.md): models, prewalk and unsupported capabilities.
- [Verification](docs/verification.md): checks, terminal evidence and known limits.
- [Parity inventory](docs/parity-inventory.md), [provenance](docs/provenance.md), [third-party notices](THIRD_PARTY_NOTICES.md).

## Local development

From a source checkout:

```sh
npm ci --ignore-scripts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run exercise
npm pack --dry-run
npm run test:package
```

`npm run check` runs lint, formatting, typecheck, tests and the controlled SDK exercise.
`npm run test:package` packs and installs the tarball in a temporary directory, then checks
that Pi loads the production entrypoint and registers its tools. It needs registry access
for runtime dependencies, does not use model credentials and leaves your Pi settings unchanged.

Oxlint checks correctness rules; warnings fail the lint command. Control-character regexes are allowed in terminal rendering code and tests because they match ANSI escape sequences. Run `npm run lint:fix` for safe lint fixes and `npm run format` to apply Oxfmt formatting. Formatting skips the generated lockfile and the managed Pullfrog workflow.

Load the production entrypoint with `pi -e /absolute/path/to/src/pi-extended-subagents.ts`. Tests and examples use controlled providers without credentials or live inference.

### Offline CLI walkthrough

Run this from the checkout in a disposable workspace. The controlled example deliberately starts a long background child; normal print-parent exit aborts it.

```sh
repo="$PWD"
root="$(mktemp -d)"
node_bin="$(command -v node)"
mkdir -p "$root/home" "$root/workspace"
(
  cd "$root/workspace"
  env -i PATH="$PATH" HOME="$root/home" PI_CODING_AGENT_DIR="$root/agent" PI_OFFLINE=1 \
    "$node_bin" "$repo/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" \
    --offline --no-extensions --no-mcp --no-skills --no-prompt-templates \
    --no-themes --no-context-files --tools read,grep,find,ls,delegate_task \
    --session-dir "$root/sessions" -e "$repo/src/pi-extended-subagents.ts" \
    -e "$repo/examples/controlled-parent.ts" -p 'delegate example' </dev/null
)
# Inspect only these new files before removing the temporary walkthrough root:
find "$root/sessions/delegation" -name '*.jsonl'
rm -rf -- "$root"
```

The child's JSONL records `stopReason:aborted`. Do not install the controlled example as a production provider. This checks the SDK lifecycle, not live-provider reliability.

For the UI exercise, create `input.txt` in a disposable cwd. Run the local CLI with `--offline --no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files`, `-e /absolute/path/src/pi-extended-subagents.ts -e /absolute/path/examples/controlled-fleet.ts`, and tools `read,grep,find,ls,write,edit,bash,delegate_task,delegate_coordinate`. Enter `fleet example`, then `/subagent-hub`. `/fleet-theme dark` and `/fleet-theme light` switch themes. `fleet coordinate <JSON>` calls the coordination tool. The example writes `fleet-output.txt`; it is not loaded by the package manifest.

### Saved output

New files live under the parent session directory:

```text
delegation/<parent-session-id>/<task-id>/
  agent/                     # scoped child runtime cache location, no copied credentials
  transcripts/<new-id>.jsonl # actual SDK messages/tool results
  result.txt                 # complete last-assistant text after drain (when referenced)
  structured.json            # accepted JSON value, if supplied (when referenced)
```

Completed generations keep their own immutable files. New generations use `<task-id>-g<generation>/`. Old `extended-subagents-proof` data is left untouched and is not loaded or migrated. SDK hosts must emit the public shutdown lifecycle before disposal; bare `session.dispose()` does not perform that cleanup.
