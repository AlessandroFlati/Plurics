# Node Runtimes — Phase 3 Implementation Spec

**Date:** 2026-04-12
**Status:** Approved for implementation
**Scope:** Full tool-calling loop — tool definition generation, toolset resolution, per-tool retry budget, max turns, final answer parsing, corrective re-prompt, `sendToolResults` implementation in all three backends, legacy backend removal
**Parent documents:** `docs/design/node-runtimes.md` §4.3, §4.4, §6, §7; `HIGH_LEVEL_DESIGN.md`; `MANIFESTO.md`
**Prerequisites:** Tool Registry Phase 1+2 merged; TR Phase 3 pilot merged (10 seed tools loaded); NR Phase 1 merged (`AgentBackend` interface, `kind` field, DAG dispatcher); NR Phase 2 merged (`ValueStore`, pickle round-trip, handle-based value passing). Test baseline: 264 passing / 0 failing / 6 skipped.

---

## 1. Context and Purpose

Node Runtimes Phase 1 introduced the `AgentBackend` interface with three concrete implementations (`ClaudeBackend`, `OpenAICompatBackend`, `OllamaBackend`) and a preserved legacy path (`LegacyAgentBackend`) via Option A compat. `sendToolResults` throws `'not_implemented'` in all three new backends; `toolDefinitions` arrays are always empty; `dispatchNewReasoningNode` in `dag-executor.ts` issues a single `sendMessage` call and parses the response as a complete signal — no tool loop exists.

NR Phase 2 added the `ValueStore` with handle-based structured value passing between tool nodes. The run-level store is threaded through `RegistryClient.invoke()` and `dag-executor.ts`. Reasoning nodes stub the scope-local tier as an alias to the run-level store.

Phase 3 closes the remaining gap: it wires the new backends into a real tool-calling loop, generates backend-specific tool definitions from registry manifests, resolves `toolset` declarations against the registry, implements per-tool retry budgets and max-turns safety mechanisms, parses final answers via fenced signal blocks, and removes the legacy PTY path that Phase 1 kept alive.

At the end of this slice:

- A `kind: reasoning` node with `backend: claude`, a `toolset` declaration, and a purpose preset runs the full multi-turn tool-calling loop against the Anthropic API.
- The loop dispatches tool calls through `RegistryClient.invoke()`, stores structured results in a scope-local `ValueStore`, returns handles and summaries to the LLM, and continues until a final answer is produced or safety limits are hit.
- `sendToolResults` is implemented in all three backends.
- All five existing workflows are migrated off `backend: claude-code` and `backend: process`.
- `claude-code-session.ts`, `process-session.ts`, `local-llm-session.ts`, and `node-pty` are deleted.
- Test baseline holds or improves; tsc remains clean.

---

## 2. In Scope

- `packages/server/src/modules/agents/toolset-resolver.ts` — new module; resolves `toolset` YAML entries to `ToolDefinition[]` via registry, generates backend-specific wire formats.
- `packages/server/src/modules/agents/reasoning-runtime.ts` — new module; the tool-calling loop, per-tool retry budget, max-turns, final answer extraction, corrective re-prompt.
- `sendToolResults` implementation in `claude-backend.ts`, `openai-compat-backend.ts`, `ollama-backend.ts`.
- Scope-local `ValueStore` per reasoning node invocation; scope created on node start, destroyed (with declared outputs promoted to run-level) on node completion.
- `dispatchNewReasoningNode` in `dag-executor.ts` replaced by a call to `runReasoningNode(...)` from `reasoning-runtime.ts`.
- Workflow YAML migration: `research-swarm`, `theorem-prover-mini`, `smoke-test`, `math-discovery`, `sequence-explorer` — all nodes migrated to `backend: claude` or `backend: ollama` with explicit `toolset` declarations.
- Legacy file deletion: `claude-code-session.ts`, `process-session.ts`, `local-llm-session.ts`.
- `agent-backend.ts`: remove `LegacyAgentBackend` interface, `BackendType`, `AgentConfig`, `AgentResult`, `AgentArtifact`, `AgentInfo` exports and all `@deprecated` code.
- `agent-registry.ts`: remove legacy dispatch paths.
- `dag-executor.ts`: remove legacy dispatch paths, `waitForOutput`, chokidar workarounds.
- `package.json`: remove `node-pty` dependency.
- Error taxonomy extensions (new error categories for Phase 3 failures).
- Unit tests (mocked backends) and integration tests.

## 3. Out of Scope (Deferred)

- **Value store scope isolation** (Phase 3b if needed): Phase 2 aliased scope-local to run-level. Phase 3 creates a proper scope-local store per reasoning node invocation, copies declared outputs to run-level on completion, and destroys the rest. This IS in scope for Phase 3 (see Section 8.3). If implementation complexity exceeds budget, deferring to Phase 3b is acceptable with a documented stub.
- **Context window compaction**: if the LLM's context window fills during a long tool loop, the node fails with `context_exceeded`. Automatic summarization/compaction is a future feature.
- **Converter insertion** (automatic type coercion between mismatched tool inputs/outputs): Tool Registry Phase 4.
- **MCP bridge**: future.
- **Multi-user handle signing**: future.
- **Run-level value store cleanup / retention policy**: already deferred in NR Phase 2; still deferred.

---

## 4. Design Decision Resolutions

**A — Tool definition generation: option (a1), shared resolver + per-backend translation.**
`toolset-resolver.ts` queries the registry and produces backend-neutral `ToolDefinition[]`. Each backend's `startConversation` translates `ToolDefinition[]` into its wire format (Anthropic / OpenAI / Ollama). Registry resolution is shared; wire-format serialization is per-backend. The `ConversationState` in each backend stores the tools array and includes it in every API request.

**B — Tool-calling loop location: `reasoning-runtime.ts`.**
The loop lives in `packages/server/src/modules/agents/reasoning-runtime.ts`. It imports the backend, the toolset resolver, the registry client, and the value store. The DAG executor calls `runReasoningNode(params)` from this module. `dispatchNewReasoningNode` in `dag-executor.ts` is deleted and replaced by a single `await runReasoningNode(...)` call.

**C — Legacy removal timing: last 3 tasks, after smoke tests pass.**
Workflow migration happens first. After all five workflows run successfully on new backends and smoke tests pass, the legacy files are deleted. This ensures there is a working state before deletion.

**D — Signal block extraction: regex on last fenced signal block.**
The extractor uses `/(```signal\n)([\s\S]*?)(\n```)/g` to find all signal blocks in the LLM's final response. If multiple blocks are found, the last one is used. The extracted JSON is validated against the `SignalFile` schema. If parsing fails, the corrective re-prompt is issued.

**E — `lean_check` and `process` nodes: keep as `kind: reasoning` with empty toolsets.**
Nodes that were `backend: process` (e.g., `lean_check` in `theorem-prover-mini`, `echo_node` in `smoke-test`) are migrated to `kind: reasoning` with `backend: ollama` or `backend: claude` and an empty `toolset: []`. They are not converted to `kind: tool` nodes because they require judgment about whether the process output constitutes success. A future `process` backend may handle this case more cleanly. For now they run the single-turn path (no tool calls with empty toolset), emit a signal from their preset.

---

## 5. Tool Definition Generation

### 5.1 Toolset Resolver (`toolset-resolver.ts`)

The resolver translates a YAML `toolset` block into a concrete `ToolRecord[]` from the registry, then into `ToolDefinition[]` for the backend.

**Toolset entry types:**

```yaml
toolset:
  - category: descriptive_statistics     # all tools in category
  - name: sklearn.pca                    # exact match
  - name: "statistics.*"                 # glob pattern
```

**Resolution algorithm:**

1. For each entry in the `toolset` array:
   - If `category` is present: call `registryClient.listToolsByCategory(category)` → `ToolRecord[]`.
   - If `name` is present and contains no wildcard: call `registryClient.getTool(name)` → `ToolRecord | null`. If null, throw `ResolverError` with category `tool_not_found`.
   - If `name` contains `*` or `?`: call `registryClient.listTools()`, filter by glob match using `micromatch` (already a transitive dependency or add it). If zero matches, throw `ResolverError` with category `toolset_empty_glob`.
2. Deduplicate across entries by `tool.name`.
3. Translate each `ToolRecord` to a `ToolDefinition`:
   - `name`: replace all `.` with `_` in the tool name.
   - `description`: take from `ToolRecord.description`.
   - `inputSchema`: build a `JsonSchema` from `ToolRecord.inputs`:
     - Primitive schema types map to JSON Schema primitives: `Integer` → `"integer"`, `Float` → `"number"`, `Boolean` → `"boolean"`, `String` → `"string"`, `JsonValue` → `"object"`, `FilePath` → `"string"` with description suffix `"(file path)"`.
     - Structured schemas (`DataFrame`, `NumpyArray`, `SymbolicExpr`) map to `"object"` with the schema name embedded in the description: `"NumpyArray. Pass a value_ref handle from a prior tool call."`.
     - `required`: all input ports where `ToolRecord.inputs[port].required === true`.
4. Return `ToolDefinition[]`.

**Name translation registry:** the resolver keeps a `Map<string, string>` of `underscore_name → dotted.name` for reverse lookup at dispatch time. This map is passed to `reasoning-runtime.ts` alongside the tool definitions.

### 5.2 Per-Backend Wire Formats

**`claude` backend (Anthropic tool_use):**

```json
{
  "name": "sklearn_pca",
  "description": "Principal Component Analysis via scikit-learn...",
  "input_schema": {
    "type": "object",
    "properties": {
      "matrix": { "type": "object", "description": "NumpyArray. Pass a value_ref handle." },
      "n_components": { "type": "integer", "description": "Number of PCA components." }
    },
    "required": ["matrix"]
  }
}
```

Sent as the `tools` array in the Anthropic `/v1/messages` request body. `ConversationState` gains a `tools` field populated in `startConversation`.

**`openai-compat` backend (OpenAI function calling):**

```json
{
  "type": "function",
  "function": {
    "name": "sklearn_pca",
    "description": "Principal Component Analysis via scikit-learn...",
    "parameters": {
      "type": "object",
      "properties": { ... },
      "required": ["matrix"]
    }
  }
}
```

Sent as the `tools` array in `/v1/chat/completions`. `tool_choice` is omitted (defaults to `"auto"`).

**`ollama` backend (Ollama native tool format):**

Same structure as OpenAI function calling, sent in the `tools` field of `/api/chat`. The Ollama native API mirrors the OpenAI tool structure since Ollama 0.4.x.

### 5.3 `ConversationHandle` Extension

`ConversationState` in all three backends gains:

```typescript
interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  messages: BackendMessage[];   // full message history (user, assistant, tool_result)
  tools: unknown[];             // backend-specific wire-format tool definitions
}
```

`startConversation` stores the backend-formatted tools in `state.tools` and includes them in every API call.

---

## 6. The Tool-Calling Loop (`reasoning-runtime.ts`)

### 6.1 Public API

```typescript
export interface ReasoningNodeParams {
  backend: AgentBackend;
  toolDefinitions: ToolDefinition[];
  toolNameMap: Map<string, string>;    // underscore_name → dotted.name
  registryClient: RegistryClient;
  valueStore: ValueStore;              // scope-local store for this node
  runId: string;
  nodeName: string;
  purpose: string;                     // resolved purpose markdown
  systemPrompt: string;
  model: string;
  maxTokens?: number;
  maxTurns?: number;                   // default 20
  perToolRetryBudget?: number;         // default 3
  wallClockTimeoutMs?: number;         // default 900_000
}

export interface ReasoningNodeResult {
  signal: SignalFile;
  reasoningTrace: string;              // full LLM response chain for logging
  turnsUsed: number;
  toolCallsTotal: number;
}

export async function runReasoningNode(
  params: ReasoningNodeParams,
): Promise<ReasoningNodeResult>;
```

### 6.2 State Machine

```
START
  │
  ▼
startConversation(systemPrompt, toolDefinitions, model, maxTokens)
  │
  ▼
sendMessage(purpose) ────────────────────────────────────────────►─┐
  │                                                                  │
  ▼                                                                  │
[response has tool calls?] ─── NO ──► parseSignal ──► DONE         │
  │ YES                                                              │
  ▼                                                                  │
[turn >= maxTurns?] ─── YES ──► inject budget message              │
  │                              │                                   │
  │ NO                           ▼                                   │
  │                         sendMessage(budget_msg)                 │
  │                              │                                   │
  │                         [has tool calls?] ── YES ─► FAIL        │
  │                              │ NO                 max_turns_exceeded
  │                              ▼                                   │
  │                         parseSignal ──► DONE                    │
  ▼                                                                  │
dispatchToolCalls(toolCalls) ◄─────────────────────────────────────┘
  │
  ├── for each toolCall:
  │     lookup dotted name via toolNameMap
  │     validate tool is in resolved toolset
  │     resolve value_ref handles from valueStore
  │     registryClient.invoke(toolName, inputs, {valueStore})
  │     on success: store structured outputs in valueStore
  │     on failure: record consecutive failure count
  │       if consecutiveFailures[tool] >= perToolRetryBudget:
  │         return special error result to LLM ("do not retry")
  │
  ▼
sendToolResults(toolResults) ──► loop back to [response has tool calls?]
```

### 6.3 Per-Tool Retry Budget

The runtime maintains:

```typescript
const consecutiveFailures = new Map<string, number>();  // dotted tool name → count
```

On each tool call:
- If the call **succeeds**: reset `consecutiveFailures.set(toolName, 0)`.
- If the call **fails**: increment `consecutiveFailures.get(toolName) ?? 0 + 1`.
  - If count reaches `perToolRetryBudget` (default 3): return the following error string as the tool result content, with `isError: true`:
    ```
    BUDGET_EXHAUSTED: This tool has failed 3 consecutive times. Do not call it again in
    this session. Try a different approach or proceed without this tool's output.
    ```
  - Otherwise: return the normal error as the tool result content.

The per-tool budget is reset when the reasoning node starts (it is not shared across turns or nodes).

### 6.4 Max Turns

`turn` is incremented each time `sendMessage` or `sendToolResults` returns. When `turn === maxTurns`:

1. Inject a user message (sent via `sendMessage`, NOT `sendToolResults`):
   ```
   You have reached your turn budget. Please produce your final answer now,
   with a properly formatted signal block at the end. Do not make any more tool calls.
   ```
2. If the response has no tool calls → proceed to `parseSignal`.
3. If the response still contains tool calls → fail the node with `max_turns_exceeded`.

### 6.5 Wall Clock Timeout

`runReasoningNode` wraps the entire loop in a `Promise.race` against a timeout:

```typescript
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new ReasoningError('wall_clock_timeout', ...)), params.wallClockTimeoutMs ?? 900_000)
);
return Promise.race([loopPromise, timeoutPromise]);
```

On `wall_clock_timeout`, the node fails with the corresponding error category. The `closeConversation` cleanup runs in a `finally` block regardless.

---

## 7. Final Answer Parsing

### 7.1 Signal Block Extraction

When the LLM response has no tool calls, extract the signal block:

```typescript
const SIGNAL_BLOCK_RE = /```signal\n([\s\S]*?)\n```/g;

function extractSignalBlock(text: string): string | null {
  const matches = [...text.matchAll(SIGNAL_BLOCK_RE)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];  // use last match
}
```

Parse the extracted string as JSON. Validate against the `SignalFile` schema (requires `status`, `agent`, `outputs`). If validation passes, return the `SignalFile`.

### 7.2 Corrective Re-Prompt

If `extractSignalBlock` returns null or JSON validation fails:

1. Send a corrective user message via `sendMessage`:
   ```
   Your last response did not contain a valid signal block. Please produce your
   final answer again. Your response MUST end with a properly formatted signal
   block in a fenced code block tagged `signal`, containing valid JSON with
   `status`, `agent`, and `outputs` fields.
   ```
2. If the new response has no tool calls and a valid signal block → succeed.
3. If the new response has no tool calls but still no valid signal → fail with `signal_parse_error`.
4. If the new response has tool calls → continue the tool loop normally (the LLM decided it needed more information before answering; this is acceptable).

The corrective re-prompt is issued at most once per reasoning node invocation. A second failure is always `signal_parse_error`.

---

## 8. `sendToolResults` Implementation

### 8.1 Claude Backend

The Anthropic API expects tool results embedded in the conversation as a `user` message with `content` being an array of `tool_result` blocks:

```typescript
async sendToolResults(
  conversation: ConversationHandle,
  toolResults: ToolResult[],
): Promise<AssistantMessage> {
  const state = this.getConversationState(conversation);

  const toolResultBlocks = toolResults.map(r => ({
    type: 'tool_result',
    tool_use_id: r.toolCallId,
    content: r.content,
    ...(r.isError && { is_error: true }),
  }));

  state.messages.push({ role: 'user', content: toolResultBlocks });

  const body = {
    model: state.model,
    max_tokens: state.maxTokens,
    system: state.systemPrompt,
    tools: state.tools,
    messages: state.messages,
  };
  // ... fetch /v1/messages, parse tool_use and text blocks ...
}
```

The response is parsed for both text blocks and `tool_use` blocks. `AssistantMessage.toolCalls` is populated from `tool_use` blocks, each mapped to `ToolCall { toolCallId, toolName (underscore), inputs }`. The full content array (text + tool_use) is pushed onto `state.messages` as an `assistant` message.

### 8.2 `AssistantMessage` response parsing (Claude)

The Anthropic response `content` array can contain a mix of `text` and `tool_use` blocks. After Phase 3:

```typescript
const textBlocks = data.content.filter(c => c.type === 'text');
const toolUseBlocks = data.content.filter(c => c.type === 'tool_use');

const assistantText = textBlocks.map(b => b.text).join('');
const toolCalls: ToolCall[] = toolUseBlocks.map(b => ({
  toolCallId: b.id,
  toolName: b.name,           // still underscore form here; resolved in runtime
  inputs: b.input as Record<string, unknown>,
}));

// Push full content array to history (not just text), so tool_use blocks are preserved
state.messages.push({ role: 'assistant', content: data.content });
```

### 8.3 OpenAI-Compat Backend

Tool results are appended as messages with `role: 'tool'`:

```typescript
for (const r of toolResults) {
  state.messages.push({
    role: 'tool',
    tool_call_id: r.toolCallId,
    content: r.content,
  });
}
// send /v1/chat/completions with state.messages
```

The assistant's prior response (with `tool_calls`) was stored in `state.messages` as `{ role: 'assistant', tool_calls: [...] }`. Tool results must follow it in the same array.

### 8.4 Ollama Backend

Ollama's native `/api/chat` format mirrors OpenAI for tool results:

```typescript
state.messages.push({ role: 'tool', content: r.content });
```

Note: Ollama does not use `tool_call_id` in the tool result message at the time of writing. The backend appends tool results in order matching the tool_calls array. If Ollama's API evolves to require `tool_call_id`, update accordingly.

---

## 9. Scope-Local Value Store

Phase 2 aliased the scope-local store to the run-level store in `dag-executor.ts`. Phase 3 creates a proper scope-local `ValueStore` per reasoning node invocation.

### 9.1 Lifecycle

```
runReasoningNode() called
  │
  ▼
scopeStore = new ValueStore()      // fresh in-memory scope
  │
  ▼
  ... tool-calling loop ...        // tool results stored in scopeStore
  │
  ▼
signal parsed from final answer
  │
  ▼
for each declared output in signal.outputs:
  handle = signal.outputs[i].value_ref
  if handle is in scopeStore:
    runLevelStore.adopt(handle, scopeStore.get(handle))
  // (else handle is already run-level — pass through)
  │
  ▼
scopeStore = null                  // GC the scope
```

`ValueStore` gains an `adopt(handle, envelope)` method that imports an envelope from a foreign store. The DAG executor's run-level store is passed into `runReasoningNode` separately from the scope store; the runtime promotes declared outputs at the end.

### 9.2 Handle Passing into Scope

Upstream output handles from prior nodes (resolved from `${nodeName.outputs.port}` YAML refs) are pre-loaded into the scope-local store at the start of `runReasoningNode`. This ensures the LLM can pass them as value_refs to tools without the tool dispatcher needing to check both stores.

```typescript
for (const [handle, envelope] of upstreamHandles) {
  scopeStore.put(handle, envelope);
}
```

---

## 10. Legacy Backend Removal

### 10.1 Files to Delete

After all five workflows are migrated and smoke tests pass (Tasks 16-18):

| File | Notes |
|------|-------|
| `packages/server/src/modules/agents/claude-code-session.ts` | PTY backend |
| `packages/server/src/modules/agents/process-session.ts` | child_process backend |
| `packages/server/src/modules/agents/local-llm-session.ts` | Legacy HTTP backend |

### 10.2 Interfaces to Remove from `agent-backend.ts`

```typescript
// DELETE:
export type BackendType = 'claude-code' | 'process' | 'local-llm';
export interface AgentConfig { ... }
export interface AgentResult { ... }
export interface AgentArtifact { ... }
export interface AgentInfo { ... }
export interface LegacyAgentBackend { ... }
```

Keep only: `NewBackendType`, `AgentBackend`, and the import block from `./new-types.js`.

### 10.3 Code to Remove from `agent-registry.ts`

Remove all legacy backend instantiation logic. After Phase 3, `agent-registry.ts` is responsible only for managing the three new backend instances (`ClaudeBackend`, `OpenAICompatBackend`, `OllamaBackend`).

### 10.4 Code to Remove from `dag-executor.ts`

- `dispatchNewReasoningNode` (replaced by `runReasoningNode` from `reasoning-runtime.ts`)
- `dispatchLegacyReasoningNode`
- `waitForOutput` usage (it is kept in `utils.ts` if used elsewhere; otherwise delete)
- All references to `LegacyAgentBackend`, `AgentConfig`, `BackendType`
- The import of `AgentRegistry` if it becomes empty after the above

### 10.5 `package.json` — Remove `node-pty`

```json
// DELETE from dependencies:
"node-pty": "..."
```

Also remove any `node-pty` rebuild scripts from `package.json` scripts if present. Run `pnpm install` and verify build.

---

## 11. Workflow Migration Strategy

All five workflows must be migrated before legacy deletion (Tasks 12-15).

### 11.1 Migration Rules

1. Nodes with `backend: claude-code` → `backend: claude`. Add explicit `toolset` if the node used tools via the PTY session. If the node's purpose was purely analytical (no tool calls needed), use `toolset: []`.
2. Nodes with `backend: local-llm` + `provider: ollama` → `backend: ollama`. Map `endpoint` → `endpoint`, `model` → `model`, `disable_thinking` → `disable_thinking`, `max_tokens` → `max_tokens`.
3. Nodes with `backend: local-llm` + `provider: openai` (or default) → `backend: openai-compat`.
4. Nodes with `backend: process` → `backend: claude` (or `ollama`) with `toolset: []`. These nodes run single-turn (no tool calls), so behavior is equivalent if the preset produces a valid signal in its first response.

### 11.2 Per-Workflow Migration

**`research-swarm`** — all 14 nodes are `kind: reasoning` with no explicit `backend` field (implied `claude-code` by current default). Add `backend: claude` globally via a top-level `defaults` block or per-node. Toolsets: `ingestor` and `profiler` need `pandas.*` and `statistics.*` tools; `hypothesist`, `adversary`, `judge` need `statistics.*` and `hypothesis_testing.*`; `architect`, `coder`, `executor` need `pandas.*` and `sklearn.*`; `falsifier` needs `statistics.*`; others (`generalizer`, `reporter`, `meta_analyst`, `fixer`, `auditor`) use `toolset: []` (analysis-only).

**`theorem-prover-mini`** — `conjecturer`, `formalizer`, `prover`, `reporter` → `backend: claude`. `lean_check` → `backend: claude` with `toolset: []` (it runs a lake build via purpose and reads output; no registry tools needed in Phase 3).

**`smoke-test`** — `echo_node` → `backend: claude` with `toolset: []`. `writer` → `backend: claude` with `toolset: []`. `reviewer` → `backend: ollama` with existing model/endpoint config.

**`math-discovery`** and **`sequence-explorer`** — inspect current `workflow.yaml` for backend fields and apply same rules.

### 11.3 YAML `toolset` Examples

```yaml
# research-swarm/workflow.yaml (partial)
  ingestor:
    kind: reasoning
    backend: claude
    model: claude-sonnet-4-6
    preset: research/ingestor
    toolset:
      - category: pandas
      - category: descriptive_statistics
    depends_on: []
    timeout_seconds: 600

  lean_check:
    kind: reasoning
    backend: claude
    model: claude-haiku-3-5
    preset: research/theorem-prover-mini/lean-checker
    toolset: []
    depends_on: [prover]
    timeout_seconds: 300
```

---

## 12. Error Taxonomy Extensions

New error categories added to `BackendErrorCategory` in `new-types.ts`:

```typescript
export type BackendErrorCategory =
  | 'auth_error'
  | 'rate_limit'
  | 'backend_error'
  | 'backend_unavailable'
  | 'conversation_not_found'
  | 'not_implemented'
  // Phase 3 additions:
  | 'tool_not_allowed'        // LLM called tool not in toolset
  | 'tool_budget_exhausted'   // same tool failed N consecutive times
  | 'max_turns_exceeded'      // loop hit maxTurns and LLM still emitted tool calls
  | 'signal_parse_error'      // no valid signal block after corrective re-prompt
  | 'wall_clock_timeout'      // node ran longer than wallClockTimeoutMs
  | 'context_exceeded'        // LLM context window full (re-mapped from backend 400)
  | 'toolset_empty_glob'      // glob pattern in toolset matched zero registry tools
  | 'handle_not_found';       // LLM referenced value handle not in scope
```

New `ReasoningError` class (extends `Error`) mirrors `BackendError` but with `ReasoningErrorCategory`. This separates loop-level errors from backend API errors.

---

## 13. Test Plan

### 13.1 Unit Tests (mocked backends)

**`reasoning-runtime.test.ts`:**
- Single-turn: LLM returns final answer with valid signal on first response → `runReasoningNode` returns parsed signal, 1 turn used.
- Tool call round-trip: LLM calls a mocked tool on turn 1, result returned, LLM emits final answer on turn 2 → 2 turns used, tool call count 1.
- Per-tool retry budget: mock tool always fails; after 3 consecutive failures, runtime injects BUDGET_EXHAUSTED result; LLM emits final answer → node succeeds with budget error visible in trace.
- Max turns: mock LLM always emits a tool call; on turn 20 the budget message is injected; mock LLM then returns final answer → node succeeds.
- Max turns exceeded: mock LLM emits tool calls even after budget message → `max_turns_exceeded` error thrown.
- Signal parse error: LLM returns final answer with no signal block; corrective re-prompt sent; second response also has no signal block → `signal_parse_error` thrown.
- Corrective re-prompt success: LLM returns no signal block on first final turn; corrective re-prompt sent; second response has valid signal → success.
- `tool_not_allowed`: LLM calls a tool not in the toolset → error result returned to LLM, visible in tool result content.
- Wall clock timeout: mock LLM never resolves its promise; timeout fires after configured ms → `wall_clock_timeout` error.
- Value handle passing: tool returns a `ValueRef`; LLM passes the handle to a second tool; second tool receives the resolved envelope.

**`toolset-resolver.test.ts`:**
- Category resolution: mock registry returns 3 tools for `descriptive_statistics`; resolver returns 3 `ToolDefinition[]`.
- Exact name: `sklearn.pca` → `ToolDefinition` with `name: 'sklearn_pca'`.
- Glob: `statistics.*` → all matching tools.
- Deduplication: same tool appears in category and name entry → deduplicated to one.
- Unknown name: `noexist.tool` → throws `ResolverError('tool_not_found')`.
- Empty glob: `zzz.*` matches nothing → throws `ResolverError('toolset_empty_glob')`.

**`sendToolResults` in each backend (`claude-backend.test.ts`, `openai-compat-backend.test.ts`, `ollama-backend.test.ts`):**
- Mock fetch; verify request body includes tool results in correct format.
- Verify response is parsed and `toolCalls` array is populated when backend returns tool_use/tool_calls.
- Verify conversation state messages accumulate correctly across multiple round-trips.

### 13.2 Integration Tests

**`reasoning-node-e2e.test.ts`** (using real registry client with seed tools, mocked LLM backend):
- A reasoning node that calls `statistics.mean` on a synthetic array and emits a signal with the result.
- A reasoning node that calls `pandas.load_csv` (if available in seed tools) → stores handle → calls `statistics.describe` with the handle → emits signal.

**Smoke test workflow (existing `test-data/run-smoke.js`):**
- After workflow migration: re-run smoke test against new backends; verify completion and valid signals.

### 13.3 Regression Gate

All 264 existing passing tests must continue to pass after each task. Run `pnpm test` before committing each task.

---

## 14. Rollout — 18 Tasks

| # | Task | Files Changed | Test Gate |
|---|------|---------------|-----------|
| 1 | Add `toolset-resolver.ts` with category/name/glob resolution, `ToolDefinition[]` output, `toolNameMap` | `agents/toolset-resolver.ts` | Unit tests |
| 2 | Extend `ToolDefinition` / `JsonSchemaProperty` for structured schemas; update `new-types.ts` to add Phase 3 error categories | `agents/new-types.ts` | tsc clean |
| 3 | Implement tool definition wire-format translation in `ClaudeBackend.startConversation`; update `AssistantMessage` parsing to extract `tool_use` blocks; update `ConversationState` | `agents/claude-backend.ts` | Unit tests |
| 4 | Implement `sendToolResults` in `ClaudeBackend` (append `tool_result` user message; call API; parse `tool_use` + text response) | `agents/claude-backend.ts` | Unit tests |
| 5 | Implement tool definition wire-format in `OpenAICompatBackend`; update response parsing for `tool_calls`; implement `sendToolResults` | `agents/openai-compat-backend.ts` | Unit tests |
| 6 | Implement tool definition wire-format in `OllamaBackend`; update response parsing; implement `sendToolResults` | `agents/ollama-backend.ts` | Unit tests |
| 7 | Create `reasoning-runtime.ts` with `runReasoningNode`: single-turn path (empty toolset), scope-local ValueStore creation, final answer parsing, corrective re-prompt | `agents/reasoning-runtime.ts` | Unit tests |
| 8 | Add tool-calling loop to `runReasoningNode`: dispatch loop, tool name resolution, `RegistryClient.invoke` call, value_ref handle storage, result encoding | `agents/reasoning-runtime.ts` | Unit tests |
| 9 | Add per-tool retry budget and max-turns safety to `runReasoningNode`; add wall clock timeout via `Promise.race` | `agents/reasoning-runtime.ts` | Unit tests |
| 10 | Implement scope-local `ValueStore` lifecycle in `runReasoningNode`: fresh scope on start, upstream handle pre-loading, declared-output promotion to run-level on completion | `agents/reasoning-runtime.ts`, `registry/execution/value-store.ts` | Unit tests |
| 11 | Replace `dispatchNewReasoningNode` in `dag-executor.ts` with `runReasoningNode` call; thread scope store and run-level store correctly | `workflow/dag-executor.ts` | 264+ passing |
| 12 | Migrate `smoke-test` and `math-discovery` workflows to new backends; add explicit `toolset` declarations | `workflows/smoke-test/workflow.yaml`, `workflows/math-discovery/workflow.yaml` | Smoke run |
| 13 | Migrate `sequence-explorer` workflow | `workflows/sequence-explorer/workflow.yaml` | Smoke run |
| 14 | Migrate `research-swarm` workflow: add `backend: claude` and toolset to all 14 nodes | `workflows/research-swarm/workflow.yaml` | tsc clean |
| 15 | Migrate `theorem-prover-mini` workflow: `lean_check` → reasoning with empty toolset; others → `backend: claude` | `workflows/theorem-prover-mini/workflow.yaml` | tsc clean |
| 16 | Delete `claude-code-session.ts`, `process-session.ts`, `local-llm-session.ts`; remove `LegacyAgentBackend` and deprecated types from `agent-backend.ts` | 3 deletions, `agent-backend.ts` | tsc clean |
| 17 | Remove legacy dispatch paths from `agent-registry.ts` and `dag-executor.ts`; clean up all `@deprecated` imports | `agent-registry.ts`, `dag-executor.ts` | 264+ passing |
| 18 | Remove `node-pty` from `package.json`; run `pnpm install`; verify build clean; update `HIGH_LEVEL_DESIGN.md` Phase 3 status | `package.json`, `HIGH_LEVEL_DESIGN.md` | Build clean |

---

## 15. Module Layout After Phase 3

```
packages/server/src/modules/agents/
├── agent-backend.ts               # AgentBackend interface only (no legacy types)
├── new-types.ts                   # + Phase 3 error categories, BackendMessage union
├── claude-backend.ts              # + tool wire format, sendToolResults, tool_use parsing
├── openai-compat-backend.ts       # + tool wire format, sendToolResults, tool_calls parsing
├── ollama-backend.ts              # + tool wire format, sendToolResults
├── toolset-resolver.ts            # NEW — registry query → ToolDefinition[] + toolNameMap
├── reasoning-runtime.ts           # NEW — tool-calling loop, retry budget, signal parsing
├── agent-registry.ts              # trimmed — only new backend management
└── __tests__/
    ├── toolset-resolver.test.ts   # NEW
    ├── reasoning-runtime.test.ts  # NEW
    ├── claude-backend.test.ts     # extended for sendToolResults
    ├── openai-compat-backend.test.ts  # extended
    └── ollama-backend.test.ts     # extended

# DELETED:
# agents/claude-code-session.ts
# agents/process-session.ts
# agents/local-llm-session.ts
```

---

## 16. Open Questions

**Q1 — `tool_choice` behavior.** Should `tool_choice` be set to `"auto"` (default) or omitted? Some models behave differently with `tool_choice: "any"` (forces a tool call on every turn) vs `"auto"`. The current spec uses `"auto"` (or omits). If a workflow relies on the LLM always calling at least one tool before answering, a node-level `force_tool_use: true` flag could be added. Defer unless a workflow requires it.

**Q2 — Token counting for tool results.** Large tool results (e.g., a long error message from `lean build`) can consume many tokens. The current design returns the full content string. If a tool result exceeds a configurable token budget (e.g., 2000 tokens), should it be truncated before being sent back? Recommend: add a `maxToolResultTokens` option to `ReasoningNodeParams`, default 4000; truncate with a `[truncated]` suffix. This is a safe default and avoids accidental context overflow from verbose tools.

**Q3 — Ollama `tool_call_id` compatibility.** Ollama's tool result format may not use `tool_call_id` in older versions. The spec notes that Phase 3 appends results in order. If future Ollama versions require `tool_call_id`, a minor backend update is needed. Track Ollama changelog.

**Q4 — `research-swarm` toolset coverage.** The toolset declarations in Section 11.2 are inferred from the node purposes. The actual tool categories required depend on which seed tools are loaded by TR Phase 3 full. If TR Phase 3 full is not merged before NR Phase 3, research-swarm nodes may have partial toolsets. Coordinate TR Phase 3 full merge timing with NR Phase 3 Tasks 12-15.

**Q5 — Scope-local store complexity.** If scope-local store lifecycle (Task 10) proves complex — especially the upstream handle pre-loading — it can be deferred to Phase 3b with a stub that aliases scope to run-level (the current Phase 2 behavior). The tool-calling loop (Tasks 7-9) is independent and should not be blocked.

**Q6 — `lean_check` empty toolset.** With `toolset: []`, the `lean_check` node runs single-turn with no tool access. The preset must produce a valid signal from the purpose alone (e.g., by reading the lake build result that was written to the workspace by the `prover` node). This assumes the preset is designed to work without tool calls. Verify the existing `lean-checker` preset before Task 15.
