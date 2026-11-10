# Subagent parity inventory and adapter feasibility

For implementers deciding the next bounded group. This is an investigation contract, **not a replacement implementation or a port**. OMP is a behavioral/UI reference. All OMP links below are pinned to **`eda28eff97cf7a352fd3057a03581be1686dbc7a`** in [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi/tree/eda28eff97cf7a352fd3057a03581be1686dbc7a). Pi feasibility applies to the published **1.5.2** public SDK, extensions, and TUI APIs, not to OMP's similarly named classes.

## Current core and scheduling disposition

The historical proof matrix/ledger below remains pinned reference evidence, **not the current command/API contract**. Production proof execution has been replaced with real SDK delegation; use [the current delegation contract](delegation-contract.md) and [current verification](verification.md#slice-3-scheduling-evidence) for source/acceptance status. No old proof data is migrated or modified.

| Rows | Current implemented boundary | Still unresolved / excluded |
| --- | --- | --- |
| A–D | New extension-owned JSON profile config; bundled general/scout/review/implementation definitions; operator grants and project subset-only specialization; exact skill files; complete resource-loader ownership; actual parent model/public provider-auth bridge; role-specific built-in tools through parent validation/hooks | Executable extension/MCP grants unsupported; virtual-model routing rejected; custom roles, virtual routing and executable resources remain unsupported |
| E/G | Actual SDK message/tool streaming, prompt-completion result acceptance, foreground result/background identity + one delivery, status/steer/stop | Structured yield and peer messaging/wait excluded; bounded ordered batches and explicitly granted nesting now supported |
| H/J | Atomic whole-batch admission, FIFO queue, finite concurrency including setup/drain, serialized shared writers, explicit ancestor spawn/depth/count grants, hard admission deadline/direct-dispatch/tool guards; nested calls reject unavailable capacity instead of lending permits | No unlimited fanout, provider-internal request accounting, soft-yield/probe/cost parity, speculation or workpool; nested background and writer-under-writer unsupported |
| L | UUID+generation parent/depth tree, queued/setup/running/draining/settled/failed/cancelled, direct request/SDK token/cost/context telemetry, new transcript refs, parent shutdown/reload drain/dispose | No parking/revival, detached runner, crash recovery or old-data migration |
| K/shared checkout | Production implementation-profile task admission, actual exclusive writer lease and real parent/child model-tool permission enforcement proven under controlled model outputs | Manual !/!! commands, external terminals/editors/unrelated sessions are explicitly uncoordinated; operator must avoid conflicting writes. No shell interception or OS sandbox claim; no filesystem isolation/apply |
| M | Existing neutral widget/overlay now reads latest real registry entry; all entries available through status command | Full roster/tree/transcript Hub remains Slice 2; no fresh display-level interactive acceptance claimed |

This enables useful read-only and model-tool-coordinated writing delegation under the explicit manual/external-process exclusion, not full replacement/parity acceptance. The remaining source/test ledger still describes the larger behavioral target. The historical matrix's proof-only statuses and recommended groupings are superseded only by the explicit current rows above, not blanket parity claims.

## Reading this inventory

The target is eventual full **subagent-owned observable behavior**, with equivalent Pi implementations and UI substitutions allowed. There is no pi-subagents API compatibility, historical-data migration, OMP runtime import, fork, or undocumented Pi access. Execution belongs to the parent-session lifetime. Adjacent OMP host integrations are dependencies of reference behavior, not an implicit promise to reproduce the rest of OMP.

Status:
- **Proved**: exercised against real Pi sessions with the controlled built-in `fauxProvider`; not an actual external model.
- **Mapped, unproved**: a public Pi seam exists, but the product behavior is not implemented or accepted.
- **Blocked/unresolved**: a specific semantic/API/policy gap must be resolved before promising equivalence.
- **Adjacent**: host-owned implementation is excluded; its child-facing boundary still needs an explicit contract.

The source/test ledger below covers every file under OMP `src/task`, its entire `test/task` directory, registry lifecycle, and the named UI seams. Related host, RPC, worker and UI tests are included separately. Source comments, implementation seams and upstream test cases inform the contracts; **upstream tests were not executed here**, and an indexed test is not a claim that Pi passes it. No bulk source has been copied into this repository.

## Historical proof behavior and acceptance matrix

Each row's acceptance describes the eventual Pi implementation unless the status explicitly says proved. The appendix links the exact source/test files for each group.

| ID / surface | Reference behavior and acceptance boundary | Pi-native mapping / present status |
| --- | --- | --- |
| A — definitions/discovery | Bundled and Markdown/frontmatter definitions: name/description/system prompt, absent versus empty tools, allowed spawns, model patterns/thinking, output schema, blocking/structured, autoload skills, read summarization, prewalk/advisor. OMP project > user > extension/package/plugin > bundled precedence; duplicate/reserved names and parse failures must be visible. Discovery memo is session/root-policy aware, invalidates on refresh and does not cache rejection. Commands substitute input without interpreting dollar syntax inside that input. | Explicit extension-owned definitions and Pi resources; **mapped, unproved**. OMP discovery roots/frontmatter are reference inputs, not Pi configuration paths to load. Selection of a Pi-native definition format and trust/precedence remains pending; proof deliberately loads none. |
| B — invocation/preflight | Task flat/batch schemas vary with settings; single task requires assignment, batch shares context and supplies per-item solution space. Preserve inline/file whitespace. Per-call model/taskFile/schema/effort/isolation fields are gated; normalize stale arguments without accidentally dropping denied gated values. Validate entire batch before launching anything. Blocking items finish inline while nonblocking siblings return async identities; scheduling failure preserves completed evidence. | `registerTool`, JSON Schema, explicit preflight, `sendMessage` and child `prompt`; **mapped, unproved**. Proof exposes commands only, not a task tool or compatibility schema. |
| C — nested delegation and authority | `spawns` false/empty denies; `*`/omitted permits; explicit list filters advertised agents and chooses first allowed default. Depth gate is `taskDepth < maxRecursionDepth`, negative cap means unbounded in OMP. Disabled agents and plan/read-only restrictions apply to every frontend. Child cannot grant itself models or widen restrictions through writable project settings. Nested IDs and observability retain actual spawning parent, not just root. | Child-specific `tools`, `customTools`, resource loader, extension-owned depth/ancestry grants. **Proof denies all delegation and tools.** Full recursion limits, authority intersection, cycle/concurrency policy unimplemented; do not infer parity from independent session creation. |
| D — resource/MCP inheritance | Executor forwards exact credential resolver, live extension-root policy, prepared factories/source paths, rules, skills and session agents when allowed; extensions rebind per child. Absent versus explicit empty tools remain distinct. Restricted children suppress fresh discovery and MCP. Shared MCP manager gives each child scoped live tools, follows reload/removal, preserves explicit same-name custom tools, propagates cancellation and tool-call tracking. | **Proved deny-all resource boundary:** custom `ResourceLoader`, `tools: []`, in-memory settings/credentials, dedicated cwd/agent/cache/transcript directories, no discovered extensions/context/skills/prompts/themes or MCP connector. This is resource control, NOT an OS sandbox. Selective inheritance and parent credential/model grants **unresolved**. Pi MCP is adjacent host territory; no OMP manager/proxy imports, no blanket equivalent-support claim. |
| E — streamed execution/results | Real child creation, launch/setup time versus permit time, streamed text/tool starts/updates/results, bounded current/recent output, model attribution, final result acceptance and terminal transitions. Do not call a low-level `agent_end` the final idle state. OMP preserves final accepted yield even if peer replies or cleanup occur later; async-owned jobs must quiesce and refresh stale yields. | **Proved subset:** `createAgentSession`, `subscribe(message_update/message_end)`, `prompt` completion, `getLastAssistantText`, snapshot status, JSONL transcript. Pi `agent_settled`/`waitForIdle` map eventual final-idle semantics. Tool activity, nested jobs, yield acceptance and late-result races **unproved**. Proof's `completed` means scripted Pi prompt settled, not OMP structured acceptance. |
| F — structured yield and artifacts | Caller > agent > session output schema precedence; structured on/off and agent opt-in; permissive versus enforced schema result, incremental typed sections, missing/null yield warnings, reminders/retries, durable structured sidecar (remove stale sidecars on failed replacement). Result envelope preserves errors and isolation summaries; bounded preview points to artifact; unique IDs reserve existing/ancestor/advisor names. | Pi custom `yield` tool with schema validation and termination, extension-owned bounded artifacts and identity allocator; **mapped, unproved**. Proof captures assistant text only (UI tail 4096 chars, scripted input echo 240 chars); it does not provide agent://, output schemas, yield loops or historical ID compatibility. |
| G — queueing/messaging/wait | Steering queued after current assistant/tools; follow-up/wake of idle peers; parent/peer visibility and ownership checks; delivery acknowledgments are not completion; waits track dependencies without losing/duplicating accepted results or deadlocking parent/child questions. A peer message after report must not overwrite that report or keep the original task waiting for unrelated reply turns. IRC wake/revive reinstalls the correct yield contract. Advisor transcripts are not messageable peers. | **Proved single-child queued steering** via real `session.steer()` and a second provider request. `followUp`, `waitForIdle`, parent events and extension-owned message routing are public seams; multi-peer mailbox, wake, dependency graph, read/write permission gates and OMP wait/IRC return semantics **unimplemented**. Pi built-in tools are not a replacement registry/message bus. |
| H — budgets/probes/errors | Wall-clock limit includes initialization and aborts stalled launch; late yield cannot turn timeout into success. Count requests, including provider-internal steps; agent-specific soft budget overrides global, issue one notice, force final yield/abort at hard threshold; cost cap and model swaps retain accounting. Completion probes are direct-child TUI-only ephemeral side turns on backoff, parse bounded pct/stage/watch, cap live pct at 99 until final, record late billing without changing transcript leaf. | Pi events, abort signals and usage allow owned monitors; **unproved**. No demonstrated public Pi equivalent of OMP `runEphemeralTurn` on an active session or provider-internal request accounting. Probe/cache/late-cost equivalence is an **explicit blocker**, not a progress percentage to synthesize. Proof launches no probes/timers/budgets or extra model requests. |
| I — advisor/prewalk/model routing | Per-agent advisor defaults off even if parent enabled; explicit override controls role/model and retained observer transcript. Prewalk can use smol/custom target and hands off at first edit/write, preserves the active target/model/effort through park/revive, does not re-arm after handoff. Exact per-call model requires live operator authority; grant revocation affects next request. Role fallback, account pools/service tiers, context window after model swap and prompt-cache family identity remain coherent. | Public `setModel`, `setThinkingLevel`, `before_agent_start`, `tool_call`, virtual model/provider registration and separate sessions are possible **unproved** building blocks. Advisor scheduling/review and first-mutation handoff require their own acceptance; Pi provider credentials/native routing/cache are adjacent. No OMP auth bridge, model pools, session advisor or internal route APIs imported. Exact cache-affinity/ephemeral review equivalence **unresolved**. |
| J — concurrency/speculation/workpool | Global/session permit bounds and provider concurrency, fair ownership release, deterministic batch ordering; errors abort/drain launched siblings, cancellation preserves settled results. `SpawnRun` detached launch replays progress on adoption and unlinks owner signals. Speculative batch items launch only when complete JSON objects close and host authorizes; invalid/mismatched/finally blocked call aborts every unadopted run. Workpool reuses live workers, queues/redistributes items, incremental yield identifies each item and aggregate job result. | Explicit Pi child coordinator and tool execution mode could implement scheduling, **unproved**. Proof has one child, no queue/permit/workpool/speculation. Pi public tool-call event is after complete arguments; no demonstrated extension-level equivalent of OMP's authorized streamed-argument speculation hook. **Blocker:** approve a safe no-speculation substitution or find a public preflight-authorized seam before this feature. Never launch from untrusted partial JSON just to imitate UI timing. |
| K — filesystem isolation/apply conflicts | OMP copies workspace state using native isolation/ovnfs backends; baseline includes staged/unstaged/untracked content and independent nested repositories, excluding linked worktrees of same common repo. Snapshot size budget prevents memory blowups. Delta captured from isolated copy, not a racing parent. Save root/nested patch artifacts before teardown; keep workspace/branch if capture/apply fails. Branch/merge modes, dirty nested-repo stash restoration and partial-success warnings preserve unrelated work. Repeated release does not recommit unchanged delta; stop failure retains ownership for cleanup/retry. | **Unresolved high-risk implementation group.** Pi tool cwd is not a filesystem sandbox. Public `create*Tool` operations/spawn hooks can restrict paths or target an explicitly created workspace, but no OMP native engines/ovnfs/worktree internals are imported. Proof never writes/applies project changes or runs tools. Future git/native-backend substitution and conflict/application policy must be decided and tested on throwaway repositories including nested repos and dirty user state. |
| L — registry/lifetime/parking/recovery | Stable ID plus generation prevents stale callbacks clobbering a replacement; main/sub/advisor have different addressability. Running/idle/parked/aborted refs retain transcript/metrics. TTL parks live sessions, drops shells/settings/resources and keeps reviver contract; ensureLive coalesces revival and races with park/release; tombstone kill markers differ from parent shutdown. Cold revival rebinds allowed tools/extensions, prewalk state and live owner policy, refuses missing/unfaithful contracts. OMP crash restore resumes interrupted children and redelivers jobs; seance forks historical read-only evidence separately. | **Proved:** child creation, abort/dispose on parent reload/shutdown hook, cancellation, shutdown/create race, idempotent cleanup and disk reopening in a new SDK session. **Not proved/implemented:** TTL parking, revival, tombstones, crash restart, warm/cold resource reconstruction, seance. `SessionManager.open()` is transcript reopening, NOT revival. Cross-parent durable recovery and old-data migration are outside settled parent-lifetime scope; whether a fresh parent can inspect new transcripts must be explicit, not an implicit recovery service. Bare SDK `AgentSession.dispose()` does not emit `session_shutdown`; custom hosts must own lifecycle dispatch. |
| M — live task/tree/Hub UI | Running and settled task cards expose nested live/completed children without recursion cycles; bounded viewport, per-call intent, resolved model/advisor, tool/cost/context stats, stage/watch, sanitized artifacts/results and expandable detail. Hub supports source/status filters, parent tree, selection, transcript activity, focus/open, kill/revive, unread messages, parked history and cost aggregation without double-counting nested charges. Advisor rows read-only. Native/remote transport is host UI, not the child registry owner. | **Proved component subset:** observer subscribes to coordinator, injected theme/keybindings, terminal-mode guard, width truncation, control sanitization, Enter/Escape `done()` and view disposal leaves execution running. Uses Pi `ctx.ui.custom({overlay:true})` plus a lifecycle-bound `ctx.ui.setWidget` for main-screen status/activity, no second renderer. The repaired Hub adds a themed frame/title, padding and full-row background. **Actual interactive PTY output observed** at 100×30 and 40×16, including Escape/Enter focus return, retained widget, cancellation/completion and live dark-to-light theme change; this is not screenshot/human visual acceptance. See [repair evidence](verification.md#interactive-terminal-repair-evidence). Task cards, tree, hub actions, cost aggregation and transcript navigation remain unimplemented. Pi-native presentation substitutions are allowed; native OMP renderer is adjacent. |
| N — other host frontends | OMP eval `agent()`/workpool and CLI task/restore share subagent primitive and authority, RPC exposes scoped snapshots/events/transcripts/steering, thread workers mirror registry/model/settings/MCP/etc. Worker failure/late initializer cannot overwrite newer generation; teardown drains retained resources. | Public SDK/CLI/RPC offer alternative hosts, **not implemented parity**. OMP eval kernels, LSP, shared MCP manager, native routing, CLI evaluation, remote/collab/native UI and worker bridges are adjacent host territory; child-facing policy/lifecycle/observability contracts remain tracked, not silently dropped. Proof only registers extension slash commands, real SDK child execution, and a terminal observer. |

## Capability decisions still required (not inventory omissions)

1. Define the extension-owned selective inheritance/grant contract and threat model before enabling tools or parent models. Proof's deny-all resources are safe and intentionally insufficient for useful coding work. An in-process child is not isolation against malicious extension/JavaScript code or process environment access.
2. Resolve safe substitutes/public APIs for authorized partial-argument speculative launch, active-session ephemeral probes/advisor side turns, and provider-internal request/cache accounting. None is required to finish this proof; none can be called supported yet.
3. Choose filesystem workspace and apply/conflict semantics with explicit retention/cleanup guarantees. No OMP native engine is available through Pi's public extension API simply because both projects call a concept a worktree.
4. Bound worker execution semantics separately from UI parity: in-process sessions may be a permitted equivalent if responsiveness/cleanup/resource tests establish the observable guarantees; thread workers cannot be promised from this proof.
5. Parent-lifetime state is settled; within-parent parking/revival remains in target parity. OMP process-crash restoration, historical consultation/seance, remote/collab access and data migration require explicit scope reconciliation rather than accidental implementation of cross-parent recovery.
6. Representative interactive PTY focus/exit, narrow resize, Unicode and theme-change observations now supplement component tests for the minimal UI repair. Full consumer UI acceptance still needs broader terminal/theme coverage and human display-level inspection; do not extrapolate this bounded proof to the unfinished task/tree/Hub product.

## Recommended next implementation groupings

Keep the proof separate from consumer-facing replacement claims. Implement the smallest vertical slice for each grouping before widening its surface:

1. **Authority + definition contract (A–D, I preflight):** trusted definitions, explicit resource/model grants, depth/ancestry, atomic preflight. No ambient extension inheritance. This unlocks a useful child without creating a scheduler first.
2. **Owned execution + result/lifecycle (E–H, L):** bounded streamed tool/result state, structured acceptance/artifacts, cancellation and parent shutdown, generation-safe registry, then within-parent park/revive and messaging/wait. Test late-result and shutdown races before batch concurrency.
3. **Concurrency and budgets (H, J, N worker boundary):** aggregate limits, ordered batches/async completion, request/cost guards, worker responsiveness. Resolve speculation/probe gaps before committing their implementation.
4. **Filesystem isolation (K):** separate gated work on throwaway repos; apply/conflict tests must precede enabling any project write tool. No consumer-safe coding replacement without it if isolation parity is claimed.
5. **Observer UI and advanced policy (I, M):** grow the same execution state into task cards/tree/Hub and transcript controls; advisor/prewalk after routing/grants are stable. Actual interactive acceptance remains a separate evidence requirement, not a model call.

OMP source/test reference coverage follows. Each entry is traceability, not a module-name equivalence claim.

## Exact-revision source ledger

All task-domain files are listed, including small policy/artifact helpers. Cross-cutting executor/index/settings/types files span more than their primary group. Related host files below identify boundaries, not authorization to reuse them.

| Group | OMP source |
| --- | --- |
| I | [`packages/coding-agent/src/advisor/runtime.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/advisor/runtime.ts) |
| G | [`packages/coding-agent/src/irc/bus.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/irc/bus.ts) |
| G | [`packages/coding-agent/src/irc/messaging.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/irc/messaging.ts) |
| N | [`packages/coding-agent/src/modes/rpc/rpc-subagents.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/modes/rpc/rpc-subagents.ts) |
| G, L | [`packages/coding-agent/src/registry/agent-awaits.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/registry/agent-awaits.ts) |
| G, L | [`packages/coding-agent/src/registry/agent-lifecycle.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/registry/agent-lifecycle.ts) |
| G, L | [`packages/coding-agent/src/registry/agent-registry.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/registry/agent-registry.ts) |
| G, L | [`packages/coding-agent/src/registry/agent-tombstone.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/registry/agent-tombstone.ts) |
| G, L | [`packages/coding-agent/src/registry/persisted-agents.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/registry/persisted-agents.ts) |
| I | [`packages/coding-agent/src/session/prewalk.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/session/prewalk.ts) |
| I | [`packages/coding-agent/src/session/session-advisors.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/session/session-advisors.ts) |
| A | [`packages/coding-agent/src/task/agents.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/agents.ts) |
| A | [`packages/coding-agent/src/task/commands.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/commands.ts) |
| H | [`packages/coding-agent/src/task/completion-probe.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/completion-probe.ts) |
| A | [`packages/coding-agent/src/task/discovery.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/discovery.ts) |
| E | [`packages/coding-agent/src/task/error-attribution.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/error-attribution.ts) |
| N | [`packages/coding-agent/src/task/eval-tools.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/eval-tools.ts) |
| E | [`packages/coding-agent/src/task/executor.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/executor.ts) |
| B | [`packages/coding-agent/src/task/file-approval.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/file-approval.ts) |
| B | [`packages/coding-agent/src/task/index.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/index.ts) |
| K | [`packages/coding-agent/src/task/isolation-ownership.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/isolation-ownership.ts) |
| K | [`packages/coding-agent/src/task/isolation-runner.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/isolation-runner.ts) |
| F | [`packages/coding-agent/src/task/label.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/label.ts) |
| I | [`packages/coding-agent/src/task/model-approval.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/model-approval.ts) |
| F | [`packages/coding-agent/src/task/name-generator.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/name-generator.ts) |
| F | [`packages/coding-agent/src/task/output-manager.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/output-manager.ts) |
| K | [`packages/coding-agent/src/task/ovnfs.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/ovnfs.ts) |
| J | [`packages/coding-agent/src/task/parallel.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/parallel.ts) |
| L | [`packages/coding-agent/src/task/persisted-revive.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/persisted-revive.ts) |
| I | [`packages/coding-agent/src/task/prewalk.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/prewalk.ts) |
| C | [`packages/coding-agent/src/task/prompt-policy.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/prompt-policy.ts) |
| J | [`packages/coding-agent/src/task/provider-concurrency.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/provider-concurrency.ts) |
| C | [`packages/coding-agent/src/task/read-only-policy.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/read-only-policy.ts) |
| L | [`packages/coding-agent/src/task/restore.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/restore.ts) |
| F | [`packages/coding-agent/src/task/result-summary.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/result-summary.ts) |
| L | [`packages/coding-agent/src/task/seance-policy.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/seance-policy.ts) |
| L | [`packages/coding-agent/src/task/seance.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/seance.ts) |
| A–N | [`packages/coding-agent/src/task/settings.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/settings.ts) |
| C | [`packages/coding-agent/src/task/spawn-policy.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/spawn-policy.ts) |
| J | [`packages/coding-agent/src/task/spawn-run.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/spawn-run.ts) |
| J | [`packages/coding-agent/src/task/speculative-launch.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/speculative-launch.ts) |
| F | [`packages/coding-agent/src/task/structured-subagent.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/structured-subagent.ts) |
| E | [`packages/coding-agent/src/task/subprocess-tool-registry.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/subprocess-tool-registry.ts) |
| B | [`packages/coding-agent/src/task/types.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/types.ts) |
| M | [`packages/coding-agent/src/task/widget-inputs.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/widget-inputs.ts) |
| J | [`packages/coding-agent/src/task/workpool-yield.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/workpool-yield.ts) |
| J | [`packages/coding-agent/src/task/workpool.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/workpool.ts) |
| K | [`packages/coding-agent/src/task/worktree.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/worktree.ts) |
| F | [`packages/coding-agent/src/task/yield-assembly.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/task/yield-assembly.ts) |
| N | [`packages/coding-agent/src/thread/subagent-spawn-signal.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/thread/subagent-spawn-signal.ts) |
| N | [`packages/coding-agent/src/thread/subagent-worker-entry.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/thread/subagent-worker-entry.ts) |
| N | [`packages/coding-agent/src/thread/subagent-worker.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/thread/subagent-worker.ts) |
| G | [`packages/coding-agent/src/tools/wait.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/tools/wait.ts) |
| M | [`packages/tui/src/overlays/agent-hub-projection.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/overlays/agent-hub-projection.ts) |
| M | [`packages/tui/src/overlays/agent-hub-renderer.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/overlays/agent-hub-renderer.ts) |
| M | [`packages/tui/src/overlays/agent-hub-types.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/overlays/agent-hub-types.ts) |
| M | [`packages/tui/src/overlays/agent-hub.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/overlays/agent-hub.ts) |
| M | [`packages/tui/src/overlays/agents-hub.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/overlays/agents-hub.ts) |
| M | [`packages/tui/src/overlays/running-subagent-badge.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/overlays/running-subagent-badge.ts) |
| M | [`packages/tui/src/tools/agent-tree.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/tools/agent-tree.ts) |
| M | [`packages/tui/src/tools/irc.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/tools/irc.ts) |
| M | [`packages/tui/src/tools/task.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/tools/task.ts) |
| G | [`packages/tui/src/tools/wait.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/tools/wait.ts) |

## Exact-revision upstream test ledger

Every `packages/coding-agent/test/task/*.test.ts` at this revision is included below. Related test directories are selected for the boundaries in the matrix, not an assertion of exhaustive coverage of all OMP host behavior. These are upstream reference tests, not this package’s tests. Test case titles and selected implementation/fixture bodies were inspected; they have not been run or translated wholesale.

### A

- [`packages/coding-agent/test/task/commands.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/commands.test.ts)
- [`packages/coding-agent/test/task/create-memo.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/create-memo.test.ts)
- [`packages/coding-agent/test/task/discovery.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/discovery.test.ts)
- [`packages/coding-agent/test/task/session-agent-description.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/session-agent-description.test.ts)

### B

- [`packages/coding-agent/test/task/async-description.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/async-description.test.ts)
- [`packages/coding-agent/test/task/task-batch.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-batch.test.ts)
- [`packages/coding-agent/test/task/task-blocking-split.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-blocking-split.test.ts)
- [`packages/coding-agent/test/task/task-file-approval.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-file-approval.test.ts)
- [`packages/coding-agent/test/task/task-file.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-file.test.ts)
- [`packages/coding-agent/test/task/task-preflight.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-preflight.test.ts)
- [`packages/coding-agent/test/task/task-schema.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-schema.test.ts)
- [`packages/coding-agent/test/task/wire-schema.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/wire-schema.test.ts)

### C

- [`packages/coding-agent/test/task/spawn-policy.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/spawn-policy.test.ts)

### D

- [`packages/coding-agent/test/sdk-subagent-auth-inheritance.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/sdk-subagent-auth-inheritance.test.ts)
- [`packages/coding-agent/test/subagent-mcp-follow.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/subagent-mcp-follow.test.ts)
- [`packages/coding-agent/test/task-executor-mcp-parity.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task-executor-mcp-parity.test.ts)
- [`packages/coding-agent/test/task-executor-mcp-timeout.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task-executor-mcp-timeout.test.ts)
- [`packages/coding-agent/test/task/autoload-skills.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/autoload-skills.test.ts)
- [`packages/coding-agent/test/task/executor-pass-through.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-pass-through.test.ts)

### E

- [`packages/coding-agent/test/task/error-attribution.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/error-attribution.test.ts)
- [`packages/coding-agent/test/task/executor-async-quiescence.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-async-quiescence.test.ts)
- [`packages/coding-agent/test/task/executor-deferred-cleanup.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-deferred-cleanup.test.ts)
- [`packages/coding-agent/test/task/executor-launch-startup.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-launch-startup.test.ts)
- [`packages/coding-agent/test/task/executor-recent-output.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-recent-output.test.ts)
- [`packages/coding-agent/test/task/executor-result-acceptance.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-result-acceptance.test.ts)
- [`packages/coding-agent/test/task/focused-subagent-manual-yield.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/focused-subagent-manual-yield.test.ts)
- [`packages/coding-agent/test/task/subagent-lsp.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/subagent-lsp.test.ts)
- [`packages/coding-agent/test/task/task-spawn.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-spawn.test.ts)
- [`packages/coding-agent/test/task/task-widget-inputs.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-widget-inputs.test.ts)

### F

- [`packages/coding-agent/test/task/executor-structured-sidecar.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-structured-sidecar.test.ts)
- [`packages/coding-agent/test/task/executor-subagent-reminders.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-subagent-reminders.test.ts)
- [`packages/coding-agent/test/task/executor-warnings.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-warnings.test.ts)
- [`packages/coding-agent/test/task/executor-yield-loop.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-yield-loop.test.ts)
- [`packages/coding-agent/test/task/output-manager.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/output-manager.test.ts)
- [`packages/coding-agent/test/task/result-summary.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/result-summary.test.ts)
- [`packages/coding-agent/test/task/structured-subagent.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/structured-subagent.test.ts)

### G

- [`packages/coding-agent/test/task/executor-irc-wake-yield-reset.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-irc-wake-yield-reset.test.ts)
- [`packages/coding-agent/test/task/peer-message-after-report.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/peer-message-after-report.test.ts)
- [`packages/coding-agent/test/task/subagent-irc-before-assignment.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/subagent-irc-before-assignment.test.ts)
- [`packages/coding-agent/test/tools/agent-message.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/tools/agent-message.test.ts)
- [`packages/coding-agent/test/tools/wait-structured.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/tools/wait-structured.test.ts)
- [`packages/coding-agent/test/tools/wait.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/tools/wait.test.ts)

### H

- [`packages/coding-agent/test/task/completion-probe-cost.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/completion-probe-cost.test.ts)
- [`packages/coding-agent/test/task/completion-probe-parse.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/completion-probe-parse.test.ts)
- [`packages/coding-agent/test/task/executor-probe-stage.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-probe-stage.test.ts)
- [`packages/coding-agent/test/task/executor-soft-budget.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-soft-budget.test.ts)
- [`packages/coding-agent/test/task/executor-wall-clock.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-wall-clock.test.ts)
- [`packages/coding-agent/test/task/subagent-cost-cap.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/subagent-cost-cap.test.ts)
- [`packages/coding-agent/test/task/task-guards.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/task-guards.test.ts)

### I

- [`packages/coding-agent/test/subagent-advisor.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/subagent-advisor.test.ts)
- [`packages/coding-agent/test/task/coordination-advisory.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/coordination-advisory.test.ts)
- [`packages/coding-agent/test/task/executor-exact-model.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-exact-model.test.ts)
- [`packages/coding-agent/test/task/executor-prewalk.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/executor-prewalk.test.ts)
- [`packages/coding-agent/test/task/model-approval.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/model-approval.test.ts)
- [`packages/coding-agent/test/task/prompt-cache-forks.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/prompt-cache-forks.test.ts)
- [`packages/coding-agent/test/task/prompt-cache-side-requests.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/prompt-cache-side-requests.test.ts)
- [`packages/coding-agent/test/task/prompt-cache.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/prompt-cache.test.ts)
- [`packages/coding-agent/test/task/spawn-advisory.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/spawn-advisory.test.ts)
- [`packages/coding-agent/test/task/subagent-fallback-context-window.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/subagent-fallback-context-window.test.ts)
- [`packages/coding-agent/test/task/tan-memory-recall.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/tan-memory-recall.test.ts)

### J

- [`packages/coding-agent/test/task/parallel.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/parallel.test.ts)
- [`packages/coding-agent/test/task/spawn-run.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/spawn-run.test.ts)
- [`packages/coding-agent/test/task/speculative-launch.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/speculative-launch.test.ts)
- [`packages/coding-agent/test/task/workpool.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/workpool.test.ts)

### K

- [`packages/coding-agent/test/sdk-preloaded-extensions-isolation.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/sdk-preloaded-extensions-isolation.test.ts)
- [`packages/coding-agent/test/task/failed-child-artifact.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/failed-child-artifact.test.ts)
- [`packages/coding-agent/test/task/isolation-ownership.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/isolation-ownership.test.ts)
- [`packages/coding-agent/test/task/isolation-release.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/isolation-release.test.ts)
- [`packages/coding-agent/test/task/ovnfs.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/ovnfs.test.ts)
- [`packages/coding-agent/test/task/worktree.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/worktree.test.ts)
- [`packages/coding-agent/test/tools/conflict-detect.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/tools/conflict-detect.test.ts)
- [`packages/coding-agent/test/tools/conflict-integration.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/tools/conflict-integration.test.ts)

### L

- [`packages/coding-agent/test/registry/agent-lifecycle.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/registry/agent-lifecycle.test.ts)
- [`packages/coding-agent/test/task/parked-subagent-prewalk-revive.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/parked-subagent-prewalk-revive.test.ts)
- [`packages/coding-agent/test/task/parked-subagent-session-release.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/parked-subagent-session-release.test.ts)
- [`packages/coding-agent/test/task/parked-subagent-shell-release.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/parked-subagent-shell-release.test.ts)
- [`packages/coding-agent/test/task/persisted-revive.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/persisted-revive.test.ts)
- [`packages/coding-agent/test/task/restore-revive.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/restore-revive.test.ts)
- [`packages/coding-agent/test/task/restore.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/restore.test.ts)
- [`packages/coding-agent/test/task/revived-subagent-extension-tools.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/revived-subagent-extension-tools.test.ts)
- [`packages/coding-agent/test/task/seance-artifact-lifecycle.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/seance-artifact-lifecycle.test.ts)
- [`packages/coding-agent/test/task/seance-runtime.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/seance-runtime.test.ts)
- [`packages/coding-agent/test/task/seance.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/task/seance.test.ts)

### M

- [`packages/tui/test/advisor-config-layout.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/advisor-config-layout.test.ts)
- [`packages/tui/test/advisor-config.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/advisor-config.test.ts)
- [`packages/tui/test/agent-hub-native.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/agent-hub-native.test.ts)
- [`packages/tui/test/agent-hub-projection.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/agent-hub-projection.test.ts)
- [`packages/tui/test/agents-hub.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/agents-hub.test.ts)
- [`packages/tui/test/task-artifact-rows-render.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/task-artifact-rows-render.test.ts)
- [`packages/tui/test/task-call-render.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/task-call-render.test.ts)
- [`packages/tui/test/task-nested-live-render.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/task-nested-live-render.test.ts)
- [`packages/tui/test/task-progress-render.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/task-progress-render.test.ts)
- [`packages/tui/test/task-render.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/task-render.test.ts)
- [`packages/tui/test/task-yield-shape-render.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/test/task-yield-shape-render.test.ts)

### N

- [`packages/coding-agent/test/rpc-steer-subagent.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/rpc-steer-subagent.test.ts)
- [`packages/coding-agent/test/rpc-subagents.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/rpc-subagents.test.ts)
- [`packages/coding-agent/test/thread/executor-routing.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/thread/executor-routing.test.ts)
- [`packages/coding-agent/test/thread/reviver-ledger.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/thread/reviver-ledger.test.ts)
- [`packages/coding-agent/test/thread/subagent-worker.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/thread/subagent-worker.test.ts)
- [`packages/coding-agent/test/thread/worker-subscriptions.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/thread/worker-subscriptions.test.ts)

### Evidence scope

The GitHub recursive tree plus raw files were fetched read-only. This source/test ledger contains 38 task source files and 71 task test files, with 100 upstream test files in these ledgers (102 including the yield cross-references below). Repository code is independently written against Pi public APIs; no OMP source, fixtures or prompt text is bundled. The tiny complete-resource-loader shape follows Pi’s published full-control example; see [provenance](provenance.md).

## Definition, yield and URI boundary cross-references

These shared host paths complete the task-domain ownership boundary: definition parsing/templates (A), structured yield (F) and addressable child/history artifacts with messaging (G/L). They are not imported into the Pi proof. Historical source lookup is adjacent to the settled no-migration/parent-lifetime scope.

- [`packages/coding-agent/src/discovery/helpers.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/discovery/helpers.ts)
- [`packages/coding-agent/src/internal-urls/agent-protocol.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/internal-urls/agent-protocol.ts)
- [`packages/coding-agent/src/internal-urls/history-protocol.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/internal-urls/history-protocol.ts)
- [`packages/coding-agent/src/prompts/agents/frontmatter.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/frontmatter.md)
- [`packages/coding-agent/src/prompts/agents/init.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/init.md)
- [`packages/coding-agent/src/prompts/agents/model-mention.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/model-mention.md)
- [`packages/coding-agent/src/prompts/agents/reviewer.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/reviewer.md)
- [`packages/coding-agent/src/prompts/agents/scout.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/scout.md)
- [`packages/coding-agent/src/prompts/agents/seance.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/seance.md)
- [`packages/coding-agent/src/prompts/agents/security-reviewer.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/security-reviewer.md)
- [`packages/coding-agent/src/prompts/agents/task.md`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/prompts/agents/task.md)
- [`packages/coding-agent/src/tools/yield.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/src/tools/yield.ts)
- [`packages/coding-agent/test/tools/yield-extraction.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/tools/yield-extraction.test.ts)
- [`packages/coding-agent/test/tools/yield.test.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/coding-agent/test/tools/yield.test.ts)
- [`packages/tui/src/tools/yield.ts`](https://github.com/can1357/oh-my-pi/blob/eda28eff97cf7a352fd3057a03581be1686dbc7a/packages/tui/src/tools/yield.ts)

## Revision-specific defaults to preserve or explicitly substitute

These are **OMP** defaults from `task/settings.ts`, not settings added to Pi. Protocol-host default layers can differ; project/subagent layers cannot grant authority.

- Bundled definitions: `scout`, `reviewer`, `security-reviewer`, `seance`, `task`, `sonic`; generic task uses `@task`, sonic uses `@smol`. Definition-specific tool/spawn/schema defaults still need translation, not copying prompt text.
- Batch enabled; file-backed tasks, structured task results, per-task effort and per-call model selection disabled by default. Eval agent/workpool retains structured yields independently; agent `structured: true` can opt in. Speculative launch enabled but only with auto-allow approval and no veto-capable lifecycle handlers.
- Max concurrent children 32 (0 unlimited); recursion depth 2 (negative unlimited); worker cap 4 (0 in-process). Fewer than 9 concurrent runs stay in-process; worker allowance increases at 9, 18, 36, 72 and workers expire after no runs/resident sessions for a minute. These placement constants are reference implementation detail; observable responsiveness/cleanup is the parity requirement.
- Wall clock unlimited (0); soft request budget 200, per-agent override, one wrap-up notice enabled and hard guard at 1.5×; default idle TTL 420000 ms (0 disables parking).
- Completion probe enabled only for root-parent interactive children: delays of 2, 5, 10, 30 minutes, then hourly; no print/RPC/ACP/SDK probes. Child LSP and generic-task prewalk disabled by default. Advisor is per-agent opt-in, not inherited from parent enablement.
- Isolation disabled unless allowed and requested; apply enabled, patch merge mode, generic commit messages; backend auto can select ovnfs or native copy strategy. Neither a separate cwd nor a `tools` allowlist establishes these filesystem semantics.

All defaults remain unimplemented except the deliberately narrower proof contract; none is silently replaced by the proof’s single-child/no-tools policy.
