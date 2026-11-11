# pi-extended-subagents

Pi-native bounded batch, nested delegation and live-parent coordination for **Pi 1.5.2**. A model-callable `delegate_task` creates an actual SDK child using the parent's selected model by default and public provider/authentication API. OMP is a behavioral/UI reference, **not a port**. This working slice is not full OMP parity or a pi-subagents compatibility layer.

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

Load only the production extension with `pi -e /absolute/path/to/src/extension.ts`. Select a physical model using Pi's normal `/login` and `/model` setup. **Production delegation uses that provider and may incur charges.** It does not automatically switch to a cheaper/different model or use scripted responses. Explicit operator-granted exact model/effort selection and one-way prewalk are available; see [advanced policies and capability boundaries](docs/advanced-policies.md). Missing authentication, unsupported virtual routing, an empty effective builtin tool set or forbidden resource grants fail visibly. Role tool lists are maximum allowlists, not requirements to activate every listed tool. Custom overrides of tools that would be forwarded are deliberately rejected rather than bypassed.

Ask the parent model, for example:

> Use delegate_task with profile scout to locate the startup lifecycle code and report source locations. Run it in the foreground.

The native tool input is:

```json
{"assignment":"Locate startup lifecycle code and report source locations","profile":"scout","background":false}
```

One call accepts one assignment or a fully preflighted ordered batch:

```json
{"tasks":[{"assignment":"Locate startup code","profile":"scout"},{"assignment":"Review lifecycle tests","profile":"review","limits":{"requests":20}}],"background":false}
```

Every item is validated before any launch. Default concurrency is **2**, with a **32-item FIFO queue** and **16-item batch bound**. Setup, running, nested waiting and draining consume capacity.  `general`, `scout` and `review` allow at most `read`, `grep`, `find`, `ls`. `implementation` additionally allows `write`, `edit`, `bash`. Admission intersects those ceilings with the actual callable parent builtins, without activating disabled tools. With Pi's ordinary default `read,bash,edit,write` loadout, scouts receive **read only** and implementation receives those four builtins. An effective `write`, `edit` or `bash` grant reserves the exclusive **model-tool-mediated** shared-checkout writer; an implementation profile reduced to read-only tools does not. `/task-profiles` lists bundled ceilings; each task's snapshot/details `tools` lists its admitted effective builtin grants. An empty intersection rejects the whole batch before any setup, even if owned coordination/submission tools were granted. The checkout is shared by default; there is **no filesystem isolation or OS sandbox**. Read-only profiles cannot run unrestricted shell. Tool calls run through the parent's public dispatcher, retaining validation and permission hooks.

Foreground returns final state/text once. With `background:true`, the tool returns accepted snapshots (including `{id,generation,status}`) and delivers one final custom message per call after all assignments drain, preserving input order. Batch details are `{children:[...]}`; single details are one snapshot. Failed assignments do not cancel unrelated batch siblings. Foreground abort cancels all unsettled assignments; settled outcomes remain unchanged. It does not create a detached process or survive parent reload. Use the returned identity for controls:

```text
/task-profiles
/task-status
/task-status <id> <generation>
/task-steer <id> <generation> <text>
/task-stop <id> <generation>
/task-hub
```

Steering queues after the current assistant/tool turn. Stop aborts the selected subtree and **waits for actual drain/disposal**; queued work may have no session or transcript yet. `/task-hub` opens the selected subagent’s full readonly **thread**, alongside a left roster/tree/history at wide sizes. The roster is roughly one third of the panel (capped at 32 columns); the right thread is dominant even at a 100×30 terminal’s 90% overlay. Below 76 panel columns, a compact selected-generation header replaces the roster so the thread keeps the full width. Names are readable **assignment headline · role** labels derived from snapshots, not new identities. ↑/↓ still select UUID+generation; generation/history markers remain visible, and the selected roster row stays visible independently of thread scrolling. Full identities remain searchable and inspectable in details and pinned controls. The persistent compact widget counts all current tasks, collapses queued entries into a count, prioritizes draining/running/setup rows over recent terminal rows, and warns only when a real writer lease is held. Its `● Agents`/tree hierarchy puts semantic status and bold role beside a short assignment, with dim direct stats and an indented newest-activity preview. Known tool calls, request/token/cost usage and admission-to-disposal elapsed time are snapshot-derived; unknown usage is omitted, requests are not invented turns, and no context percentage or animation timer is added. It stays within 1–5 rows and roughly a quarter of terminal height. The visual reference is [tintinweb/pi-subagents at 8df7fa7d8e8130151a8fbfa991a1d3fa6b443739](https://github.com/tintinweb/pi-subagents/tree/8df7fa7d8e8130151a8fbfa991a1d3fa6b443739), independently implemented without its source/assets/runtime. Closing the Hub never stops execution. Its opaque achromatic outer panel derives lightness from the current theme, including tinted themes; native message/tool surfaces inside keep their normal semantic styles.

Hub keys (TUI only): **↑/↓** select a UUID+generation, **Tab** cycles thread/details/tools, **j/k** scroll down/up one line, **Ctrl+u/d** or configured **PgUp/PgDn** scroll a page, and **Home/End** go to the top/bottom of the active view, **/** searches/filters identity, ancestry, role, lifecycle, assignment, result and progress. **s** opens steering, **m** sends a bounded root inbox message, **x then y** explicitly confirms subtree stop; Enter does not confirm stop. **w** waits up to 1000ms for the exact selected outcome, **p** parks an already disposed idle identity. Escape cancels input/confirmation; configured Enter/Escape closes browsing. Input/confirmation pins the original UUID+generation even if a filter changes or that generation finishes: actions never drift to another identity. Stale, draining, disposed, cancelled or otherwise disallowed controls report the real refusal. Stop accepts queued/setup/running targets; repeating a stop on an already-draining UI target refuses without changing native stop semantics.

The selected **THREAD opens at the newest output** and stays **LIVE** through streaming, completed/new messages and resize. Scrolling upward or Home detaches follow (**READING**), keeping the same reading offset as output arrives. **End resumes live follow**; scrolling back to the bottom also resumes it. Details/Tools start at the top and never auto-follow updates. Navigation aliases apply only while browsing; native search/steer/inbox input keeps its normal editing keys. In **fullscreen** mode, public normalized wheel events scroll only the Hub reading viewport; wheel elsewhere inside the Hub is consumed without moving the roster or underlying chat. In **regular** mode, the terminal owns mouse scrollback: use these keyboard controls. The extension does not enable mouse modes or change host TUI settings.

Historical generations remain separate UUID+generation rows, labeled history in the wide roster/thread header, with immutable readonly content. Tab → **details** retains full assignment/result/error, outcome validation/value, artifact pointers, admitted effective builtin tools, physical model/effort/prewalk, presence, limits and direct-only usage. The thread reuses Pi’s public main-chat `UserMessageComponent`, `AssistantMessageComponent` and `ToolExecutionComponent`, including native Markdown/code/thinking and builtin tool presentation. Tools remains a complete sanitized argument/result-text view, including success text that native edit/write presentation intentionally suppresses; opaque provider payloads/signatures and image data are not exposed (image omission is explicit). Cards are bounded previews (truncation is labeled); scroll Hub details for full text and use the existing exclusive artifact paths, not a parallel output store. No arbitrary filesystem browser is exposed. **Hub followup/revive is native-tool-only**: slash-command context has no permission-preserving tool dispatcher to start a new generation. Use the model-issued `delegate_coordinate` workflow below; pressing f/r explains this limitation without allocating or dispatching.

Native rendering uses public builtin renderer definitions and the actual injected host TUI/cwd—not an executable tool backend or a second TUI. Recorded edit diffs render natively; live edit preview file reads and invented tool clocks are disabled. Public defaults show thinking and expand tool output; parent-only renderer overrides, Markdown transformers and private hide-thinking/output-padding preferences are not publicly exposed here, so exact third-party/settings equivalence is not promised. Opaque tool details are withheld except sanitized documented edit diff/line fields. Native styling is preserved after input sanitation; terminal hyperlinks/shell zones and image protocols are omitted.

### Coordinate and assign follow-up work

Enable `delegate_coordinate` alongside `delegate_task` in an explicit tool allowlist. Root model controls use pinned `{id,generation}` references:

```json
{"action":"message","target":{"id":"<task-id>","generation":1},"text":"Check the shutdown path too","mode":"steer"}
{"action":"wait","target":{"id":"<task-id>","generation":1},"timeoutMs":30000}
{"action":"followup","target":{"id":"<task-id>","generation":1},"assignment":"Now review the cancellation path"}
```

These are separate calls to `delegate_coordinate`. `message` accepts `inbox` (default), `steer` or `followUp`. Accepted/queued is **not acknowledgment**; delivered means recipient transcript or inbox-tool visibility, never proof the model read/understood it. `wait` selects one outcome, a known `messageId` receipt, or (with neither) the caller's own inbox. Every wait needs a 1–60000ms timeout and retains real capacity. Root can read its inbox with `{"action":"inbox"}`. Child messages to root do not automatically trigger a parent turn.

Child coordination is **off by default**. Only operator profile config may grant selected `"coordination":["message","inbox","wait"]` actions; project/request arrays may only narrow them. Granted children address only supplied identities of their exact parent generation, direct children or siblings, not arbitrary registry peers or transcripts. Only direct children may omit `target` to message root. Sender identity is bound to the originating tool closure, never accepted from model input.

Completion disposes the SDK session, permit and writer lease; presence becomes **idle**, independently of the immutable assignment outcome. Root `park` marks a disposed idle identity **parked**, without retaining a live session or writer. `followup` requires idle; `revive` requires parked. Both immediately acknowledge a fresh admitted generation (then use `wait`/`status`), re-resolve current grants/model/auth, and create a new session/transcript/artifact directory. They do **not** replay old history/tools: supply relevant context explicitly in the new assignment. The prior schema requirement is retained unless a new supported schema is supplied, with a fresh required submission. Old controls cannot retarget the new generation. Parent tool activation after admission cannot add rights to that identity on followup/revive; only a newly admitted identity can use newly available tools within current policy. Revocation still applies through the live parent dispatcher. `stop` closes presence, including idle/parked identities.

A descendant can be renewed only while its **exact original parent UUID+generation** is still active and authorized, with immediate capacity and remaining parent lifetime spawn budget. Expired-parent revival rejects; delegate a new identity through an authorized live parent instead. This is in-memory, current-parent reassignment, **not restart recovery**. See the [coordination reference](docs/delegation-contract.md#live-parent-messaging-waits-and-presence) for bounds and terminal states.

### File instructions, validated results and full output

Each item may use `taskFile` **instead of** `assignment`, and may independently require a supported `resultSchema`:

```json
{"taskFile":"tasks/review.txt","profile":"review","resultSchema":{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}}
```

Task paths are explicit non-hidden workspace-relative regular UTF-8 files (1–50000 bytes, no traversal/escaping symlinks or `node_modules`). Hidden/`node_modules` exclusions apply to both the supplied path and resolved target; ordinary aliases to allowed in-workspace files remain supported. The actual parent builtin read dispatcher and permission hooks obtain the text; empty/denied/truncated/binary reads reject the whole batch before any child setup. Files contain task text, **never authority**. Do not change them during preflight; the public read API does not provide an atomic filesystem sandbox. Nested reads still require the ancestor's read grant/budget.

Schema-required children must call their child-local **`submit_result({value:...})`**. Actual values are validated strictly with native Pi validation; final prose is not parsed as a result. Invalid submissions provide errors and can be corrected within normal limits. A valid submission is provisional until all work drains, cannot be replaced, and never overrides cancellation/provider failure. Missing/invalid required submissions fail visibly. Ordinary tasks need no schema. The [contract](docs/delegation-contract.md#required-structured-results) defines the deliberately finite, no-ref/no-regex supported schema subset.

New completed prompts retain exact last-assistant text in `result.txt` and any accepted value in `structured.json` alongside their SDK transcript. Snapshot `outcome` and `artifacts` distinguish submission/validation, terminal status and available full paths. Previews explicitly truncate large fields; tool details retain full detached snapshots. Persistence failures are errors, never successful full-output claims. Failed/cancelled output may be retained as evidence, not success. Treat these sensitive files like transcripts; no external logging/upload or historical migration is performed.

### Exact model/effort and prewalk (opt-in)

Operator profile `models` grants exact `{provider,id,effort}` alternatives. Optional profile or task `model` selects one; an explicit task selection stays exact and suppresses inherited prewalk across renewal. Task `models` may only narrow the admitted allowlist. Project/request/ancestor/revival cannot mint or restore grants. Unsupported/unavailable models, scopes or efforts fail before dispatch without fallback/coercion. Operator `prewalk` grants a one-way same-session switch after the first completed builtin edit/write, not a repository scan. The inherited physical parent remains the ordinary default; no advisor/extra inference is enabled. Full configuration, exclusions and bounded investigation results: [advanced policy ledger](docs/advanced-policies.md).

### Shared-writer scope: model tools only

The coordinator enforces one child writer against parent model-tool `bash`/`edit`/`write` and unknown tools, including in-flight parent mutations. Batch/root child writers queue and serialize; a conflicting parent model tool fails visibly. An already in-flight parent mutation rejects writer admission before any new launch. Read-only children may coexist within capacity. The implementation widget/overlay warns while a writer is active.

**Manually entered `!`/`!!` commands are outside the writer guarantee**, like external terminals, editors and unrelated Pi sessions. Do not perform conflicting manual/external writes while a child writer is active. This operator responsibility is explicit: Pi 1.5.2 has no public interactive-shell completion notification, and wrapping operations would skip other permission hooks. The extension does not intercept, wrap, disable or reorder manual shell commands, and observing one does not disable later writers. It makes no global lock or OS sandbox claim. Arbitrary extension JavaScript is also outside tool-mediated coordination.

## Explicit profiles and resources

Built-in definitions have extension-owned role prompts. No ambient pi-subagents agents, extensions, MCP servers, context files, skills, prompts, themes, settings or credentials are loaded into children.

Optional operator configuration lives at `<Pi agent dir>/delegation.json` (normally `~/.pi/agent/delegation.json`), keyed by bundled profile name. It can specialize descriptions/prompts, narrow bundled tools, grant exact absolute skill Markdown files, explicitly grant spawn roles, and choose bounded scheduler maximums:

```json
{
  "review": {
    "tools": ["read", "grep"],
    "skills": ["/absolute/operator-reviewed/review/SKILL.md"],
    "prompt": "Review this assignment and report concrete findings with source locations."
  }
}
```

Nested delegation is **disabled by default**. For example, operator `"general":{"spawn":["general"]}` permits a general child to spawn a general grandchild, within default absolute depth 2 and cumulative direct spawn bound 8. Descendants cannot regain ancestor tools/skills/spawn grants. They use a child-local public SDK model-only tool, not a bypass of the root tool's exposure. A nested foreground batch must have enough immediately free capacity for every item; otherwise it fails visibly. Waiting parents retain capacity: no lending or hidden overcommit. Writer-under-writer nesting and nested background calls are explicitly unsupported.

Default per-task bounds are **10 minutes from admission**, **100 direct model-registry dispatches**, and **100 executable tool calls**. Optional request `limits` only narrows operator/project bounds. Limits cancel visibly with `limitReason`; deadlines initiate abort but **cannot force unabortable auth/provider/permission code to return**. Capacity and writer ownership remain held until real setup/tool drain. These are hard guards, not soft-yield prompts or provider-internal/token/cost precision promises. Full settings/ceilings and cancellation semantics: [delegation contract](docs/delegation-contract.md#capacity-and-bounded-execution).

Skills use Pi's standard loader, without default discovery. A trusted project's `.pi/delegation.json` uses the same format but can **only narrow** the operator-resolved tools/skills; it cannot add grants. Untrusted project configuration is ignored. `extensions`, `mcp` and other unsupported fields are rejected, not silently promised. See the [full contract](docs/delegation-contract.md).

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
  result.txt                 # complete last-assistant text after drain (when referenced)
  structured.json            # accepted JSON value, if supplied (when referenced)
```

Old `extended-subagents-proof` data is left untouched and is not loaded or migrated. New artifacts may contain sensitive assignment, tool and model output; treat them like parent transcripts. There is no durable recovery, cross-parent revival or generalized artifact service. Within this live parent, completed generation snapshots and bounded message receipts are retained in memory; renewed generations use `<task-id>-g<generation>/` directories and never modify completed files. Parent shutdown/reload aborts, drains and disposes all children. SDK hosts must bind extensions and emit shutdown through the public lifecycle; bare `session.dispose()` is not a substitute for host shutdown dispatch. Abrupt process death cannot run cleanup hooks.

The joined fleet roster/tree/transcript UI is implemented as described above. **Advisor is excluded from the current product scope**, not awaiting an implementation contract; explicit ordinary `review` delegation remains supported and is not an advisor substitute. **Production isolation/apply/path or cd transformation is deferred and unimplemented**; the checkout remains shared. Neither excluded advisor nor deferred isolation is a current release gate. Other unsupported gaps remain: cross-parent messaging or revival, automatic idle TTL/retained-session reuse, probes/speculation/workpool, executable extension/MCP grants and historical consultation. See the [capability ledger](docs/advanced-policies.md) for precise boundaries.

No live provider inference, credential changes, global Pi installation/config changes or retained-data migration were performed during verification.

### Offline fleet UI exercise (synthetic workspace only)

Create `input.txt` in a disposable cwd and run this checkout’s local Pi CLI with `--offline --no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files`, explicit `-e /absolute/path/src/extension.ts -e /absolute/path/examples/controlled-fleet.ts`, and tools `read,grep,find,ls,write,edit,bash,delegate_task,delegate_coordinate`. The controlled example selects its own offline provider; do not use it in a real project (its writer creates `fleet-output.txt`). Enter `fleet example`, then `/task-hub`. `/fleet-theme dark` and `/fleet-theme light` exercise live theme changes. `fleet coordinate <JSON>` explicitly model-calls native `delegate_coordinate` for synthetic park/followup/revive. This is controlled SDK/terminal evidence, not live inference or human visual acceptance. The example is not loaded by the package manifest.
