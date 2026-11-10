# Delegation contract (Pi 1.5.2)

Reference for operators and extension/UI consumers. Authoritative types and execution registry: [`src/coordinator.ts`](../src/coordinator.ts); profiles/grants: [`src/profiles.ts`](../src/profiles.ts); finite policy: [`src/scheduling.ts`](../src/scheduling.ts); public model/auth adapter: [`src/model-adapter.ts`](../src/model-adapter.ts); model tool/lifecycle: [`src/extension.ts`](../src/extension.ts). These are native interfaces, not OMP/pi-subagents compatibility.

## Input and atomic preflight

`delegate_task` is **model-only**, both on the root and on explicitly spawn-enabled children. Native input accepts either:

```json
{"assignment":"Locate startup code","profile":"scout","background":false}
```

or an ordered batch:

```json
{"tasks":[{"assignment":"Locate startup code","profile":"scout"},{"assignment":"Review lifecycle tests","profile":"review","limits":{"requests":20}}],"background":true}
```

Exactly one shape is allowed; additional properties are rejected. Assignments must contain non-whitespace text. Each assignment accepts optional `spawn` (role allowlist, including `[]` to disable) and `limits` (`deadlineMs`, `requests`, `tools`, `depth`, `spawns`), each of which can only **narrow** the effective grants/limits. `background` belongs to the call, not individual batch items. Nested background calls are explicitly unsupported; use nested foreground.

Every profile/skill/tool/ancestor/limit/batch/queue check for the **whole batch** completes before any new registry identity, setup directory or SDK child is created. Invalid later entries cannot leave earlier launches. All inputs capture the same parent selected physical model, scope, auth registry, thinking level and cwd. Authentication/provider setup failures after admission are per-assignment failures, not rollback of other accepted work. No launch from incomplete/streamed JSON, file expansion or speculation exists.

## Profiles and explicit spawn grants

`Profile = {name,description,prompt,tools,skills,spawn?}`; omitted spawn is empty. `BuiltinTool` is `read|grep|find|ls|write|edit|bash`. Bundled `general`, `scout`, `review` grant the first four; `implementation` grants all seven. A profile narrowed to read-only tools needs no writer lease. All profiles default to **no recursive spawn authority**.

`resolveProfile(name,cwd,trusted,operatorDir?)` resolves bundled → operator → trusted project. Operator config is public `getAgentDir()/delegation.json`; trusted project config is `CONFIG_DIR_NAME/delegation.json`. Root keys are the four bundled profile names and optional `scheduling`. Profile keys: `description`, `prompt`, `tools`, `skills`, `spawn`. Absent arrays inherit; explicit `[]` removes grants. Operator tools can only narrow bundled tools. Operator skills grant exact absolute readable, distinct Pi skill Markdown files. Only the operator can mint spawn role grants:

```json
{
  "scheduling": {"concurrency":2,"depth":2,"spawns":4},
  "general": {"spawn":["general"]}
}
```

This permits a general child to delegate a general grandchild if one additional slot is available. It does not enable arbitrary tools, profiles, models or ambient resources. A trusted project may only narrow operator tools, skills, spawn roles and policy maximums; it cannot re-enable anything removed. Untrusted project config is ignored. Project prompt/description specialization never expands executable authority. Unknown fields, malformed selected profiles, missing skills and loader diagnostics fail visibly. Custom role names, executable extension/MCP grants and model/effort overrides remain unsupported.

Descendant preflight requires an active, non-cancelling ancestor, an explicitly granted target role, allowed absolute depth and remaining direct-child spawn count. Target tools, skills **and spawn role grants** must all be subsets of the delegating ancestor's effective grants; incompatible profiles reject rather than regain root authority. Request narrowing is inherited. Each child's admitted direct-child count is lifetime cumulative (including cancelled/failed children); rejected batches consume no spawn count.

## Capacity and bounded execution

`SchedulingPolicy` values are non-negative safe integers, except concurrency/batch/deadline/requests/tools must be positive. There is no unlimited sentinel.

| Field | Default | Operator ceiling | Meaning |
|---|---:|---:|---|
| `concurrency` | 2 | 16 | Active SDK children, including setup, waiting nested parents and draining |
| `queue` | 32 | 256 | Waiting assignments, accounting for writer/FIFO blocking as well as capacity |
| `batch` | 16 | 64 | Assignments admitted by one call |
| `depth` | 2 | 4 | Maximum absolute descendant depth (root child = 1); 0/1 disables nesting |
| `spawns` | 8 | 32 | Admitted direct children per child lifetime; 0 disables spawning |
| `deadlineMs` | 600000 | 3600000 | Per-task elapsed time from admission, including queue/setup/drain |
| `requests` | 100 | 1000 | Direct child dispatches into the parent model registry |
| `tools` | 100 | 1000 | Executable child tool invocations, including local delegation |

Operator `scheduling` can choose within ceilings; trusted project can only narrow operator values. Request `limits` can only narrow execution/depth/spawn values, not raise concurrency or queue capacity. Policy is resolved at invocation; changes affect subsequent admission/dequeue, not already running work or previously captured task limits. Reducing concurrency does not evict already admitted active children; no new setup starts until they drain below the new maximum.

One FIFO scheduler lives **inside the authoritative registry**, not in a second execution-state service. Identity allocation/order follows input order. Queue admission/dequeue is synchronous, before asynchronous SDK setup. A head writer waiting for its lease blocks later readers too: this conservative head-of-line policy prevents writer starvation. Parent model mutations already reserved at tool preflight reject a writer-containing batch before admission; otherwise sibling writers queue/serialize. Setup, running, nested waiting and draining each retain a permit until disposal.

### Nested allocation: no lending and no overcommit

A parent waiting in its child-local `delegate_task` retains its permit. Nested batches are admitted **only if the entire batch can dispatch immediately**, with no older queued assignment, sufficient free slots, and all required writer leases available. Otherwise they fail visibly before descendant setup (`Nested capacity unavailable; no permit lending`). This also prevents nested siblings waiting on a full pool. There is no borrowed capacity, hidden fanout or simulated completion. A writer descendant under any writer ancestor is rejected explicitly, even if capacity is free. Use a non-writing coordinator role or independent root batch instead. Child-local model-only tools are registered through public SDK `customTools`; they are not calls to the root's model-only tool via `ctx.executeTool`.

### Limit outcomes and cancellation

Limits are hard cancellation guards, not OMP soft-yield/wrap-up prompts. First committed limit reason (`deadline`, `requests`, `tools`) is retained; later timers cannot overwrite cancellation/settled outcomes. A limit produces final `status:"cancelled"`, `limitReason`, and an explanatory `error`. Queue deadline/stop cancels without SDK setup/transcript. Request guards check **before forwarding** to the parent's public registry. Counts include failed dispatches but not rejected over-limit dispatches, auth preflight or provider-internal retries/subrequests. Tool guards count entered, granted custom-tool executions, including permission-denied forwarded calls; malformed/unknown calls rejected by Pi before execution are not counted. Requests still bound loops of rejected tools.

Deadlines initiate abort; they do **not** promise a maximum drain time. Public auth/provider/permission code that ignores cancellation must return before setup/tools release their capacity/writer lease. No fake timeout races away from unabortable initialization, force-kills unrelated processes, or starts a replacement writer while old tools remain active. SDK-owned tool cancellation uses actual abort signals and public `abort()`/prompt completion. Abrupt process death is not recoverable cleanup.

## Public model/auth/resource boundary

`parentModelRuntime(context,agentDir,onRequest?)` creates a child runtime with empty `InMemoryCredentialStore`, `modelsPath:null`, scoped cache path and network catalog refresh disabled. A native provider lists only the selected parent model. Its `stream` and `streamSimple` forward into the **root parent's public ModelRegistry**, preserving configured provider composition, auth, headers, environment and OAuth refresh. Preflight uses public `hasConfiguredAuth` and `getApiKeyAndHeaders`; values are never copied to artifacts. Every descendant uses this same captured public adapter. No fallback model/cost substitution or private imports. Unsupported `pi-virtual` routing fails visibly because faithful child router reconstruction is not public.

`childResources(prompt,skills)` owns the complete loader. It supplies only the role prompt and explicit skill metadata, with empty extensions/MCP/context files/prompts/themes. Automatic compaction/retry are disabled. Each child shares parent cwd, with separate scoped agent/cache/transcript directories. This is **not a sandbox** against arbitrary JavaScript, process environment access or hostile code.

Required root tools must be callable, genuine `builtin:<name>` tools (not overrides). Descendant builtin definitions forward only their admitted tool names through the original parent's public `ctx.executeTool`, retaining schema validation, operator permission hooks, activation revocation and nested-call IDs. They do not call raw builtin `execute` implementations. Local `delegate_task` receives normal SDK model-tool validation/exposure and then full policy/ancestor admission checks; no parent model-only exposure is bypassed. No root ambient tools/skills are handed to descendants.

## Registry, controls and final delivery

`DelegationCoordinator(root,parentId)` owns all generations/entries. Public seams:

- `ChildRef = {id:string,generation:number}`. UUIDs never reused, generation starts at 1. Controls reject unknown/stale references; no revival/replacement API.
- `ChildSnapshot`: identity, real `parentId`, absolute `depth`, `status`, profile, assignment, activity, bounded progress (4096 characters), final text, model/effort, direct `telemetry`, optional error/transcript, `limits`, `limitReason?`, `toolCalls`, `writerLease`, and `disposed`.
- Lifecycle: `queued → setup → running → settled|failed|cancelled`; cancellation of active work exposes `draining` until it actually ends. Queued work can cancel directly. `disposed` and `writerLease` are resource facts, not guessed outcomes. Parents cannot finalize/dispose before descendants/tools drain.
- `RegistryEvent = {type:"changed"|"sdk",child,event?:AgentSessionEvent}`. Detached snapshots; observer exceptions cannot fail execution. `subscribe` returns unsubscribe. `list()` retains admission order; `snapshot(ref?)` selects a pinned identity or latest entry. Pi event bus `delegation:registry` exposes the same events, including disposal at shutdown. Consumers unsubscribe on runtime replacement.
- `configure(policy)` validates finite scheduler policy. `admit(StartTask[])` synchronously validates the whole batch and returns ordered identities; `start(StartTask)` is the single helper, awaiting abortable setup if dispatched immediately, otherwise acknowledging queued admission. Model tool uses `admit` for both input shapes.
- `wait(ref)` resolves the final snapshot after disposal, including setup failure; `stop(ref)` aborts and drains a subtree. `stopMany(refs)` marks the entire cancellation set before any sibling dequeue and then drains it; already settled results are preserved. Repeated stop is harmless. `steer(ref,text)` requires running state and uses Pi `queued|handled` semantics.
- `shutdown()` closes admission/dequeue immediately, cancels/drains/disposes all entries and clears observers idempotently. Bare SDK `session.dispose()` does not replace host lifecycle dispatch. `reopenTranscript(ref)` inspects a new transcript; it does not revive work.

Prompt resolution, not low-level `agent_end`, accepts final results after SDK work settles. SDK assistant errors/setup exceptions are failed; abort/limit/shutdown intent cannot become success. Failure of one admitted assignment **does not cancel unrelated batch siblings**: every input receives its own outcome. Caller foreground cancellation marks all unsettled assignments then drains their subtrees; settled outcomes remain settled. Operator stop targets only its pinned subtree.

Foreground returns one ordered final batch (single input returns one snapshot). Partial tool updates are observations, not final deliveries. Background returns ordered accepted snapshots/identities immediately (possibly queued/setup), and emits **one final custom message per call**, containing all ordered outcomes after disposal. It does not also deliver per-item completion messages. Background no longer follows the initiating tool's signal after acceptance; stop/shutdown still own it. Old-runtime shutdown suppresses its final custom delivery; work never survives reload. Output previews use Pi 50KB/2000-line truncation. Tool `details` retain full snapshots/transcript references (`ChildSnapshot` for single, `{children:ChildSnapshot[]}` for batch); full model/tool evidence is in actual SDK JSONL, not a structured artifact/yield protocol.

Commands remain `/task-profiles`, `/task-status [id generation]`, `/task-stop id generation`, `/task-steer id generation text`, `/task-hub`. Hub/widget are latest-entry observers only; queued/draining states and actual writer lease are shown, with no fabricated finished state or full tree UI.

### Direct versus subtree telemetry

`telemetry = {requests:number|null,tokens:SessionStats["tokens"]|null,cost:number|null,context:ContextUsage|null}`. Null means unavailable, not zero; genuine reported zero stays zero. Token/cost/context values are SDK-reported; no precision promise for billing or provider internals. Request counts are direct registry dispatches for that entry. Each descendant has its **own direct telemetry**; ancestors never absorb descendant charges as tool `usage`. Sum direct registry values once across the chosen subtree. Parent tool usage/footer is not an aggregate delegation bill. No subtree total is synthesized.

## Writer coordination and unsupported shell boundary

Only `writerLease:true` identifies actual writer ownership. Queue entries hold no writer lease. `parentToolStart(id,name,readOnly?)` reserves model mutations at preflight and `parentToolEnd(id)` releases on every finalized call (including blocked calls). Only genuine builtin read/grep/find/ls are exempt. Parent mutations reject while a child owns the writer; that writer's own forwarded permitted calls are recognized by public parent-tool-call ID prefix and continue through ordinary hooks. Batch siblings share the original root dispatcher context but only the admitted writer can expose mutating tools. Parent permissions and readonly tool hooks remain unchanged.

**Manual `!`/`!!`, external terminals/editors, unrelated sessions and arbitrary extension JavaScript remain uncoordinated.** Operators must not perform conflicting writes while children write. Pi 1.5.2 has no public interactive-shell completion notification; no wrappers, global shell bans, in-flight inference or OS lock are installed. A shared cwd is not filesystem isolation/apply.

## Storage and future UI integration

Only new `delegation/<parent-id>/<task-id>/{agent,transcripts}` data under the parent session directory is created. Historical proof/run data is never read, mutated or migrated. Registry lifetime is the parent runtime; no durable recovery/parking/revival is claimed. New transcripts may contain sensitive task/tool/model content and should be treated like parent transcripts.

The independent UI slice (#4) is not a prerequisite and is not copied here. On later integration, its fleet filters/roster/status styling must include `queued` and `draining`, show the real `parentId`/`depth` tree, use observed `writerLease` rather than profile-name inference, display limits/reasons without treating cancellation as a successful finish, retain every ordered batch identity in result details, and sum direct telemetry once (not parent-plus-subtree). Its admission `createdAt`, disposal `endedAt` and finalized-message inspection seams can compose with these registry states; no duplicate roster/transcript UI is added here. Steering/stop must continue pinning original UUID+generation rather than retargeting latest/filter selection.

Unsupported: structured yield/schema/artifacts, peer messaging/wait/idle follow-up, parking/revival, isolation/apply, advisor/prewalk/model routing/probes/speculation/workpool, executable extension/MCP grants, unlimited recursion/concurrency, provider-internal request accounting or full observability UI. OMP is a pinned behavioral reference, not an imported runtime/prompt implementation.
