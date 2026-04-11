# Plurics Node Runtimes — Design Document

**Version:** 0.1 (draft)
**Status:** Design — not yet implemented
**Scope:** Full specification of how workflow nodes are executed: reasoning nodes, tool nodes, backend implementations, tool dispatch, context management, error handling
**Parent document:** `docs/design/overview.md` Section 5
**Related documents:** `docs/design/tool-registry.md`, `docs/design/workflow-engine.md` (to be written)

---

## 1. Introduction

This document specifies how the workflow nodes in Plurics are actually executed. A workflow YAML defines a DAG of nodes and their dependencies; the workflow engine (Layer 1) decides which nodes run when; this document describes what happens when a node is dispatched to a runtime — how the runtime loads the node's configuration, prepares its inputs, invokes LLMs or tools, captures outputs, handles errors, and emits signals.

The document takes as given the existence of the Tool Registry (specified in `docs/design/tool-registry.md`) and the workflow engine's DAG executor (specified in the overview and in a future `docs/design/workflow-engine.md`). It focuses specifically on the slice between "the engine decides to run node X" and "node X emits its completion signal." That slice contains the most novel complexity of Plurics after the registry: the orchestration of LLM tool-calling loops against a typed primitive library.

The key design commitment of this document is the distinction between two node categories — reasoning nodes and tool nodes — which replaces the earlier three-way split of `claude-code`, `process`, and `local-llm` inherited from the CAAM origin. The new distinction is architectural rather than cosmetic: it reflects where judgment lives and where deterministic computation lives, consistent with the manifesto's thesis.

## 2. Node Taxonomy

In Plurics, every node in a workflow DAG belongs to exactly one of two categories. The category is declared in the YAML and determines which runtime path the engine dispatches to.

A **reasoning node** is a node whose work is performed by an LLM with access to a toolset drawn from the registry. The LLM reads a purpose prompt, thinks about the problem, composes tools to solve it, invokes those tools through the registry, interprets the results, and produces a structured signal as output. The reasoning node is where both judgment and composition happen. It is the node type for any step that requires "what should I do next" thinking: hypothesis generation, critical review, selection, strategy planning, synthesis, reporting.

A **tool node** is a node whose work is a single direct invocation of a tool from the registry, with parameters derived from upstream dependencies. No LLM is involved. Tool nodes are used when the workflow author has determined that no decision is needed at that step — only computation. They are the node type for deterministic operations with known parameters: data loading, backtest execution, formal verification via a compiler, file transformations, scheduled exports.

The two node types share the same outer envelope — they have names, dependencies, timeouts, retry policies, and emit signals in the same schema — but differ fundamentally in their runtimes. A reasoning node's runtime is an LLM backend that manages a tool-calling loop. A tool node's runtime is a direct invocation of the registry's tool executor. The engine dispatches each node to the appropriate runtime based on its declared category.

Here is a minimal YAML example showing both node types in the same workflow:

```yaml
name: example-workflow

nodes:
  # Tool node: direct invocation, no LLM
  load_data:
    kind: tool
    tool: pandas.load_csv
    inputs:
      path: "{{WORKSPACE}}/data/dataset.csv"

  # Reasoning node: LLM with a toolset
  analyze:
    kind: reasoning
    backend: claude
    model: claude-sonnet-4-6
    preset: presets/analyzer
    toolset:
      - category: descriptive_statistics
      - category: hypothesis_testing
      - name: sklearn.pca
    depends_on: [load_data]

  # Tool node again: deterministic export
  export_results:
    kind: tool
    tool: json.dump
    inputs:
      data: "${analyze.outputs.findings}"
      path: "{{WORKSPACE}}/output/findings.json"
    depends_on: [analyze]
```

The `kind` field is new — it is the explicit declaration of the node category. The `backend` field appears only on reasoning nodes because tool nodes do not have an LLM backend; they have a tool. The `toolset` field appears only on reasoning nodes for the same reason.

In the current Plurics codebase, node kind is inferred from the backend type (`claude-code` and `local-llm` imply reasoning, `process` implies tool). With the new design, the inference is replaced by explicit declaration, which removes ambiguity and makes the semantics clearer in the YAML.

## 3. Tool Node Runtime

Tool nodes are simpler than reasoning nodes, so this document specifies them first.

### 3.1 Execution Flow

When the engine decides to run a tool node, the runtime performs the following sequence:

1. **Resolve the tool.** Look up the declared tool in the registry by name and optional version. If the tool does not exist, fail immediately with a node error of category `tool_not_found`.
2. **Resolve inputs.** Walk the `inputs` block of the node YAML. For each input port, determine the source: a literal value, a workflow config substitution (`{{KEY}}`), or an upstream node output reference (`${node.outputs.port}`). Resolve references by reading from the upstream node's recorded outputs.
3. **Validate inputs.** Check that every required input port has a value. Check that the schema of each input matches the port's declared type. If a type mismatch is detected and a converter exists in the registry, insert the converter invocation automatically. If no converter exists, fail with `type_mismatch`.
4. **Invoke the tool.** Call the registry's invocation API with the resolved inputs and the node's timeout. The registry executes the tool in a Python subprocess as specified in `docs/design/tool-registry.md` Section 9.
5. **Handle the result.** If the tool succeeds, collect the outputs and proceed to signal emission. If the tool fails (exception, timeout, output mismatch), either retry (if retries remain) or fail the node with the error propagated from the registry.
6. **Emit signal.** Write a signal file to the run directory with `status: success` or `status: failure`, outputs referencing the tool's outputs, and metrics (duration, memory if captured).

The runtime does not manage context because there is no LLM in the loop. It does not manage conversation because there is no conversation. The entire execution is a single function call with known inputs and known outputs, and its complexity is bounded by the tool being invoked.

### 3.2 Input Resolution and Value References

The input resolution step deserves specification because it is the interface between the workflow engine's state and the tool invocation.

A literal value in the YAML (`n_components: 5`) is passed directly to the tool after type coercion against the declared port schema. A string `"5"` where an `Integer` is expected is coerced; a string `"abc"` is a type error.

A workflow config substitution like `{{WORKSPACE}}` is replaced at parse time using the values from the `config` block of the workflow YAML or from environment variables. This is the same templating that already exists in the current Plurics codebase.

An upstream reference like `${load_data.outputs.df}` is resolved at dispatch time. The runtime reads the upstream node's completion signal from the run directory, extracts the `outputs` block, finds the named port, and retrieves the associated value. Because tool outputs can be large structured types (a `DataFrame` with millions of rows), the actual value is not stored in the signal — the signal contains a reference to a value store entry, and the runtime retrieves the full value from the store.

The value store is specified in Section 5 of this document. For tool nodes, it suffices to say: upstream references are transparent from the YAML's point of view, and the runtime handles the marshalling of large values automatically.

### 3.3 Signal Emission

Upon completion (success or failure), the tool node runtime writes a signal file to `.plurics/runs/{runId}/signals/`. The signal schema is the same one used throughout Plurics (specified in the overview document), with tool-node-specific conventions:

```json
{
  "schema_version": 1,
  "signal_id": "sig-20260420T143055-load_data-a3f2",
  "agent": "load_data",
  "scope": null,
  "status": "success",
  "decision": null,
  "outputs": [
    {
      "port": "df",
      "schema": "DataFrame",
      "value_ref": "vs-20260420T143055-load_data-df-b7e1",
      "sha256": "...",
      "size_bytes": 15728640
    }
  ],
  "metrics": {
    "duration_seconds": 0.8,
    "retries_used": 0
  },
  "error": null
}
```

The `outputs` field contains one entry per output port. Each entry has the port name, the schema, a `value_ref` that points to the value store, and optional hash and size. This is a departure from the current signal format, which uses `path` for file-based outputs; the new format is richer because it supports both file-backed and in-memory values through the value store.

The `decision` field is null for tool nodes by convention because tool nodes do not make routing decisions — they are purely computational. Routing is determined by the tool's success or failure, handled by the workflow engine's branch logic.

## 4. Reasoning Node Runtime

Reasoning nodes are where most of the complexity of this document lives. This section specifies the reasoning node runtime end to end.

### 4.1 Execution Flow

When the engine decides to run a reasoning node, the runtime performs the following sequence:

1. **Resolve the backend.** Look up the backend (one of `claude`, `openai-compat`, `ollama`) and instantiate the corresponding backend handler with the node's configuration (model name, endpoint URL, provider-specific options).
2. **Resolve the toolset.** Walk the `toolset` block of the node YAML. For each entry (category, name, glob), query the registry and accumulate the resulting tools. Deduplicate. The resolved toolset is a concrete list of `(tool_name, version)` pairs that this node will have access to.
3. **Generate the purpose.** Compose the purpose markdown from the node's preset template and the plugin's `onPurposeGenerate` hook, substituting workflow config values, upstream handoffs, pool context (if the workflow uses evolutionary pool), and other domain-specific enrichments.
4. **Generate the system prompt.** Construct the system prompt for the LLM from the purpose, the workflow's shared context, the signal emission instructions, and — this is new — the toolset description. The toolset description tells the LLM what tools are available and how to invoke them.
5. **Generate tool definitions.** Translate the resolved toolset into the backend-specific tool definition format (Anthropic tool use, OpenAI function calling, Ollama tool use). The translation is specified in Section 6 of this document.
6. **Initialize the value store.** Create a value store scope for this node invocation. The scope holds structured values produced by tool calls during the session and is destroyed when the node completes. Also populate the scope with values referenced in upstream handoffs, so the LLM can reference them by handle.
7. **Run the tool-calling loop.** Start a conversation with the LLM backend: send the system prompt and the initial user message (the purpose). The LLM responds with a message that either contains tool calls (which the runtime dispatches to the registry) or contains a final answer (which the runtime parses into a signal). If tool calls are present, execute them, append results to the conversation, and continue the loop. If a final answer is present, exit the loop.
8. **Parse the final answer.** Extract the signal from the LLM's final message. By convention, the preset instructs the LLM to produce a JSON block in a specific format; the runtime parses this block and constructs the signal file.
9. **Emit signal.** Write the signal to the run directory, including references to any outputs the LLM declared in its final answer.
10. **Clean up.** Destroy the value store scope for this node. Log the invocation to the run directory.

The heart of this flow is step 7, the tool-calling loop. It is specified in detail in Section 4.3 after we establish the context management model.

### 4.2 Context Management

A reasoning node's LLM has a context window that accumulates content during execution: the system prompt, the initial user message, any tool calls and tool results, and the final answer. This accumulating context is the LLM's working memory for the node.

The context is **ephemeral** — it exists only for the duration of the reasoning node's execution. When the node terminates (successfully or not), the context is discarded. The next node in the workflow receives a fresh context built from its own purpose and its own toolset, with no memory of what previous nodes saw or did at the LLM level.

This is a deliberate architectural choice consistent with the invariant that agents are stateless between invocations. The question of how information survives across nodes — which was the "memory" question raised during design — is answered by three mechanisms that operate at layers other than the LLM context:

**The tool registry is persistent capability memory.** Every tool registered is knowledge crystallized into an executable primitive. A reasoning node at step N in a workflow has access to the same registry as a reasoning node at step M in a different workflow running a year later. This is the primary form of long-term memory in Plurics, and it is strictly more powerful than conversational memory because it is reusable across contexts and verifiable by tests.

**The filesystem is handoff memory.** Reasoning nodes communicate with each other through signal files and artifact files in the shared run directory. A Conjecturer that produces ten conjectures writes them to a JSON file; the Critic reads that file as part of its purpose context. This is not LLM-level memory — the Critic's LLM has no idea what the Conjecturer's LLM "thought" — but it is sufficient because what matters is the structured output, not the stream of reasoning that produced it.

**The value store is in-run object memory.** When a tool call produces a structured value (a DataFrame, an array, a model), the value is stored in an in-memory store scoped to the current run. Subsequent tool calls within the same reasoning node receive handles to these values, and subsequent nodes can receive them through upstream references. The value store is specified in Section 5.

These three mechanisms together replace what Claude Code via PTY provided through its long-running terminal session. The replacement is not a direct equivalent — it is a reorganization of where information lives so that it is more durable (the registry), more structured (signal handoffs), and more efficient (the value store) than an ephemeral conversation.

The context window of a reasoning node, therefore, is not where "memory" lives. It is where the LLM's current working set lives for the duration of this one step. It should contain what the LLM needs to think about the current step — the purpose, the relevant upstream handoffs, the toolset description, the tool calls and results of this session — and nothing else.

### 4.3 The Tool-Calling Loop

The tool-calling loop is the mechanism by which a reasoning node's LLM composes tools to solve its assigned problem. It is a turn-based conversation with the backend, where each turn can contain tool calls that the runtime executes and whose results are fed back into the next turn.

The loop proceeds as follows:

On **turn 1**, the runtime sends to the backend a message list containing the system prompt and the initial user message (the purpose). The backend returns a response that is either a final answer (no tool calls, we exit the loop) or a message containing one or more tool calls.

If the response contains tool calls, the runtime processes each one:

1. Look up the tool in the toolset. If the requested tool is not in the node's toolset, return an error to the LLM as a tool result with category `tool_not_allowed`. This protects the node's declared constraints.
2. Decode the inputs from the LLM's tool call format into the registry's expected format. This involves resolving value handles (if the LLM references an upstream output or a prior tool result by handle), applying schema coercion where needed, and validating required fields.
3. Invoke the tool via the registry API. The registry executes the tool in a subprocess as specified in its own design document.
4. Encode the result for return to the LLM. For primitive outputs, the value is inlined in the tool result message. For structured outputs, the value is stored in the value store and a handle + summary is returned to the LLM. Section 5 specifies the encoding.
5. If the tool fails, return the error as the tool result with the error details visible to the LLM. The LLM can then decide to retry, try a different tool, or conclude that it cannot proceed.

After all tool calls in the turn are processed, the runtime sends **turn 2**: the original messages plus the LLM's turn 1 response plus the tool results. The backend produces another response, which may contain more tool calls (continue the loop) or a final answer (exit the loop).

The loop has two safety mechanisms:

**Per-tool retry budget.** If the LLM calls the same tool with invalid inputs multiple times in a row, the runtime enforces a retry budget (default 3 consecutive failures). On the fourth consecutive failure of the same tool, the runtime returns a special error to the LLM indicating that this tool should not be retried further. This prevents loops where the LLM repeatedly makes the same mistake.

**Maximum turns.** The loop has a maximum number of turns (configurable per node, default 20). When the budget is reached, the runtime does not forcibly terminate — instead, it injects a final user message saying "you have reached your turn budget. Please produce your final answer now." The LLM receives this message and has one more turn to produce a final answer. If it fails to do so (e.g., it continues to emit tool calls), the node fails with a `max_turns_exceeded` error. The default budget is generous enough that real workflows should not hit it; exceeding it usually indicates a flaw in the preset or the toolset.

### 4.4 Final Answer Parsing

When the LLM's response does not contain tool calls, it is interpreted as a final answer. The runtime parses the response to extract the signal.

The parsing is driven by a convention in the preset: the preset instructs the LLM to emit a JSON block in a specific format at the end of its final answer. The format is the same schema used throughout Plurics for signal emission, but embedded in the LLM's response rather than written as a file. Here is an example of what the LLM's final answer might look like:

```
I have analyzed the dataset and identified three significant patterns.
The strongest is a negative correlation between feature X and feature Y
with p<0.001 from the permutation test.

```signal
{
  "status": "success",
  "decision": {
    "findings_generated": 3,
    "strongest_pattern": "neg_corr_XY"
  },
  "outputs": [
    {
      "port": "findings",
      "schema": "JsonArray",
      "value_ref": "vs-...-findings-...",
      "summary": "3 findings: neg_corr_XY (p<0.001), mean_shift_A (p=0.003), var_inflation_B (p=0.02)"
    }
  ]
}
```
```

The runtime extracts the fenced `signal` block, parses it as JSON, validates it against the signal schema, and constructs the signal file. Any text outside the signal block is captured as the node's reasoning trace and saved to the logs directory but does not affect the signal itself.

If the LLM's final answer does not contain a parseable signal block — either because the LLM forgot to include it, or because the JSON is malformed — the runtime treats this as a retry-able error. The runtime constructs a corrective user message ("your last response did not contain a valid signal block. Please produce your final answer again with a properly formatted signal block at the end.") and sends it as an additional turn. If the LLM produces a valid signal on the next turn, the node succeeds. If it fails again after the corrective turn, the node fails with `signal_parse_error`.

The correction turn mechanism is important because LLMs occasionally omit structural elements of their expected output. A single corrective re-prompt is usually sufficient and avoids failing the node for a trivial formatting mistake.

## 5. The Value Store

The value store is an in-memory object store that holds structured values produced during a workflow run. It exists to solve a specific problem: tools produce and consume complex Python objects (DataFrames, arrays, models, symbolic expressions) that cannot be serialized into the LLM's text context efficiently, but that must flow through the workflow as first-class data.

### 5.1 Motivation

Consider a reasoning node that loads a dataset, runs PCA on it, and passes the loadings to a clustering tool. In a naive design where the LLM sees all intermediate values:

```
Turn 1: LLM calls pandas.load_csv("data.csv")
        Runtime returns: DataFrame with 100,000 rows and 20 columns
        But how is this shown to the LLM? If we serialize it to a string,
        we'd waste 50,000 tokens on what the LLM doesn't need to see.

Turn 2: LLM calls sklearn.pca(matrix=???, n_components=5)
        What does it pass as `matrix`? If we expected the LLM to inline
        the dataframe, that's impossible. If we expected it to remember
        "the output of turn 1", we've invented an implicit reference.
```

The value store solves this by giving every structured output a unique identifier (a handle) and returning the handle plus a short summary to the LLM instead of the value itself. The LLM sees handles as opaque tokens that it can pass to subsequent tool calls, and summaries as the informative content it can reason about.

### 5.2 Value Store Semantics

A value store scope is created when a reasoning node begins execution and destroyed when the node completes. Within the scope, values are indexed by handles — strings of the form `vs-{timestamp}-{nodeName}-{portName}-{shortHash}`. Handles are generated by the runtime when a tool produces a structured output and assigned before the result is returned to the LLM.

When a tool call returns a structured value, the runtime stores the value in the current scope and sends the LLM a replacement object of the form:

```json
{
  "_type": "value_ref",
  "_handle": "vs-20260420-analyze-df-7e3a",
  "_schema": "DataFrame",
  "_summary": {
    "shape": [100000, 20],
    "dtype": "mixed (float64, int64, object)",
    "columns": ["timestamp", "open", "high", "low", "close", ...],
    "head": [
      {"timestamp": "2025-01-01 00:00:00", "open": 1.0823, ...},
      {"timestamp": "2025-01-01 00:05:00", "open": 1.0825, ...}
    ],
    "stats": {"open.mean": 1.0812, "open.std": 0.0034, ...}
  }
}
```

The summary is generated by a **summarizer** registered in the schema system. Each structured schema declares its own summarizer function in the schema YAML, and the runtime invokes it when wrapping a value for LLM consumption. The summarizer's job is to produce a small, informative description of the value that gives the LLM enough context to reason about it without materializing the full contents. For a DataFrame, this is shape + dtype + columns + head + basic stats. For a NumpyArray, this is shape + dtype + sample + stats. For a SymbolicExpr, this is the string form of the expression. The summarizer is part of each schema's definition in the registry.

When the LLM makes a subsequent tool call and wants to pass a previously-produced value, it includes the handle in the tool call arguments:

```json
{
  "tool": "sklearn.pca",
  "inputs": {
    "matrix": {"_type": "value_ref", "_handle": "vs-20260420-analyze-df-7e3a"},
    "n_components": 5
  }
}
```

The runtime resolves the handle by looking up the value in the current scope and passing the actual Python object to the tool invocation. From the tool's point of view, it receives a real DataFrame as its `matrix` parameter; from the LLM's point of view, it passed "the dataframe from earlier" by reference.

### 5.3 Scope Lifecycle

A value store scope is tied to a reasoning node's execution. It is created when the node starts, populated as tool calls produce structured outputs, and destroyed when the node terminates.

When the node needs to emit an output of its own (declared in the node's signal), the value being exported must be transferred out of the scope-local store and into a **run-level store** that persists for the duration of the workflow run. The run-level store lives in the run directory — values are serialized to `runs/{runId}/values/` using the same pickle-base64 encoding as tool subprocess I/O, and the signal's `value_ref` field points to the stored file.

Downstream nodes that reference the output (via `${node.outputs.port}` in YAML or via value handles in LLM tool calls) resolve the reference by reading from the run-level store. When they load the value into their own reasoning node's scope, they bring a copy of the value back into memory.

The run-level store is persistent for the duration of a run. When a run completes (or crashes and is resumed later), the values remain on disk. This is what enables resume: a node that had produced outputs before the crash has those outputs already stored and accessible to downstream nodes at resume time.

After a run completes, the values can be garbage-collected based on retention policy — by default they are kept for 7 days and then pruned. Findings and small outputs are retained longer; large tensor-like values are pruned aggressively because they are rarely inspected post-run.

### 5.4 Handle Resolution and Safety

Handles are not globally unique in a strong cryptographic sense — they contain enough entropy to be practically unique within a run but are not guessable or forgeable. Since value stores are not exposed across run boundaries or across users, this is acceptable.

Handle resolution has three possible outcomes:

**Resolved successfully.** The handle matches an entry in the scope-local or run-level store. The value is returned.

**Not found in scope.** The LLM referenced a handle that does not exist in the current scope. This happens if the LLM hallucinates a handle, if an upstream handle was not propagated correctly, or if the runtime has a bug. The tool invocation fails with `handle_not_found` and the error is returned to the LLM as a tool result.

**Schema mismatch.** The handle resolves but the value's schema does not match what the receiving tool expects. This is caught at input validation time and fails with `type_mismatch`.

Handle forgery is not a threat in the single-user local model. If it becomes a threat in a future multi-user version of Plurics, handles can be replaced with signed tokens without changing any other part of the design.

## 6. Backend Implementations

The reasoning node runtime is backend-agnostic at the API level: it manages the tool-calling loop through an `AgentBackend` interface, and concrete backend implementations translate between that interface and specific LLM APIs. This section specifies the three backends supported in the initial implementation.

The `AgentBackend` interface, after the refactoring required by this document, exposes the following key methods:

```typescript
interface AgentBackend {
  readonly backendType: 'claude' | 'openai-compat' | 'ollama';
  readonly id: string;

  /** Start a new conversation with the given system prompt and tool definitions. */
  startConversation(params: {
    systemPrompt: string;
    toolDefinitions: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<ConversationHandle>;

  /** Send a user message and receive the assistant's response. */
  sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage>;

  /** Send tool results back to the model and receive the next response. */
  sendToolResults(
    conversation: ConversationHandle,
    toolResults: ToolResult[],
  ): Promise<AssistantMessage>;

  /** Clean up the conversation. */
  closeConversation(conversation: ConversationHandle): Promise<void>;
}
```

The runtime orchestrates the tool-calling loop by calling `sendMessage` for the initial purpose and then alternating between `sendToolResults` and the tool dispatcher until the LLM returns a final answer without tool calls.

### 6.1 The `claude` Backend

The `claude` backend speaks to the Anthropic Messages API. It supports two modes of authentication that are otherwise identical: direct API key (for billed API access) and local proxy for Max-subscribed users via `claude-max-api-proxy`.

The backend is configured with a base URL (`https://api.anthropic.com` for direct access or `http://localhost:3456` for the proxy by default), an API key, and a model name. The proxy mode is the default for developers using their Claude Max subscription — it exposes the same API surface as the direct endpoint but authenticates via OAuth against the user's Anthropic account instead of a billed API key. The client code does not distinguish between the two modes; it sends the same requests to whichever URL is configured.

Tool definitions for this backend use Anthropic's native tool use format:

```json
{
  "name": "sklearn_pca",
  "description": "Principal Component Analysis via scikit-learn...",
  "input_schema": {
    "type": "object",
    "properties": {
      "matrix": {
        "type": "object",
        "description": "NumpyArray. Input data matrix, rows are samples, columns are features."
      },
      "n_components": {
        "type": "integer",
        "description": "Number of components to keep. If omitted, keep min(n_samples, n_features)."
      },
      "whiten": {
        "type": "boolean",
        "description": "Whether to whiten the components.",
        "default": false
      }
    },
    "required": ["matrix"]
  }
}
```

The translation from the tool's registry manifest to this format is deterministic: primitive schemas map to JSON Schema primitive types, structured schemas map to `type: object` with the schema name embedded in the description. This is the "intermediate" mapping level discussed in the design decisions — the LLM sees primitives clearly and sees structured types as opaque objects it must manipulate through handles.

The Anthropic API's native tool use protocol handles the tool call and tool result cycles natively. The backend sends messages with `content` arrays that interleave text blocks, `tool_use` blocks, and `tool_result` blocks. The backend's job is to translate the generic `UserMessage` / `AssistantMessage` / `ToolResult` types into this format and back.

Name translation requires a small convention: tool names in the registry can contain dots (`sklearn.pca`), but tool use names in many backends must be alphanumeric with underscores. The backend translates dots to underscores when generating tool definitions, and reverses the mapping when resolving tool calls. A registry tool `sklearn.pca` becomes a tool definition named `sklearn_pca`, and a tool call naming `sklearn_pca` is dispatched to the registry entry `sklearn.pca`.

### 6.2 The `openai-compat` Backend

The `openai-compat` backend speaks to any server implementing the OpenAI Chat Completions API with function calling support. This covers vLLM, llama.cpp server, LM Studio, and direct OpenAI GPT access.

The backend is configured with a base URL, an optional API key, and a model name. It sends requests to `{base_url}/v1/chat/completions` with the standard OpenAI payload format.

Tool definitions for this backend use OpenAI's function calling format:

```json
{
  "type": "function",
  "function": {
    "name": "sklearn_pca",
    "description": "Principal Component Analysis via scikit-learn...",
    "parameters": {
      "type": "object",
      "properties": {
        "matrix": { "type": "object", "description": "NumpyArray. ..." },
        "n_components": { "type": "integer", "description": "..." },
        "whiten": { "type": "boolean", "description": "...", "default": false }
      },
      "required": ["matrix"]
    }
  }
}
```

The OpenAI format is structurally similar to Anthropic's but with different field names. The translation from the tool manifest is again deterministic and handled by the backend.

The conversation protocol uses OpenAI's message format, where tool calls and tool results appear as messages with roles `assistant` (with a `tool_calls` array) and `tool` (with `tool_call_id` and `content`). The backend translates the generic conversation types into this format.

A caveat: support for function calling in OpenAI-compatible servers varies in quality. vLLM implements it well for models that support it natively (e.g., Qwen 2.5, Llama 3.1+, Mistral). llama.cpp server has partial support. LM Studio depends on the model. The backend does not try to work around deficiencies — if the configured server does not support function calling, the reasoning node will fail at the first tool call attempt with a clear error, and the user is expected to choose a different backend or model.

### 6.3 The `ollama` Backend

The `ollama` backend speaks to Ollama's native API, which is technically OpenAI-compatible on some endpoints but has idiosyncrasies that justify a separate backend.

The most important idiosyncrasy is the `think` parameter, which controls whether "thinking" models (Qwen 2.5 with reasoning mode, DeepSeek-R1, and others) produce reasoning content before their final answer. Without `think: false`, these models exhaust their token budget on internal reasoning prose and produce empty or truncated final content. The OpenAI-compatible endpoint of Ollama does not support this parameter; only the native `/api/chat` endpoint does. This is why Ollama has its own backend instead of going through `openai-compat`.

The backend is configured with a base URL (typically `http://localhost:11434`), a model name, and an optional `disableThinking` flag that sets `think: false` on all requests.

Tool definitions for Ollama use the same structure as OpenAI's function calling format when invoked through the `/api/chat` endpoint with the `tools` parameter. The runtime translation is the same as for `openai-compat`.

Conversation handling uses Ollama's native message format, which is similar to OpenAI's but accessed through `/api/chat` instead of `/v1/chat/completions`. The backend encapsulates this difference.

Ollama's function calling support is relatively recent (landed in late 2025) and still evolving. As with `openai-compat`, the backend does not work around deficiencies in the underlying model's function calling ability. Users selecting Ollama as a backend are expected to choose a model that supports tool calling reliably.

## 7. Error Handling and Limits

Reasoning nodes and tool nodes fail for different reasons, and the runtime handles failures differently for each.

### 7.1 Tool Node Failures

Tool nodes can fail in one of several categories:

- **`tool_not_found`**: the declared tool does not exist in the registry. Probably a typo or a missing dependency declaration. The node fails permanently (no retry).
- **`type_mismatch`**: an input value does not match the declared port schema, and no converter is available. The node fails permanently.
- **`validation_error`**: required inputs are missing, or input values are structurally invalid. The node fails permanently.
- **`runtime_error`**: the tool subprocess raised an exception during execution. The node retries if retries are configured; otherwise fails.
- **`timeout`**: the tool exceeded its configured timeout. The node retries with a longer timeout if configured; otherwise fails.
- **`output_mismatch`**: the tool produced an output that does not match its declared output ports. This is a tool bug, not a workflow bug. The node fails permanently.

Tool node failures propagate to the workflow engine through the signal file with `status: failure` and an `error` block. The workflow engine applies the node's retry policy and, if retries are exhausted, transitions the node to `failed` and may trigger `upstream_failed` on downstream nodes.

### 7.2 Reasoning Node Failures

Reasoning nodes have an additional failure surface because the LLM is involved. Failure categories:

- **`backend_error`**: the LLM backend returned an error (network failure, authentication failure, rate limit, model unavailable). The runtime retries with exponential backoff up to a configurable limit, then fails the node.
- **`context_exceeded`**: the LLM returned an error because the context window was full. This can happen if a reasoning node accumulates many tool results in a long loop. The runtime does not automatically summarize or compact context — that is a future feature. For now, the node fails with a clear error indicating that the toolset or preset needs simplification.
- **`tool_call_budget_exhausted`**: the LLM called the same tool more than 3 times consecutively without success. The runtime returns a final error to the LLM and exits the loop. The signal is either parsed from the LLM's response (if it produced one) or the node fails with the budget exhaustion error.
- **`max_turns_exceeded`**: the LLM loop reached the turn budget and the LLM continued to make tool calls after the forced-termination message. Fails permanently.
- **`signal_parse_error`**: the LLM's final answer did not contain a parseable signal block, even after a corrective re-prompt. Fails permanently.
- **`tool_not_allowed`**: the LLM attempted to call a tool not in the node's declared toolset. The runtime returns this as a tool result to the LLM (the LLM might retry with a different tool), but if it persists, the node's retry budget eventually exhausts.

The per-tool retry budget (3 consecutive failures of the same tool) is distinct from the node-level retry policy (which governs how many times the node itself is re-dispatched after a failure). The per-tool budget lives inside a single reasoning node's execution; the node-level retries come from the workflow engine.

### 7.3 Resource Limits

Reasoning node runtimes enforce the following limits:

- **Max turns**: configurable per node, default 20.
- **Max tokens per response**: configurable per node, default 4096 for shorter planning nodes, 8192 for synthesis nodes. Can be overridden.
- **Tool call timeout**: each tool invocation within a reasoning node has a timeout, configurable per tool call, default 300 seconds. This is enforced by the registry invocation API.
- **Wall clock timeout for the entire node**: configurable per node, default 900 seconds. If the tool-calling loop runs longer than this (regardless of turn count), the runtime forcibly terminates and the node fails with `wall_clock_timeout`.

All limits have sensible defaults that work for typical workflows. Presets can override them when domain-specific considerations apply (a research synthesis node may need a longer wall clock; a quick sanity check may need a shorter one).

## 8. Implementation Plan

This section sketches how to evolve the current Plurics codebase to implement this document.

### Phase 1 — Backend refactoring (estimated 1 week)

Replace the three current backends (`claude-code`, `process`, `local-llm`) with the new architecture.

- Define the new `AgentBackend` interface with `startConversation`, `sendMessage`, `sendToolResults`, `closeConversation`.
- Implement the `claude` backend against the Anthropic Messages API with support for both direct and proxy modes.
- Implement the `openai-compat` backend for vLLM and other OpenAI-compatible servers.
- Implement the `ollama` backend with native API support and `think: false` handling.
- Implement the `process` dispatch path that invokes a tool directly (shared with tool node runtime).
- Remove the legacy `claude-code` PTY backend, including terminal session management, `waitForOutput`, and chokidar workarounds for Windows NTFS.
- Update the workflow YAML parser to require the `kind` field on nodes and to validate `toolset` on reasoning nodes.

### Phase 2 — Value store (estimated 3 days)

Implement the value store with in-memory scopes and run-level persistence.

- Define the handle format and generation logic.
- Implement scope-local storage as an in-process Map.
- Implement run-level persistence: serialize values to `runs/{runId}/values/` using pickle-base64, load on demand.
- Implement summarizer registration in the schema system and invocation during handle creation.
- Implement handle resolution at input decoding time.
- Wire value store into both reasoning node and tool node runtimes.

### Phase 3 — Tool dispatch in reasoning nodes (estimated 1 week)

Implement the tool-calling loop.

- Generate tool definitions for each backend from registry tool manifests.
- Implement the conversation loop: send initial message, receive response, dispatch tool calls, return results, repeat.
- Implement per-tool retry budget tracking.
- Implement max turns with forced termination message.
- Implement final answer parsing with signal block extraction.
- Implement corrective re-prompt for missing signal blocks.

### Phase 4 — Tool node runtime (estimated 3 days)

Implement the tool node runtime, sharing as much as possible with the tool dispatch used by reasoning nodes.

- Input resolution with upstream references and type checking.
- Direct invocation of the registry API.
- Signal emission with outputs referencing the value store.

### Phase 5 — Workflow migration (estimated 1 week)

Migrate the existing workflows to the new model.

- Update `research-swarm` to use `kind: reasoning` with explicit toolsets and `backend: claude`.
- Update `theorem-prover-mini` similarly, and update the `lean_check` node to be a `kind: tool` node invoking `lean.build` from the registry.
- Update `smoke-test` to exercise all three backends (`claude`, `openai-compat`, `ollama`) and both node kinds.
- Test end-to-end that existing workflows continue to produce the same findings they produced before.

### Phase 6 — Documentation and examples (estimated 3 days)

Write documentation for workflow authors.

- A tutorial on writing a reasoning node with a toolset.
- A tutorial on writing a tool node.
- A guide on choosing a backend for a given node role.
- Examples of the most common patterns: fan-out with reasoning nodes, aggregator nodes, evolutionary pool integration.

### Total timeline

The estimated total is approximately 4-5 weeks of focused work to replace the current node runtimes with the new architecture. Phase 5 (workflow migration) is the most uncertain because it depends on how smoothly the existing workflows adapt to the new model; if a workflow has hidden dependencies on Claude Code's terminal-session behavior, discovering and fixing those may require additional effort.

The new runtime is useful from the end of Phase 4: at that point, new workflows can be written in the new style with registry integration, and the migration of existing workflows happens incrementally.

---

*This document is the authoritative design reference for the Plurics Node Runtimes subsystem. It depends on the Tool Registry design document for the registry's API surface and on the workflow engine design (to be written) for the overall DAG execution semantics. Changes to any of these three documents should be reviewed for consistency with the others.*