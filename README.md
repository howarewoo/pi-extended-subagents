# pi-extended-subagents

Delegate work to sub-agents in Pi, follow their progress, and steer or stop them from Agent Hub. Sub-agents use your selected model by default, with their own assignments and explicit tool grants.

## Installation

Requires Node 22.19+; tested against Pi 1.5.2. Other Pi versions are not yet verified.

Until the first npm release is published, install from Git:

```sh
pi install git:github.com/howarewoo/pi-extended-subagents
```

After the first npm release, the recommended install is:

```sh
pi install npm:pi-extended-subagents
```

Use only one source. When switching from Git to npm, remove the Git registration first with
`pi remove git:github.com/howarewoo/pi-extended-subagents`.

Restart Pi and run `/task-profiles` to check the installation. If you already installed a local checkout, remove that registration first with `pi remove /path/to/pi-extended-subagents` to avoid loading it twice.

## Updates and rollback

Let active sub-agents finish before updating, then restart Pi. Shutdown or `/reload` aborts
and drains children; active tasks are not migrated to the new version. There is no extension-owned
auto-updater.

```sh
# Update an unpinned npm installation
pi update npm:pi-extended-subagents

# Or update all installed extension packages
pi update --extensions
```

Plain `pi update` updates Pi itself, not installed extension packages. For a Git installation,
use `pi update git:github.com/howarewoo/pi-extended-subagents`; an unpinned Git source tracks
the repository's default branch, including unreleased commits.

For a reproducible npm installation or rollback, select an exact published version:

```sh
pi install npm:pi-extended-subagents@0.1.0
```

For Git, select a published tag, for example
`pi install git:github.com/howarewoo/pi-extended-subagents@v0.1.0`.
Version `0.1.0` and tag `v0.1.0` must be published before these examples can be used.
Exact npm versions and Git tags stay pinned; updating does not advance them to the next release.
Install a different version explicitly to change the pin.

[CHANGELOG.md](CHANGELOG.md) lists user-facing changes and migrations. Pi shows new package
changelog entries on the next fresh launch after a version increase. See the
[maintainer release guide](docs/releases.md) for publishing and recovery.

## Feature comparison

Compared with two community alternatives using their documentation, checked on 2026-11-11. This is a feature comparison, not a performance or reliability benchmark.

| Capability          | pi-extended-subagents                                                          | [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) | [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) |
| ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Delegation          | Single tasks, ordered batches and opt-in nesting                               | Single tasks, parallel runs, chains and nesting                       | Foreground/background tasks and opt-in nesting                      |
| Agent configuration | Four bundled roles; JSON prompt/resource configuration                         | Bundled and user/project Markdown agents                              | Bundled and custom Markdown types; Claude Code agent files          |
| Tools and resources | Parent builtin grants and explicit skills; no extension/MCP inheritance        | Per-agent tools, extensions and skills                                | Per-agent tools, extensions and skills; MCP selectors               |
| Live UI             | Sub-agents widget and Agent Hub with native Pi rendering and live follow       | FleetView and live transcript inspector                               | Live widget, FleetView and conversation viewer                      |
| Background work     | Ends with the parent runtime; reload aborts and drains children                | Detached runners can outlive the parent process                       | Background by default; session-scoped scheduled jobs                |
| Workflows           | Bounded batches and scoped coordination; no workflow scripts or schedules      | JavaScript workflows, chains, missions and schedules                  | `SubagentWorkflow` with parallel/pipeline composition and schedules |
| Filesystem          | Existing caller-supplied workspaces; global writer lease; no managed worktrees | Managed Git worktrees for writing children                            | Git worktrees with automatic commits                                |
| Results and checks  | Per-task JSON Schema; results finalized after drain                            | Typed gates, structured outputs and acceptance checks                 | Workflow schemas and post-run command gates                         |

Sources: [our contract](docs/delegation-contract.md); nicobailon's [README](https://github.com/nicobailon/pi-subagents/blob/c99503aed6d6b20d2397a1767f7d60730efe3963/README.md), [agents](https://github.com/nicobailon/pi-subagents/blob/c99503aed6d6b20d2397a1767f7d60730efe3963/docs/agents.md) and [workflows](https://github.com/nicobailon/pi-subagents/blob/c99503aed6d6b20d2397a1767f7d60730efe3963/docs/workflows.md); tintinweb's [README](https://github.com/tintinweb/pi-subagents/blob/8df7fa7d8e8130151a8fbfa991a1d3fa6b443739/README.md) and [workflows](https://github.com/tintinweb/pi-subagents/blob/8df7fa7d8e8130151a8fbfa991a1d3fa6b443739/docs/workflows.md).

## Native orchestration

Pi discovers the native `subagent` tool at startup through its tool description and coding-worker guidance; no enable call is needed. For replacement use, load only one extension providing `subagent`: Pi uses the first registration, not an automatic provider preference. Switching providers does not migrate or remove old runs.

```json
{
  "agent": "worker",
  "task": "Implement the approved change; follow the supplied repository guidelines and task references",
  "cwd": "/absolute/path/to/task-worktree"
}
```

`worker` uses the configured `implementation` profile. `scout`, `review` and `general` are also available. Calls are async by default and wake the parent after drain; set `async:false` to wait. Batches use `tasks:[{agent,task,cwd?}]`. Use the returned `id` with `action:"status"`, `"steer"`, `"stop"` or `"resume"`; steer/resume also need `message`.

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

The default is two concurrent tasks, a 32-item queue and up to 16 tasks per batch. Every item passes preflight before any starts. One failed task does not cancel its siblings.

`general`, `scout` and `review` allow up to `read`, `grep`, `find` and `ls`. `implementation` also allows `write`, `edit` and `bash`. Each role receives only the builtins already callable in the parent. With Pi's default tools, scouts get `read` only. Tool calls retain the parent's permission hooks; incompatible tool overrides are rejected.

Foreground calls return the final results. Set `background:true` to return immediately and receive one ordered completion message after the batch drains. Use the returned task ID and generation for controls:

```text
/task-profiles
/task-status
/task-status <id> <generation>
/task-steer <id> <generation> <text>
/task-stop <id> <generation>
/agent-hub
```

## Agent Hub

Agent Hub shows the sub-agent list beside the selected conversation, using Pi's native message and tool rendering. On narrow terminals, the conversation takes the full width. Details includes results, artifacts, grants and usage; Tools shows full sanitized arguments and result text.

The thread follows new output until you scroll up. Press End to follow again. The pinned Sub-agents widget appears after the first task starts. Closing Agent Hub does not stop the work.

| Key                   | Action                                            |
| --------------------- | ------------------------------------------------- |
| ↑ / ↓                 | Select a sub-agent or historical generation       |
| j / k                 | Scroll down / up one line                         |
| Ctrl+u/d or PgUp/PgDn | Scroll a page                                     |
| Home / End            | Top / latest output                               |
| Tab                   | Switch between thread, details and tools          |
| /                     | Filter the sub-agent list                         |
| s / m                 | Steer / send an inbox message                     |
| x, then y             | Stop the selected subtree; Enter does not confirm |
| w / p                 | Wait briefly for an outcome / park an idle task   |
| Esc                   | Cancel input or close the Hub                     |

Mouse-wheel scrolling works in fullscreen mode. In regular mode, use the keyboard controls because the terminal owns mouse scrollback. Actions stay pinned to the original task and generation; controls refuse to submit if the window cannot show the full target.

## Messages and follow-up work

Use `delegate_coordinate` to message a running sub-agent, wait for an outcome or assign follow-up work. Include it in any explicit tool allowlist alongside `delegate_task`.

```json
{"action":"message","target":{"id":"<task-id>","generation":1},"text":"Check the shutdown path too","mode":"steer"}
{"action":"wait","target":{"id":"<task-id>","generation":1},"timeoutMs":30000}
{"action":"followup","target":{"id":"<task-id>","generation":1},"assignment":"Now review the cancellation path"}
```

Each line is a separate call. An accepted or queued message is not a delivery confirmation; even a delivered receipt does not prove the model understood it. Follow-ups start a new generation without replaying the old conversation, so include the context it needs. Follow-up and revival are model-tool operations, unavailable directly in Agent Hub. Child messaging is off until explicitly granted. See the [coordination reference](docs/delegation-contract.md#live-parent-messaging-waits-and-presence).

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

Skills, nested delegation and child messaging need explicit operator grants. Trusted project configuration in `.pi/delegation.json` can narrow those grants, never expand them. Children do not inherit ambient extensions, MCP tools or context files.

Each task defaults to a 10-minute deadline, 100 model requests and 100 tool calls. Cancellation waits for actual tool/provider drain, so a deadline cannot forcibly end unresponsive code. See [limits and nesting](docs/delegation-contract.md#capacity-and-bounded-execution), [profiles](docs/delegation-contract.md#profiles-and-explicit-spawn-grants), and [exact model selection and prewalk](docs/advanced-policies.md).

## Shared checkout and lifetime

Sub-agents use your checkout by default, or an existing directory selected by `cwd`. File paths and shell commands are explicitly adapted through the original parent permission hooks; hooks still run in the parent context and may deny the selected paths. Writing tasks serialize through one global model-tool writer lease, even across worktrees. It does not coordinate manually entered `!`/`!!` commands, external editors, other terminals, other Pi sessions or arbitrary extension JavaScript. Avoid conflicting edits while a sub-agent is writing. A supplied worktree is not an OS sandbox; there is no automatic copy/apply or cleanup.

Work belongs to the live parent runtime. Shutdown or reload aborts and drains children; there is no restart recovery or cross-parent revival. Saved transcripts and results can contain sensitive task, tool and model output. Treat them like your main Pi transcripts.

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

For the UI exercise, create `input.txt` in a disposable cwd. Run the local CLI with `--offline --no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files`, `-e /absolute/path/src/pi-extended-subagents.ts -e /absolute/path/examples/controlled-fleet.ts`, and tools `read,grep,find,ls,write,edit,bash,delegate_task,delegate_coordinate`. Enter `fleet example`, then `/agent-hub`. `/fleet-theme dark` and `/fleet-theme light` switch themes. `fleet coordinate <JSON>` calls the coordination tool. The example writes `fleet-output.txt`; it is not loaded by the package manifest.

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
