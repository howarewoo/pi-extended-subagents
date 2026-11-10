# pi-extended-subagents

Pi-native single-assignment delegation for **Pi 1.5.2**. A model-callable `delegate_task` creates an actual SDK child using the parent's selected model and public provider/authentication API. OMP is a behavioral/UI reference, **not a port**. This working slice is not full OMP parity or a pi-subagents compatibility layer.

- [Delegation contract](docs/delegation-contract.md): profiles, configuration, registry/events/control interfaces, authority and limitations.
- [Verification and historical proof evidence](docs/verification.md).
- [Pinned parity inventory](docs/parity-inventory.md), [provenance](docs/provenance.md), [third-party notices](THIRD_PARTY_NOTICES.md).

## Use delegation

Use Node **22.19+** and Pi **1.5.2**. From this checkout:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run exercise
npm pack --dry-run
```

Load only the production extension with `pi -e /absolute/path/to/src/extension.ts`. Select a physical model using Pi's normal `/login` and `/model` setup. **Production delegation uses that provider and may incur charges.** It does not switch to a cheaper/different model or use scripted responses. Missing authentication, unsupported virtual routing, missing parent tools or forbidden resource grants fail visibly. Keep the required parent built-in tools active; custom overrides are deliberately unsupported rather than bypassed.

Ask the parent model, for example:

> Use delegate_task with profile scout to locate the startup lifecycle code and report source locations. Run it in the foreground.

The native tool input is:

```json
{"assignment":"Locate startup lifecycle code and report source locations","profile":"scout","background":false}
```

One call accepts one assignment. `general`, `scout` and `review` grant only `read`, `grep`, `find`, `ls`. `implementation` additionally grants `write`, `edit`, `bash` and reserves the exclusive **model-tool-mediated** shared-checkout writer. `/task-profiles` lists bundled definitions. The checkout is shared by default; there is **no filesystem isolation or OS sandbox**. Read-only profiles cannot run unrestricted shell. Tool calls run through the parent's public dispatcher, retaining validation and permission hooks.

Foreground returns final state/text once. With `background:true`, the tool returns identity/status (and stores a snapshot in tool details) and delivers one final custom message to the parent when the child finishes. It does not create a detached process or survive parent reload. Use the returned identity for controls:

```text
/task-profiles
/task-status
/task-status <id> <generation>
/task-steer <id> <generation> <text>
/task-stop <id> <generation>
/task-hub
```

Steering queues after the current assistant/tool turn. Stop aborts and drains work, preserving its transcript. Native task call/result cards show the actual identity, profile, selected model, lifecycle and preview, with a full transcript reference. The persistent **FLEET** widget counts all tasks in this parent runtime, including settled/failed/cancelled tasks, with a bounded active-assignment preview and actual writer-lease warning. At narrow widths its counts use `run` (running), `done` (settled), `fail` (failed) and `cancel` (cancelled).

### Observe and control the fleet

`/task-hub` is TUI-only. The roster groups the current children under their real parent session; nesting is not implemented. Selection remains on the same identity as other tasks stream or finish. It provides:

- **Inspector:** identity/generation, profile, physical model/effort, elapsed admission-to-disposal time, resource lifetime, direct requests/tokens/cost/context, assignment, activity, result/error and transcript path. Unknown metrics explicitly say `unavailable`; SDK-reported zero remains zero. No subtree totals or provider-internal request/billing accuracy is claimed.
- **Transcript:** full SDK user/assistant/thinking/tool text, not only the latest 4KB progress tail. **Tools:** actual call IDs, arguments, result text/errors and live tool updates observed while the Hub is open. Binary images and opaque signatures/tool metadata are not rendered; the retained JSONL is the full-data reference. Views are read-only and sanitize terminal control/bidi sequences.
- **Controls:** arrows select an agent; **Tab** cycles Inspector → Transcript → Tools; **PageUp/PageDown** scroll the selected view, **Home/End** jump. **/** opens a roster text/status/profile filter (Enter applies; empty clears). **s** opens selected-child steering, Enter sends. **x** opens stop confirmation; only **y** stops and drains. Escape cancels an input/confirmation without acting.

Configured Enter/Escape keys close in browsing mode. Viewing, selecting, filtering and closing never launch/restart/cancel work or prompt the parent model. The editor regains focus after closing. Closing/reloading removes view subscriptions independently of coordinator lifetime. The panel remains opaque, neutral and theme-adaptive, including deliberately tinted themes. In very small terminals content/hints are clipped rather than expanding without bound.

### Shared-writer scope: model tools only

The coordinator enforces one child writer against parent model-tool `bash`/`edit`/`write` and unknown tools, including in-flight parent mutations. Another writer or a conflicting parent model tool fails visibly. Read-only children may coexist. The implementation widget/overlay warns while a writer is active.

**Manually entered `!`/`!!` commands are outside the writer guarantee**, like external terminals, editors and unrelated Pi sessions. Do not perform conflicting manual/external writes while a child writer is active. This operator responsibility is explicit: Pi 1.5.2 has no public interactive-shell completion notification, and wrapping operations would skip other permission hooks. The extension does not intercept, wrap, disable or reorder manual shell commands, and observing one does not disable later writers. It makes no global lock or OS sandbox claim. Arbitrary extension JavaScript is also outside tool-mediated coordination.

## Explicit profiles and resources

Built-in definitions have extension-owned role prompts. No ambient pi-subagents agents, extensions, MCP servers, context files, skills, prompts, themes, settings or credentials are loaded into children.

Optional operator configuration lives at `<Pi agent dir>/delegation.json` (normally `~/.pi/agent/delegation.json`), keyed by bundled profile name. It can specialize descriptions/prompts, narrow the bundled tool grants, and grant exact absolute skill Markdown files:

```json
{
  "review": {
    "tools": ["read", "grep"],
    "skills": ["/absolute/operator-reviewed/review/SKILL.md"],
    "prompt": "Review this assignment and report concrete findings with source locations."
  }
}
```

Skills use Pi's standard loader, without default discovery. A trusted project's `.pi/delegation.json` uses the same format but can **only narrow** the operator-resolved tools/skills; it cannot add grants. Untrusted project configuration is ignored. `extensions`, `mcp`, model overrides and other unsupported fields are rejected, not silently promised. See the [full contract](docs/delegation-contract.md).

## Safe controlled walkthrough (no credentials/live provider)

`npm test` and `npm run exercise` use the real Pi SDK, tools and storage with controlled model outputs. A controlled provider is present **only in test/example fixtures**, never the production extension.

For an isolated CLI walkthrough, from this checkout:

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
    --session-dir "$root/sessions" -e "$repo/src/extension.ts" \
    -e "$repo/examples/controlled-parent.ts" -p 'delegate example' </dev/null
)
# Inspect only these new files before removing the temporary walkthrough root:
find "$root/sessions/delegation" -name '*.jsonl'
rm -rf -- "$root"
```

This prints a background identity; normal print-parent exit aborts the deliberately long child. Its JSONL records `stopReason:aborted`. It does not establish live provider reliability or interactive UI acceptance. Do not install the controlled example as a normal production provider.

## Storage, lifetime and scope

New transcripts are stored under the parent session directory:

```text
delegation/<parent-session-id>/<task-id>/
  agent/                     # scoped child runtime cache location, no copied credentials
  transcripts/<new-id>.jsonl # actual SDK messages/tool results
```

Old `extended-subagents-proof` data is left untouched and is not loaded or migrated. New artifacts may contain sensitive assignment, tool and model output; treat them like parent transcripts. There is no retention, recovery, cross-parent revival or generalized artifact service. Parent shutdown/reload aborts, drains and disposes all children. SDK hosts must bind extensions and emit shutdown through the public lifecycle; bare `session.dispose()` is not a substitute for host shutdown dispatch. Abrupt process death cannot run cleanup hooks.

Not implemented: batch queue/scheduling, nested tasks/depth scheduling, structured yield, peer messaging/wait, parking/revival, isolation/apply, advisor/prewalk/probes/speculation/workpool, executable extension/MCP grants. No live provider inference, credential changes, global Pi installation/config changes or retained-data migration were performed during verification.
