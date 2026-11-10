# Delegation verification

## Slice 2 selected-control target correction

Coordinator source/evidence reconciliation identified a control-target race: a roster filter can remove the selected task while steering input or stop confirmation is open, causing ordinary selection fallback to another child. The Hub now captures only the original `{id,generation}` when entering either interaction, displays that target above the inspector/input, validates the pinned identity through the public coordinator snapshot before dispatch, and visibly refuses a no-longer-running or stale target. Submission, cancellation and view disposal clear the pinned interaction target. Ordinary roster fallback remains unchanged and cannot retarget an accepted control.

`test/hub.test.ts` adds separate steering and stop regressions with two matching running tasks: A settles and disappears from a `running` filter, selection falls back to B, but the action checks A #7 and refuses without dispatching to either child. Both regressions also replace A's generation and prove the original generation is validated, never silently upgraded; cancellation clears the target and the next interaction captures its own identity. Existing real coordinator stale-generation tests remain in the full suite.

Refreshed validation: focused Hub tests **7/7**, full native suite **31/31** (~7.6s), typecheck, SDK exercise, package dry run and diff hygiene passed; index remains empty. Corrected source manifest digest: **`25e5b75c56a471a8bc0cc936135ad1d747b85084ef46c325d1d2e432ef342b61`**, using `shasum -a 256 src/*.ts test/*.test.ts examples/*.ts | shasum -a 256`.

The existing one-off isolated PTY invocation was run against the corrected source without modifying or replaying retained captures. It exited **0** and emitted the pinned full UUID/generation, `Stop target? y confirms`, and `Stopped and drained`. Fresh controlled-only evidence is outside the checkout at `/var/folders/66/4pymg4057h1_23h33fx62j8r0000gn/T/fleet-evidence-sr71u2ga/`. Its subsequent fixed-position steering attempt selected a non-running child and correctly displayed `Controls unavailable: select a running task`; it is not claimed as new successful steering or filtered-target-race PTY evidence. The target-change race and both stale-generation cases are covered by deterministic component regressions. Earlier successful steering/navigation/theme/resize evidence below applies to its recorded source and remains useful for unaffected behavior, not proof of this correction. No live inference, new verifier, tool installation or scope expansion was introduced.

Normal coordinator source/evidence reconciliation is the review process here; this correction adds no independent-review gate or reviewer requirement. This section supersedes the earlier 29-test/source-digest record for the affected source. No staging, commits or publication were performed.

## Slice 2 fleet observability evidence

Implemented in the isolated `feat/agent-observability` workspace on base `5211269a9803fd5fcd0ed02fadec82fb790dcce8`, Pi 1.5.2 / Node 24.21.0. This section supersedes the latest-only UI descriptions in historical sections below; those older captures are not Slice 2 acceptance.

### Product and authoritative seams

- Replaced the latest-only widget/overlay with bounded all-entry FLEET counts/active previews and a real parent/child roster, stable selected-agent Inspector, full Transcript and Tools views, roster search, paging, selected steering and confirmed stop. The panel preserves neutral zero-chroma OKLCH background solving and restores it after truncation resets. Narrow layouts retain separate navigation/action/close hints.
- Native Pi `renderCall`/`renderResult` cards use actual invocation args, delivered snapshot details and matching live registry state. Errors before admission retain the real tool error text. Foreground/background delivery and direct usage semantics are unchanged; no child tool-result `usage` is also billed to the parent.
- Coordinator additions are only admission/disposal timestamps, actual writer-lease observation and detached finalized public SDK messages. UI streaming/tool projections exist only while the Hub is open. No timer service, scheduler, new execution registry, event/log persistence, historical migration, grant or routing policy was added. Downstream meanings are in [delegation-contract.md](delegation-contract.md#storage-and-downstream-seams).

### Automated evidence

`npm ci --ignore-scripts` installed the workspace lockfile locally (125 packages; 0 audit vulnerabilities); no dependency/lockfile or global configuration changes. Native Node tests now pass **29/29**, no failed/skipped/cancelled tests (~7.7s). All 25 existing tests remain meaningful; replaced latest-only UI assertions were updated rather than keeping a parallel demo path.

- `test/hub.test.ts`: fleet lifecycle counts/actual lease versus profile, bounded widget/panel geometry, 0–80-column and 1–24-row surfaces, dark/light/tinted background regression, Unicode width/control/bidi sanitization, selected identity/generation, selection stability during new completions, search, tabs, transcript end access beyond 4KB, no navigation-induced control invocation, steer, explicit y-only stop, unsubscribe, card and actual-message projections.
- `test/widget-lifecycle.test.ts`: real loaded extension/SDK streaming, widget repaint, cancellation retention, reload replacement and no stale observer updates; real native dark/light and deliberately pink custom palette styles remain achromatic and opaque.
- `test/observability.test.ts`: actual parent model tool launches two independent readers, one implementation writer and a controlled failure. Real tools/storage/events, 3 settlements/1 failure, lease/timestamps, all four native result identities, full 600-line assistant/tool transcripts, explicit no duplicate usage. Uses the same opt-in controlled response factory as the interactive exercise.
- `test/coordinator.test.ts`: detached finalized SDK messages remain available after disposal, cannot mutate authoritative messages, and reject stale generations. Existing permission/resource/writer/lifetime/once-only tests are preserved.

Final commands: `npm test`, `npm run typecheck`, `npm run exercise`, `npm pack --dry-run`, `git diff --check` passed; `git diff --cached --name-only` was empty. Package dry run contains the declared 12 production source/docs/README/notices/manifest files, not tests, controlled examples, dependencies or captures. Impeccable mechanical detector (`detect --json src/hub.ts src/extension.ts`) returned `[]`; that web-oriented detector is not terminal contrast acceptance.

Tested source manifest digest: **`6e700d9a51b631ce20109f123af3ce9800dbde00af18d5bee7f18cb605da6f97`**, computed by `shasum -a 256 src/*.ts test/*.test.ts examples/*.ts | shasum -a 256`. Documentation-only verification record updates do not change that source digest.

### Fresh isolated interactive Pi evidence

A one-off Python stdlib PTY invocation used the actual Pi CLI, production extension and opt-in `examples/controlled-fleet.ts` (not in the package manifest), fresh temporary HOME/agent/cwd/session roots, a minimal environment without provider credentials, offline mode and ambient extensions/MCP/skills/themes/context discovery disabled. The controlled writer created only `fleet-output.txt` in that throwaway cwd. All task-owned processes exited and the temporary work/session root was removed. No live/paid inference, credential/config edits, installed-checkout edits or external captures of real work occurred.

Observed on the final UI source:

- 100×30 dark: FLEET 4; native call/result identity/model/transcript cards; real roster with concurrent readers/writer and failed child; Inspector direct metrics/activity; Transcript paging; Tools arguments and actual read payload.
- Selected **x → y** emitted `Stopping and draining…` then `Stopped and drained`; selected **s → text → Enter** emitted `Steering queued`. Selection and ordinary navigation did not require a model prompt. These controls used the existing public coordinator methods, not synthetic UI state.
- Escape returned focus to the editor (subsequent `/fleet-theme light` and `/task-hub` executed). Light panel emitted neutral RGB 229/229/229 versus dark 55/55/55; component tests separately establish zero-chroma behavior for deliberately pink custom themes.
- Resize 100×30 → 40×16 retained frame, selected identity, bounded viewport and separate readable navigation/action/close hint rows. Enter closed and returned editor focus; reopening and applying `Failure` search selected the actual failed child. `/reload` drained/reset runtime and reopened an empty Hub. Final CLI exit **0**.

Sanitized ANSI/cursor-separated row fragments are retained outside the checkout for coordinator review at `/var/folders/66/4pymg4057h1_23h33fx62j8r0000gn/T/fleet-evidence-q64ygxgd/` (`01-dark-hub`, `02-transcript-scroll`, `03-tools`, `04-stop`, `05-steer`, `06-escape-focus`, `07-light`, `08-narrow`, `09-enter-focus`, `10-filter-failed`, `11-reload-empty`, `complete`; `.ansi` and `.rows.txt`). These contain only controlled example text and temporary identifiers. The one-off invocation script is `/tmp/fleet-pty.py`; it is not a new repository verifier framework. Rows are emitted fragments, **not a reconstructed terminal screenshot**.

Bounded diagnosis: an early new fixture keyed only on the last tool result and re-launched its scripted parent scenario after background completion messages; it was corrected to recognize existing delegate results. Transient diagnostic output was removed. A first stop attempt arrived after the selected scenario had moved on; extending the controlled stream made stop/steer observable. One intermediate capture script hit an exit-observation race after the PTY closed; the final run recorded exit 0. No production execution/grant policy changes were made to accommodate these fixture issues.

### Acceptance boundaries and simplification

No human screenshot, visual contrast/glyph judgment, live-provider reliability/billing or cross-terminal comprehensive acceptance is claimed. The roster is root plus direct children only; system prompt internals, binary images, opaque signatures and arbitrary tool metadata are intentionally not displayed. The full SDK JSONL reference is available for those data. Search filters real roster text, not all transcript history. Large transcript rendering currently projects the selected SDK messages on render; there is no long-lived general log cache, and no performance claim for arbitrarily large histories. Elapsed values refresh on actual render/events rather than a timer.

One scoped necessity/simplification pass removed the replaced latest-entry path, unnecessary disk fallback in the live message accessor and redundant UI state; retained one registry and bounded ephemeral in-flight projections. All changed paths implement the admitted observer slice or its native tests/docs/example. Normal coordinator source/evidence reconciliation remains; this does not introduce an independent-review gate or require another reviewer. No files were staged/committed/pushed and write ownership is relinquished in the final handoff.

## Slice 1 current evidence

Source: isolated `feat/delegation-core` worktree based on `0cf7bf92a4a9ae952ac023070cb0d45ed089a261`, Pi **1.5.2**, Node **24.21.0**. Production fake-provider execution is removed. The current interface is [delegation-contract.md](delegation-contract.md); historical proof commands below describe only the base implementation.

### Acceptance disposition

The production extension now delegates read-only and implementation tasks through real SDK children. Explicit profiles/resources, the selected-parent public provider/auth adapter, registry/events/control, actual tools/storage and parent-lifetime cleanup are implemented. **Writer coordination covers parent/child model-invoked tools only.** The user explicitly classified manual !/!! commands like external terminals, outside the guarantee; the operator must not perform conflicting manual/external writes while children write. No shell interception, hook bypass, global ban, fallback heuristic or private runtime access was added. Production writer admission and model-tool conflicts are exercised with controlled provider outputs. Live-provider and fresh interactive UI acceptance remain unverified; this is not full replacement/parity acceptance.

No real-model inference, paid/live provider calls, credential changes, global config/package changes or old-data migration were authorized or performed. All actual inference dispatch uses controlled Pi providers in test/example fixtures. The installed checkout was not edited; dependencies were installed from this worktree's lockfile with `npm ci --ignore-scripts` (125 packages, audit 0 vulnerabilities), without symlinks or new dependencies.

### Current tests and walkthrough

- `test/coordinator.test.ts`: actual SDK selected-provider streaming and queued second request; prompt-settled final text; new JSONL reopen into a fresh SDK session; hostile project extension/context exclusion; complete loader resource boundary; idempotent shutdown/dispose; acknowledged pre-delta abort; setup/shutdown race; view close/width/observer separation; real model-issued foreground/background task result exactly once; parent reload drains work; RPC overlay guard; real parent-dispatched read/grep/write/edit on a temporary Git repository (production implementation-profile task; controlled model outputs).
- `test/profiles.test.ts`: explicit bundled profile grants, operator/project subset precedence and trust, valid selected skills, missing/forbidden resources, model/provider/auth/scope preflight denial.
- `test/model-adapter.test.ts`: selected parent provider actually receives the exact model and in-memory key/headers for parent and child; direct child dispatch count excludes parent; transcripts/child agent directory contain no copied auth artifacts; explicit skill metadata enters actual child prompt; forbidden executable extension grants reject before setup.
- `test/writer-lease.test.ts`: production task tool admits implementation children; one child writer, concurrent readers, actual parent write/bash blocked with no files created, sibling preflight parent bash prevents writer launch, delegated writes respect parent permission hooks. Manual shell hooks remain untouched and do not disable writers, including after reload.
- `test/failures.test.ts`: provider failure is terminal once; parent abort drains foreground child; read-only child cannot write or self-spawn; missing parent tools and unsupported schema fields fail before child setup.
- `test/startup-abort.test.ts`: stale generation controls reject; stop before first delta persists an actual abort, never success.
- `test/hub.test.ts` and `test/widget-lifecycle.test.ts`: original neutral full-row surface, tiny/narrow geometry, sanitization, key hints, dark/light/tinted theme behavior, widget live updates/final cancellation, reload replacement and stale observer detachment retained against real registry state. No duplicate production UI runtime.
- `test/cli.test.ts`: actual isolated Pi CLI with offline example parent provider and minimal fresh environment loads production extension, model-calls task tool, exits 0 and persists a child abort rather than scripted completion. No credentials or ambient resource discovery.
- `npm run exercise`: actual isolated SDK parent → model tool → child, public selected-provider adapter, streamed state, background identity, steering, reload abort/drain, transcript inspection; temporary roots removed. SDK model is supplied explicitly from the controlled runtime (no ambient/fallback selection).

The initial command-registration probe found that registering a tool during `session_start` did not satisfy an explicit SDK allowlist. The tool now registers during the extension factory using Pi's native conflict handling, and callers select its native name. An SDK-only reload fixture initially omitted any host UI/error/shutdown binding, so Pi did not emit replacement `session_start`; fixture now supplies a real host error binding and uses the supported lifecycle. A controlled shared provider queue test now waits for actual child streaming before replacing parent scripted responses; no production delay was added. Original startup-abort protection remains intact.

### Limits

- Manual !/!! shells, external terminals/editors/unrelated sessions are intentionally uncoordinated under the explicit approved scope. Tests do not establish external-process exclusion or an OS sandbox. Operators must not conflict with active child writers.
- External provider behavior, OAuth refresh against real services, provider cancellation/reliability/billing, deferred provider jobs and provider-internal request counting are not verified. `requests` is direct parent-registry dispatch; tokens/cost/context are the SDK's values, with null for unknown. Parent footer is not an aggregate child-cost UI. Virtual-model routing is explicitly rejected, not silently replaced.
- No fresh interactive PTY/screenshots/human display-level acceptance for the Slice 1 text/state update; original neutral-surface component/regression protections remain. Historical Slice 0 PTY evidence below is not new Slice 1 acceptance.
- Public auth preflight can await operator-configured auth resolution; no bounded setup/auth timeout is claimed. Shutdown drains setup before disposal; no detached work/recovery framework is introduced.
- No independent reviewer/subagent was launched. Coordinator review/reconciliation remains required; no publication/commit/staging authority was exercised by this worker.

### Final local checks

Observed on the integrated Slice 1 source: `npm run typecheck` passes; `npm test` passes **25/25** (0 failed/skipped/cancelled; approximately 5.4 seconds); `npm run exercise` prints PASS; `npm pack --dry-run` includes only the 12 declared source/docs/README/notices/manifest files, no dependencies/tests/host state; `git diff --check` passes and `git diff --cached --name-only` is empty. `node_modules` is a real worktree-local directory, not a symlink. No files were staged or committed. The final acceptance report names the tested source digest and any later refreshed check output. Historical results below do not substitute for these checks.

Scoped simplification pass: removed the proof runtime rather than preserving aliases/parallel executors, unused writer/shell hazard scaffolding and duplicate state; kept one registry and native loaders/dispatcher/test runner. Captured model/cwd/effort once at admission to avoid mutable parent selection during setup. Shared bounded preview formatting now preserves transcript references and explicitly reports truncation. No scheduler, persistence framework, verifier service, dependency or global installation was added.

---

# Historical Group 1 verification evidence

This record applies to this repository's parity-inventory/adapter-proof implementation and **Pi 1.5.2**. It does not establish full OMP parity, pi-subagents replacement readiness, external-provider behavior, or comprehensive interactive UI quality.

## Observed environment and inputs

- Node 24.21.0; package minimum Node 22.19.0.
- npm registry resolved `@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui` **1.5.2**; exact development versions and package integrity are recorded in `package-lock.json`.
- TypeScript 7.0.2 and Node types 24.19.2 resolved from npm. Host Pi 1.5.2 docs/examples were read before implementation; installed package public declarations and runtime behavior were checked against the independently installed dependencies.
- OMP behavioral reference: `eda28eff97cf7a352fd3057a03581be1686dbc7a`. GitHub recursive tree/raw fetches only; no checkout/import/port of OMP and no upstream test execution.
- During the worker implementation and verification phase, no symlinked dependencies, global Pi config/package installation changes, paid provider/model calls, credential changes, external provisioning, commits, pushes or publication were performed. Authorized commit and draft publication operations belong to the coordinator.

## Reproducible checks

Run from a repository clone:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run exercise
npm pack --dry-run
git diff --check
git diff --cached --name-only
```

`npm ci --ignore-scripts` installs only within this checkout. The tests/exercise own temporary roots and clean them in `finally`/test cleanup; the child SDK resource boundaries are explicit. The CLI test supplies a fresh, minimal environment (no inherited provider credentials), temporary HOME/agent/cwd/session storage, offline mode and discovery/tool suppression flags. It closes piped stdin before waiting for Pi, because Pi consumes stdin before processing supplied CLI prompts.

## Observed results

| Check | Actual observation | What this does not prove |
| --- | --- | --- |
| Registry install | Local dependencies installed; npm audit reported 0 vulnerabilities at installation | A security audit of this extension or all future dependency releases |
| Strict typecheck | `tsc --noEmit` passes | Compatibility with Pi versions other than 1.5.2 |
| Node tests | **10 tests pass** using real Pi runtime/SDK and its public faux provider | Actual external model/HTTP provider integration or load/performance bounds |
| Direct SDK exercise | PASS: streamed progress, queued steering, final capture, persistent transcript reopen, shutdown/dispose; temporary files removed | Actual model reasoning, paid provider credentials or interactive UI |
| CLI exercise/test | Exit 0; child transcript contains `stopReason=aborted`, not scripted `stop`, on normal print-parent exit | Ctrl+C/SIGTERM in an interactive terminal, crash/SIGKILL recovery |
| Interactive PTY repair | Real Pi widget/Hub output, Escape/Enter focus return evidenced by subsequent commands, resize to 40×16, dark-to-light settings selection, completed/cancelled state retained | Human screenshot inspection, display contrast/glyph measurements or every terminal/theme |
| Package dry run | Only declared source/docs/README/third-party notice/manifest are included; no node_modules, tests, host state or secrets | Publication (none performed during worker verification), or installation into a user's global Pi |
| Diff hygiene | `git diff --check` passes; index remains unstaged | Merge readiness |

### Behavior tests

`test/coordinator.test.ts`:

1. Real SDK streamed deltas, queue acceptance and a second assistant request carrying steering; final text from message events; on-disk JSONL; reopen into a fresh actual `AgentSession`. Hostile project extension and AGENTS context do not execute/leak; the original persisted transcript and reopened session have no tools. Loader returns no extension, skill, prompt or context resources.
2. Abort persists an actual aborted assistant record; instrumented `AgentSession.dispose` invokes the original implementation for exactly that child. Shutdown is idempotent and later starts are rejected.
3. Shutdown racing asynchronous session construction waits and disposes without launching a model run.
4. Live view requests render from real streamed state; truncation fits 0/1/2/8/40/80 columns with wide/emoji/control text; keyboard completion/disposal does not cancel the child or keep observer callbacks attached.
5. Real parent `session.reload()` emits shutdown to the loaded extension and aborts the owned child. Parent commands make zero parent model calls; RPC cannot enter the terminal overlay.

`test/startup-abort.test.ts`:

6. Acknowledged startup is abortable even before the first text delta. The transcript contains `aborted` and no successful scripted completion.

`test/cli.test.ts`:

7. The real published Pi CLI loads this extension under an isolated HOME/cwd/config/environment and normal print-parent exit stops the child. This protects the complete extension registration/lifecycle/SDK path, not just a coordinator called directly in a test.

`test/hub.test.ts` adds two presentation regressions: full-row neutral opaque background/frame/padding, widths 0–80 and heights 1–24, configured-key hints and theme invalidation; and widget state coverage, control sanitization, latest-activity truncation and final result retention.

`test/widget-lifecycle.test.ts` adds a real-parent extension regression: the empty widget is registered, real child deltas request renders, cancellation remains visible, reload clears the widget before replacing it, and the old subscription no longer requests renders. It also renders Hub rows through Pi's real theme styling for native dark/light and a deliberately pink custom panel color, asserting explicit equal-channel backgrounds, full width, background restoration after truncation resets at widths 1/4/8/40, and lighter output for the light theme. Its UI callback is instrumented; actual terminal rendering is covered separately below.

The controlled provider scripts assistant text, but **session construction, provider dispatch, event delivery, message queues, transcript writes/reopening, extension loading, reload/exit dispatch, abort signals and dispose are Pi's real implementations**. Tests use no replacement AgentSession implementation or mocked storage. Disposal instrumentation wraps and calls the real method.

## Failures that changed the proof

- The first typecheck found that Pi's base `Component` type omits optional disposal. The Hub return type now states `Component & { dispose(): void }`, retaining observer cleanup rather than casting it away.
- An initial immediate-shutdown exercise produced a successful child transcript after cancellation: `prompt()` input preparation can precede abort-signal ownership. Startup now waits for actual `agent_start` (or early prompt settlement) before acknowledging the child. A regression test and isolated CLI exit test protect this boundary. A snapshot flag alone would not have caught it.
- The initial automated CLI fixture timed out because its stdin pipe remained open; Pi was waiting for stdin, not executing the proof command. The fixture now explicitly sends EOF. The final integrated suite passes. This was a fixture correction, not a fallback to mocks or a waived CLI criterion.

## Unavailable / still unmet

- **Display-level/UI limits:** interactive PTY rendering, keyboard focus return, representative resize and live theme change were exercised for the repair below. No screenshots, human graphical visual inspection, display contrast/glyph measurement, regular-mode terminal run or exhaustive theme/terminal compatibility checks were performed. ANSI/text output is not a reconstructed full-screen screenshot.
- **Real external provider/model behavior:** deliberately not exercised; no credentials or paid calls. The fixture cannot establish tool-using model reliability, billing accuracy, provider cancellation/network behavior or production routing.
- **Full parity/consumer readiness:** not the assignment. Inventory rows marked unproved, blocked or adjacent remain so. In particular selective inheritance, useful tools, nested delegation, result schemas, filesystem apply/conflicts, worker execution, advisor/probes and within-parent park/revive need separate implementation and acceptance.
- **Review evidence:** independent agent review was not performed. Coordinator source/evidence reconciliation is not independent review; this record adds no independent-review acceptance gate.

## Interactive terminal repair evidence

The user reported that the main screen showed no child and the original borderless Hub looked like unstructured text. The bounded repair adds only a session-bound `ctx.ui.setWidget` observer and a framed, fully padded semantic-background Hub. Both read the existing single-child coordinator snapshot; neither owns execution. Child resources/provider/lifetime behavior are unchanged.

A one-off Python standard-library `pty` exercise launched the real Pi 1.5.2 interactive CLI from the checkout. Each invocation used its own temporary HOME/agent/cwd/session directories, a fresh minimal environment without provider credentials, offline mode, all ambient discovery/tools disabled and the explicit proof extension. Only those temporary processes/data were cleaned up. No runner/framework was added to the repository.

Observed actual PTY output and interactions:

- **100 columns × 30 rows, dark theme:** empty widget above the editor; `/proof-start` changed it to running and streamed activity; `/proof-hub` emitted a complete themed title/border, padded body and close hint with the configured `escape/ctrl+c/enter` keys. Every cell inside the frame received the background; chat remained visible only outside the frame's gutters.
- **Escape → editor → steering:** closing the Hub left the widget live. The next `/proof-steer` command was accepted as queued, establishing that keyboard control returned to the editor and the child was not stopped by viewing/closing.
- **Live resize to 40×16:** the open Hub remained framed and width-contained; Enter dismissed it. The widget remained visible within the narrow width, then `/proof-cancel` changed it to cancelled. Returning to 100×30 and `/proof-result` confirmed the same cancelled child snapshot. Final status/activity remained on the main screen.
- **Live dark → light:** `/settings`, search `theme`, Enter, Down to light, Enter, Escape. Actual settings output confirmed `Theme light`. In that earlier tinted implementation, emitted Hub panel background changed from indexed color 59 to 189 through Pi's semantic theme. This did not establish neutrality and is superseded by the Slice 0 surface correction below.
- **Unicode/completion:** a controlled assignment containing Chinese text and a joined emoji streamed to completion; the completed widget remained above the editor and the Hub showed the same final status/text. Enter/Escape returned to the editor without altering execution. Ctrl+D exited both retained scenarios normally.

Evidence consists of redacted `.ansi` captures plus cursor-separated `.rows.txt` output fragments, retained outside the checkout for the coordinator. They are actual terminal emissions, not component-test output, screenshots or a terminal-emulator screen reconstruction. The initial theme exercise typed `light` into a non-searchable submenu and did not change it; the retained successful theme evidence uses the supported Down/Enter path described above. Pi's no-model startup warning is expected because the parent has no credentials; proof slash commands still use only the child's controlled provider.

To reproduce, use the README's isolated interactive invocation, optionally adding `--use-theme dark`, at 100×30; follow the commands above, resize to 40×16, and use the ordinary settings theme picker. Do not send normal parent model prompts. Tiny component-only geometries are additionally covered by tests: when there is no room for a frame, one bounded status row is rendered and configured close keys remain active.

### Slice 0: neutral panel surface

The user rejected the pink Hub surface. `customMessageBg` is a tinted message role, not a neutral panel guarantee. The correction uses public Pi TUI color conversion to keep that active theme color's OKLCH lightness and set chroma to zero. `theme.style` applies the resulting concrete background to every fully padded row, including borders and tiny status-only layouts. This preserves dark/light adaptation without adopting another possibly tinted semantic token or hard-coding a palette. A custom theme's hue cannot tint the derived surface. Semantic foreground/status colors, widget behavior, configured close keys and execution ownership are unchanged. Pi's truncation helper inserts full-style resets; the paint boundary styles each reset-separated segment so narrow text cannot clear the surface. The focused regression first failed on the unpainted ellipsis at width 1, then passed after this correction.

Fresh isolated interactive Pi 1.5.2 PTY runs selected native `dark` and `light` separately with `--use-theme`; truecolor capability was explicit. Actual Hub output used **RGB 55/55/55** in dark and **229/229/229** in light. Both runs showed the normal 100×30 frame, resized to 40×16, dismissed with Enter, cancelled the still-running child, reopened its cancelled Hub, dismissed with Escape and accepted `/proof-result` back in the editor. The final widget retained cancellation. Each host exited 0 after Ctrl+D and its test-owned temporary HOME/cwd/agent/session directories were removed. No user session was reloaded; no global configuration, installation, credentials, retained proof data or old evidence artifacts were changed.

The new redacted ANSI and cursor-separated text captures are retained outside the checkout and handed to the coordinator. They establish emitted achromatic opaque colors and keyboard interactions, not screenshots, human contrast/glyph judgment or exhaustive custom-theme legibility. The deliberately tinted custom palette is covered by the real-theme styling regression, not claimed as an additional custom-theme PTY run. Only this neutral surface slice was implemented; later orchestration/replacement slices remain untouched.

## Simplification pass

Reviewed only this task's changes before final checks. Removed redundant shutdown waits/nested cleanup scaffolding by letting the existing cancellation method own the startup barrier, preserving `finally` disposal. Kept one child, one observable snapshot and one observer subscription; no scheduler, generalized verifier, recovery service or duplicate terminal renderer. Removed an arbitrary finite scripted-response queue in favor of reusing Pi's response factory for each actual request. The final checks cover these changes. For the UI repair, kept rendering stateless (theme recalculated each render), one shared status/activity presentation and native width helpers; no new timers, retained command UI context, scheduler or terminal renderer. The widget subscription is removed before shutdown/disposal so stale children cannot repaint a replacement session.

For Slice 0, the scoped pass retained one native color conversion per render and reused the existing row-paint boundary; no color cache, theme classifier, palette configuration or verifier framework was added. Simplified the real-theme regression's per-row comparison before the final full-suite checks.
