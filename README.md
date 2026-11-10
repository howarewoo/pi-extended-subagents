# pi-extended-subagents

Pi-native subagent contract investigation and minimal adapter proof. **OMP is a behavioral and UI reference, not a port.** This package is not a consumer-ready replacement for pi-subagents and does not implement full parity.

- [Parity inventory](docs/parity-inventory.md): pinned OMP revision, behavior/acceptance matrix, complete task source/test ledger, public Pi mappings, blockers and recommended next groups.
- [Verification evidence and limits](docs/verification.md).
- [Code/reference provenance](docs/provenance.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## What you can try

Start **one controlled child per parent extension runtime**, observe its status and latest activity in a persistent widget above Pi's editor, queue steering, cancel, inspect the captured final text, and open a minimal framed Hub overlay. The child uses Pi's built-in **faux provider**, which returns scripted text, not model reasoning. It makes no paid model/provider calls. It does not inherit the parent's model or credentials.

The child has **no tools, MCP connections, extensions, recursive delegation, skills, prompt templates, themes, or ambient context files**. Its cwd, in-memory settings/credentials, model-cache location and persistent transcript directory are explicitly selected. This prevents accidental pi-subagents or recursive extension loading; it is **not an OS/process sandbox**. Extension code itself runs with Pi's permissions and can access the process environment.

## Prerequisites and local setup

Use Node **22.19+** (native TypeScript stripping; tested with Node 24) and **Pi 1.5.2**. Only 1.5.2 is verified; the broad peer ranges follow Pi package conventions, not a claim of compatibility with other releases. No credentials are needed for the proof commands.

From a clone of this repository:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run exercise
```

Host-provided Pi packages are peers, with exact 1.5.2 dev dependencies for reproducible checkout verification. No global installation/configuration change is needed. The SDK exercise uses only temporary directories and removes its own files when done.

### Try the observer in an isolated interactive Pi

The following creates an empty temporary HOME/cwd/agent/session area and clears inherited provider credentials. It loads only this extension from this checkout. Keep the temporary path until the session ends; the cleanup deletes only this newly created proof area.

```sh
repo="$PWD"
proof_root="$(mktemp -d)"
node_bin="$(command -v node)"
mkdir -p "$proof_root/home" "$proof_root/workspace"
(
  cd "$proof_root/workspace"
  env -i PATH="$PATH" HOME="$proof_root/home" TERM="${TERM:-xterm-256color}" \
    PI_CODING_AGENT_DIR="$proof_root/agent" PI_OFFLINE=1 \
    "$node_bin" "$repo/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" \
    --offline --no-extensions --no-mcp --no-skills --no-prompt-templates \
    --no-themes --no-context-files --no-tools \
    --session-dir "$proof_root/sessions" -e "$repo/src/extension.ts"
)
# After Pi exits and you no longer need these proof transcripts:
rm -rf -- "$proof_root"
```

Inside Pi, use these slash commands (do not enter a normal model prompt):

```text
/proof-start inspect this controlled assignment
/proof-hub
```

The **Subagent proof** widget is visible above the editor even before a child starts. It keeps the running and final child status discoverable after the Hub closes. The Hub uses the same snapshot, with a themed border/title, padded solid background and close hint drawn from Pi's configured keys. **Enter or Escape closes only the view** and returns control to Pi's editor; it does not stop the child. While it is still running, try:

```text
/proof-steer report this queued instruction next
/proof-hub
/proof-cancel
/proof-result
```

Steering is queued after the current assistant turn; it is not an immediate interrupt. A short child may finish before you steer; “No running proof child” is expected then. For a fresh proof, create a new parent runtime/session. `/proof-result` appends the snapshot to the parent transcript without requesting a model turn. `/proof-hub` is TUI-only, explicitly guarded in RPC/print/JSON modes.

This path was exercised through **real interactive Pi PTY output**: persistent widget, running/completed/cancelled state, Hub frame/background, Escape/Enter return to editor, queued steering, cancellation/result, resize from 100×30 to 40×16, and live dark-to-light theme selection. Captured ANSI/text was inspected; this is not a screenshot or a claim of human visual/display-level contrast or glyph-quality testing. See [verification](docs/verification.md#interactive-terminal-repair-evidence).

### Optional installation into your Pi

This is a standalone Pi package with a `pi.extensions` manifest. If you choose to install the local checkout, `pi install /path/to/pi-extended-subagents` changes your Pi package configuration. That is optional and was **not performed** during verification. Loading with `-e ./src/extension.ts` is sufficient for local use. No pi-subagents dependency/API compatibility or old-run migration is provided.

## Storage and lifetime

The proof stores new data under the parent session directory:

```text
extended-subagents-proof/<parent-session-id>/
  workspace/                 # deliberately separate empty cwd
  agent/                     # child-scoped model-cache location
  transcripts/<new-id>.jsonl  # real persistent Pi child transcript
```

Each parent runtime owns its child. Pi `session_shutdown` (including reload, replacement and normal CLI exit) detaches and clears the widget, aborts active child work, awaits it and calls `dispose()`. Closing the overlay unsubscribes only its observer; the main-screen widget remains attached until parent shutdown. Finalized text is captured from actual assistant message events; the overlay keeps only the latest 4096 characters and the scripted response echoes at most 240 input characters. Full input/assistant messages are retained in the new transcript. Treat them as potentially sensitive; don't enter secrets. Shutdown preserves these new files; there is no retention/deletion/recovery service. Delete only proof-owned data you no longer need.

Reopening a transcript is demonstrated through real `SessionManager.open()` and a fresh SDK session in tests. This is **not** parking/revival, resource reconstruction or cross-parent continuation. In a custom SDK host, bare `AgentSession.dispose()` does **not** emit extension `session_shutdown`; use Pi's public session runtime lifecycle or explicitly own shutdown dispatch. Abrupt SIGKILL/process crash cannot be cleaned up by an extension hook.

## Verification and known boundaries

`npm test` uses Node's built-in test runner, the real Pi SDK/runtime and public controlled provider. It verifies queued steering, streamed progress, final capture, hostile ambient resource exclusion, disk reopen, cancellation/dispose, startup/shutdown races, actual parent reload cleanup, widget updates/detachment, RPC overlay guard, width/height-safe framed and background-filled rendering, and view/execution separation. `npm run exercise` is a small direct SDK walkthrough, not a separate validation service.

To repeat the observed **noninteractive CLI shutdown** path, use the same isolation command above with these arguments appended:

```text
-p '/proof-start isolated CLI lifecycle proof'
```

Before deleting `proof_root`, inspect the new child JSONL under its `sessions/extended-subagents-proof` directory. The observed run exited 0 and contained `"stopReason":"aborted"`, proving the print parent's normal lifecycle stopped its child rather than waiting for scripted completion. No paid provider was verified. The separate interactive PTY observations are described above.

Not implemented: task tool/batches, selective inheritance, useful coding tools, agent definitions/discovery, recursive workers, messaging/wait, schemas/yield/artifacts, budgets/probes, advisor/prewalk, workpool/speculation, filesystem isolation/apply conflicts, parked recovery, full task/tree/Hub UI, OMP MCP/eval/LSP/native routing or any other OMP host import. The [inventory](docs/parity-inventory.md) distinguishes future mappings from explicit blockers. Do not use this proof as a coding-work delegation or security boundary.
