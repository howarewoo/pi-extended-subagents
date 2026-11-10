# Slice 1 delegation contract (Pi 1.5.2)

Reference for extension/UI/scheduler implementers. The authoritative exported types are in [`src/coordinator.ts`](../src/coordinator.ts), policy in [`src/profiles.ts`](../src/profiles.ts), model adaptation in [`src/model-adapter.ts`](../src/model-adapter.ts), and Pi entrypoints in [`src/extension.ts`](../src/extension.ts). These are new native interfaces, not pi-subagents/OMP wire compatibility.

## Profiles and preflight

`Profile = {name,description,prompt,tools,skills}`. `BuiltinTool` is `read|grep|find|ls|write|edit|bash`. Bundled `general`, `scout`, `review` grant the first four; `implementation` grants all seven and acquires the exclusive model-tool-mediated writer lease. `bundledProfiles()` / `/task-profiles` list bundled definitions and explicitly describe manual shells as uncoordinated. A profile narrowed to read-only tools needs no writer lease. Additional executable extensions, MCP, model/effort overrides, custom definition names and inherited agent roots are unsupported and rejected. No child receives `delegate_task`; nested delegation is disabled.

`resolveProfile(name,cwd,trusted,operatorDir?)` resolves bundled → operator → trusted project. Operator root is public `getAgentDir()/delegation.json`; project root is public `CONFIG_DIR_NAME/delegation.json`. Files are JSON objects keyed by the four profile names. Per-profile supported keys are `description`, `prompt`, `tools`, `skills`. Absent arrays inherit; explicit `[]` removes all. Operator tools can only narrow bundled grants; operator skills are exact absolute, readable, distinct Pi skill Markdown files. Project tools/skills must be subsets of the operator-resolved grants, never ambient names/paths. Project prompt/description can specialize instructions but never expand executable authority. Malformed/unknown keys, missing skills and Pi skill diagnostics reject the selected profile before child creation. Untrusted project config is not honored.

Tool input has required `assignment:string`, `profile:general|scout|review|implementation`, optional `background:boolean` (default foreground), and denies additional properties. Empty/whitespace assignment is rejected. All selected parent tools must be callable and have genuine `builtin:<name>` metadata; overridden tools are not silently substituted. Parent permission hooks still run through `ctx.executeTool`. Tool activation revocation after launch can therefore also deny a later child call.

Parent model is captured per invocation, including effective thinking level; no role/model routing is changed. Selected model must exist in the parent's public registry/provider, have configured authentication and belong to its scope if scoped models are nonempty. `pi-virtual` selections are rejected explicitly: the public registry does not expose faithful per-child router-state reconstruction through `createAgentSession(ModelRuntime)`.

## Public model/auth adapter

`parentModelRuntime(context,agentDir,onRequest?)` creates a child `ModelRuntime` with empty `InMemoryCredentialStore`, `modelsPath:null`, scoped cache path, and network catalog refresh disabled. It registers a native provider listing only the selected parent model. Its `stream` and `streamSimple` forward to the **parent's public ModelRegistry** with the child context/options; the registry owns request-time provider composition, API keys, headers, provider-scoped environment and OAuth refresh. Preflight uses `hasConfiguredAuth` and `getApiKeyAndHeaders` but never writes those values to artifacts. There is no private-runtime access, copied auth file, imported Pi internal module or fallback model. Actual requests still incur normal provider charges in production.

`childResources(prompt,skills)` owns the complete loader, not a filter applied after discovery. It supplies the role prompt, explicitly granted Pi skill metadata, and empty extensions/MCP connector/context files/prompts/themes. Child settings are in-memory with automatic compaction/retry disabled. Each SDK child shares parent cwd and gets its own agent/cache/transcript directory. Tools are registered as forwarding definitions, not raw built-in execute calls, so parent validation and permission hooks are retained. Background dispatch uses an explicit child abort signal and remains bound to the parent's live extension runtime.

## Registry and observable events

`DelegationCoordinator(root,parentId)` owns execution. It exports:

- `ChildRef = {id:string,generation:number}`. IDs are UUIDs, never reused; generation currently starts at 1. All identity controls reject unknown IDs or mismatched generations. There is no replacement/revival API.
- `ChildSnapshot`: identity plus `parentId`, `status`, `profile`, original `assignment`, current `activity`, bounded latest `progress` (4096 characters), final `result`, selected `model:{provider,id}`, `effort:string|null`, `telemetry`, optional `error`/`transcript`, and `disposed:boolean`.
- Lifecycle `setup → running → settled|failed|cancelled`. Setup can fail/cancel directly. `disposed` is a resource fact, not another outcome. Disposal occurs after terminal prompt completion/drain and releases writer ownership.
- `RegistryEvent = {type:"changed"|"sdk",child:ChildSnapshot,event?:AgentSessionEvent}`. `subscribe(listener)` returns an unsubscribe function. Snapshots are detached copies; observer exceptions do not own or fail execution. SDK events include real message/tool updates, not simulated activity.
- Pi event bus channel **`delegation:registry`** emits those registry events for this parent runtime. It includes terminal/disposed events during shutdown; old runtime emission stops before replacement startup. Subscribers must unsubscribe across reload and must not persist raw events as a credential/logging service.

`list()` returns all snapshots; `snapshot(ref?)` returns the requested entry, or latest entry/undefined. `start(StartTask)` accepts `{assignment,profile,skills,context:ExtensionToolContext,callerId}` after policy resolution; it acknowledges only once startup is abortable (or setup/run has already ended). `steer(ref,text)` requires a running child and returns Pi's `queued|handled`. `stop(ref)` cancels, waits setup/abort/run and disposes; repeated stop is harmless. `wait(ref)` returns the final snapshot after disposal. `shutdown()` closes admission immediately, aborts/drains all entries, disposes and clears observers idempotently. `reopenTranscript(ref)` is inspection of the new SDK transcript, not revival.

`agent_end` is forwarded as a **low-level SDK event only**; it never accepts the final result. Acceptance uses `session.prompt()` resolution after Pi's settled work. Final assistant error/abort becomes failed/cancelled. Setup/prompt exceptions remain visible. Shutdown intent cannot later turn into success. UI closing only unsubscribes its observer and never changes execution. There is one authoritative registry, no separate UI/scheduler execution state.

### Telemetry semantics

`telemetry = {requests:number|null,tokens:SessionStats["tokens"]|null,cost:number|null,context:ContextUsage|null}`. Null means not yet available/unknown, not zero. `requests` counts **direct dispatches to the parent registry** for this child, including dispatched failures; it does not claim to count provider-internal retries/subrequests. Token/cost fields come from SDK `getSessionStats()` after finalized assistant messages and at prompt completion. Genuine SDK-reported zeros remain zeros (the controlled provider reports zero usage). Context comes from SDK `getContextUsage()` and may itself contain unknown or estimated values; it is not a fabricated percentage. Aborted-before-message totals stay unknown when no assistant usage exists.

There is no child subtree because nesting is disabled. Child usage is not also returned as parent tool `usage`; consumers must sum registry **direct child totals once**, not parent-plus-subtree totals. The normal Pi parent footer is not an aggregate child-cost display. No provider billing accuracy or internal request accounting parity is claimed.

## Controls and delivery

- Model tool `delegate_task` is `model-only`: not reachable through other tools/codemode. Pi's native extension registration reports conflicting tool names; it does not override another extension silently.
- Foreground waits and returns one final snapshot/text. Partial tool updates are observations, not terminal deliveries.
- Background returns identity/status and schedules one final `delegation` custom message once `wait` resolves, without explicitly triggering a model turn. Shutdown suppresses late delivery into the old/replacement parent. Work is not detached from parent lifetime.
- `/task-profiles`: show bundled profiles/availability; `/task-status [<id> <generation>]`: display snapshots; `/task-steer <id> <generation> <text>`: queue steering; `/task-stop <id> <generation>`: cancel and drain; `/task-hub`: latest-entry TUI observer. No proof command aliases remain.
- Result/status previews use Pi's 50KB/2000-line truncation; identity/details and registry retain the transcript reference and full final text. Full assistant/tool data lives in the new JSONL transcript. This is not a generalized artifact protocol.

## Writer coordination and unsupported shell boundary

`parentToolStart(id,name,readOnly?)` reserves parent mutation at tool preflight; `parentToolEnd(id)` releases on every finalized execution, including blocked calls. Only genuine built-in read/grep/find/ls are exempt; unknown/unrestricted shell tools are not assumed read-only. Child calls are recognized by the public nested parent-tool-call ID prefix. Writer admission reserves one child lease synchronously before asynchronous SDK setup; it rejects when another child writer or a parent mutation is in flight. Parent mutation calls reject while that child writer is active, but that writer's own nested permitted calls proceed through ordinary hooks. Parent siblings are conservatively reserved during preflight, so launching beside a pending parent write cannot race it. Read-only child invocations may coexist.

**Manual `!`/`!!` commands are explicitly outside this guarantee**, like external terminals/editors/unrelated Pi sessions. The operator must not run conflicting manual/external writes while children write. This user-approved boundary avoids unsupported shell-completion inference: Pi 1.5.2 has no public completion notification, wrappers can skip later permission hooks, and earlier handlers may stop propagation. No manual-shell interception, blanket writer rejection, first-shell hazard, reload heuristic or force flag exists. Production implementation-profile tasks are enabled; model-tool coordination remains enforced before and after reload. Widget/overlay writer hints repeat the warning.

Arbitrary extension JavaScript is also outside model-tool-mediated coordination. No OS sandbox, process-wide lock, filesystem isolation/apply, external process suppression or crash recovery is provided.

## Storage and downstream seams

Only new `delegation/<parent-id>/<task-id>/{agent,transcripts}` data under the parent session directory is created. Historical proof/old-run roots are not read, mutated or migrated. In-memory registry state is parent-lifetime only. Parent shutdown/reload owns abort/drain/dispose; bare SDK `dispose()` alone does not emit extension shutdown. Crash/SIGKILL cannot be cleaned up by a hook.

Slice 2 can observe `list/snapshot/subscribe` or `delegation:registry` and use identity controls without owning work. Slice 3 may build scheduling on this coordinator but must first reconcile capacity, admission and any future generation/replacement contract; no batch, nested task, queue, yield, peer messaging/wait, parking/revival, isolation/apply, advisor or speculation mechanism is hidden in this slice.
