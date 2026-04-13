# Frontend React Components — Implementation Spec

**Date:** 2026-04-13 05:26 UTC
**Status:** Approved for implementation
**Parent design doc:** `docs/design/ui.md`
**Scope:** All UI sections missing from current `packages/web/` implementation (~80% of the target design)

---

## 1. Context and Baseline

The frontend lives at `packages/web/src/` (React 18, Vite, TypeScript). Current state is approximately 20% of the design target. The following files already exist and must NOT be replaced — only extended or refactored:

- `App.tsx` — root layout; must be restructured to host the new layout grid
- `components/sidebar/Sidebar.tsx`, `WorkspaceSelector.tsx` — retain as-is
- `components/workflow/DagVisualization.tsx` — retain, augment with kind/model display
- `components/workflow/FindingsPanel.tsx` — retain, integrate into tabbed panel
- `components/workflow/WorkflowPanel.tsx` — retain state hook `useWorkflowState`
- `components/workflow/SourceModal.tsx` — retain as-is
- `services/websocket-client.ts` — extend, do not replace
- `types.ts` — extend with new types, do not remove existing ones

All backend REST endpoints listed in §6 of `docs/design/ui.md` are implemented and available.

---

## 2. Type System Extensions

All new TypeScript types are added to `packages/web/src/types.ts` as an extension block. Existing types are preserved verbatim.

### 2.1 REST API Response Types

```typescript
// Run list / history
interface RunSummary {
  runId: string;
  workflowName: string;
  workflowVersion: number;
  workspacePath: string;
  status: RunStatus;
  startedAt: string;      // ISO 8601
  endedAt: string | null;
  durationSeconds: number | null;
  nodesTotal: number;
  nodesCompleted: number;
  nodesFailed: number;
  nodesRunning: number;
  findingsCount: number;
}

type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'interrupted';

// Run detail / nodes
interface NodeState {
  nodeName: string;
  scope: string | null;
  kind: 'reasoning' | 'tool' | 'converter';
  state: string;
  attempt: number;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  backend?: string;
  model?: string;
  toolName?: string;
  toolVersion?: number;
  lastSignalSummary?: string;
  errorCategory?: string;
  errorMessage?: string;
}

// Events
interface WorkflowEvent {
  eventId: number;
  runId: string;
  timestamp: string;
  category: EventCategory;
  description: string;
  nodeName: string | null;
  scope: string | null;
  payload: Record<string, unknown>;
}

type EventCategory =
  | 'workflow_started' | 'workflow_completed' | 'workflow_failed'
  | 'workflow_paused' | 'workflow_resumed' | 'workflow_aborted'
  | 'node_state_transition' | 'signal_received' | 'tool_invoked'
  | 'plugin_hook_invoked' | 'finding_produced';

// Findings
interface FindingRecord {
  findingId: number;
  runId: string;
  nodeName: string;
  scope: string | null;
  verdict: 'confirmed' | 'falsified' | 'inconclusive';
  summary: string;
  filePath: string;
  producedAt: string;
  content?: string;   // loaded on demand
}

// Registry
interface ToolSummary {
  name: string;
  latestVersion: number;
  category: string;
  description: string;
  tags: string[];
  registeredAt: string;
  registeredBy: 'seed' | 'human' | 'agent';
}

interface ToolDetail extends ToolSummary {
  version: number;
  inputPorts: ToolPort[];
  outputPorts: ToolPort[];
  sourceCode?: string;
  testsSource?: string;
}

interface ToolPort {
  name: string;
  schema: string;
  required: boolean;
  description?: string;
}

interface ToolInvocationRecord {
  invocationId: number;
  runId: string;
  nodeName: string;
  scope: string | null;
  success: boolean;
  durationMs: number;
  invokedAt: string;
}

interface RegistryCategory {
  name: string;
  toolCount: number;
}

// Registry usage (per-run)
interface ToolUsageSummary {
  toolName: string;
  toolVersion: number;
  invocationCount: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  invokingNodes: string[];
}
```

### 2.2 Extended WebSocket Message Types

The existing `ServerMessage` union in `types.ts` is extended with new variants:

```typescript
| { type: 'node:state_changed'; timestamp: string; runId: string;
    payload: { nodeName: string; scope: string | null; previousState: string;
               newState: string; attempt: number;
               details?: { error?: string; dispatchHandle?: string } } }
| { type: 'workflow:state_changed'; timestamp: string; runId: string;
    payload: { status: RunStatus; previousStatus: string } }
| { type: 'signal:received'; timestamp: string; runId: string;
    payload: { signalId: string; nodeName: string; scope: string | null;
               status: 'success' | 'failure' | 'partial';
               decisionSummary?: string; outputCount: number } }
| { type: 'finding:produced'; timestamp: string; runId: string;
    payload: { findingId: number; nodeName: string; scope: string | null;
               verdict: 'confirmed' | 'falsified' | 'inconclusive';
               summary: string; filePath: string } }
| { type: 'tool:invoked'; timestamp: string; runId: string;
    payload: { toolName: string; toolVersion: number; invokingNode: string;
               scope: string | null; success: boolean; durationMs: number } }
| { type: 'registry:tool_registered'; timestamp: string;
    payload: { toolName: string; toolVersion: number; category: string;
               registeredBy: 'seed' | 'human' | 'agent'; runId?: string } }
```

---

## 3. REST API Client (`services/api.ts`)

A single module that wraps all `fetch` calls. All functions are `async` and throw on HTTP error (non-2xx). The base URL is derived from `window.location` (same host, `/api` prefix).

**Runs:**
- `listRuns(filters?: RunFilters): Promise<RunSummary[]>`
- `getRun(runId: string): Promise<RunSummary>`
- `getRunNodes(runId: string): Promise<NodeState[]>`
- `getRunNode(runId: string, nodeName: string): Promise<NodeState>`
- `getRunEvents(runId: string): Promise<WorkflowEvent[]>`
- `getRunFindings(runId: string): Promise<FindingRecord[]>`
- `getFindingContent(runId: string, findingId: number): Promise<string>`
- `getNodeLogs(runId: string, nodeName: string): Promise<{ stdout: string; stderr: string }>`
- `getNodePurpose(runId: string, nodeName: string): Promise<string>`
- `startRun(body: StartRunBody): Promise<{ runId: string }>`
- `pauseRun(runId: string): Promise<void>`
- `resumeRun(runId: string): Promise<void>`
- `abortRun(runId: string): Promise<void>`

**Registry:**
- `listTools(query?: string, category?: string): Promise<ToolSummary[]>`
- `getToolDetail(name: string, version: number): Promise<ToolDetail>`
- `getToolSource(name: string, version: number): Promise<string>`
- `getToolInvocations(name: string, version: number): Promise<ToolInvocationRecord[]>`
- `listCategories(): Promise<RegistryCategory[]>`
- `getRunRegistryUsage(runId: string): Promise<ToolUsageSummary[]>`

**Interface `RunFilters`:** `{ status?: RunStatus; workflowName?: string; since?: string; until?: string }`

Error handling: each function parses the `{ error: { message } }` envelope and re-throws as `Error(message)`.

---

## 4. App Layout Restructuring

`App.tsx` is restructured to a three-column layout:

```
┌──────────────────────────────────────────────────────┐
│  Workspace selector (header strip, full width)        │
├──────────┬───────────────────────────────────────────┤
│ Run      │  Run Detail View (2/3 DAG + 1/3 tabs)     │
│ History  │  OR                                        │
│ Panel    │  Registry Browser (full width within area) │
│ (fixed   │  OR                                        │
│  width)  │  Empty state                               │
└──────────┴───────────────────────────────────────────┘
```

State held in `App.tsx`: `selectedRunId`, `activeView` (`'run-detail' | 'registry'`). The sidebar (existing `Sidebar.tsx`) is retained for workflow start controls. The left panel becomes the `RunHistoryPanel`.

---

## 5. Component Specifications

### 5.1 Run History Section (`components/runs/`)

#### `RunHistoryPanel.tsx`
- Fetches `listRuns()` on mount; subscribes to `workflow:state_changed` and `node:state_changed` WS messages to update badges in-place without full refetch.
- Renders `RunFilters` at top, then a scrollable list of `RunEntry` rows.
- Props: `selectedRunId: string | null`, `onSelectRun: (id: string) => void`, `wsClient: WebSocketClient`.
- State: `runs: RunSummary[]`, `filters: RunFilters`, `loading: boolean`.
- On new `workflow:state_changed` message: update the matching run's status in-place.
- On a new run starting (`workflow:started` WS message): prepend new summary row.

#### `RunEntry.tsx`
- Single row: workflow name, version badge, start time (relative: "3 min ago"), status badge, duration, node summary (`22/47 (12 running)`), findings count.
- Status badge colors: running=yellow, completed=green, failed=red, aborted=gray, paused=orange, interrupted=amber.
- Resume affordance: shows "Resume" button when status is `interrupted` or `paused`.
- Props: `run: RunSummary`, `selected: boolean`, `onClick: () => void`, `onResume: (id: string) => void`.

#### `RunFilters.tsx`
- Filter chips: status filter (multi-select chips: All / Running / Completed / Failed / Paused), workflow name text input.
- Props: `value: RunFilters`, `onChange: (f: RunFilters) => void`.
- All inline, no dialog.

### 5.2 Run Detail Section (`components/runDetail/`)

#### `RunDetailView.tsx`
- Orchestrates the full run detail layout.
- Grid: left 65% = DAG visualizer, right 35% = `RightPanelTabs`.
- Fetches `getRun()`, `getRunNodes()` on mount and on `runId` change.
- Subscribes to `node:state_changed` and `workflow:state_changed` for the current run.
- Renders `RunMetadataHeader` at top.
- Props: `runId: string`, `wsClient: WebSocketClient`.
- State: `run: RunSummary | null`, `nodes: NodeState[]`, `selectedNode: string | null`.

#### `RunMetadataHeader.tsx`
- Narrow strip: workflow name, run ID (truncated with copy button), status badge, start time, duration, metrics (N nodes / N completed / N failed / N findings / N tokens — where token data is available).
- Includes `WorkflowControls`.
- Props: `run: RunSummary`, `onPause: () => void`, `onResume: () => void`, `onAbort: () => void`.

#### `WorkflowControls.tsx`
- Pause / Resume / Abort buttons. Each enabled/disabled based on `run.status`.
- Calls `api.pauseRun`, `api.resumeRun`, `api.abortRun`. Shows loading spinner per button during pending request.
- Props: `runId: string`, `status: RunStatus`.

#### `RightPanelTabs.tsx`
- Four tabs: Findings / Events / Node Detail / Registry Usage.
- Tab state is local. `nodeDetail` tab is automatically activated when `selectedNode` changes.
- Props: `runId: string`, `selectedNode: string | null`, `wsClient: WebSocketClient`.
- Renders the appropriate child component per active tab; lazy-loads tab content (don't fetch until tab first activated).

### 5.3 DAG Visualizer Updates (`components/workflow/DagVisualization.tsx`)

The existing component is augmented (not replaced):

- Accept `nodes: NodeState[]` (new type) in addition to the legacy `DagNode[]` interface — maintain backward compat via overloaded prop type.
- Node box display: for `kind === 'tool'` nodes, show tool name in a small secondary line under node name. For `kind === 'reasoning'` nodes, show backend/model in secondary line on hover tooltip.
- Node colors follow the existing `STATE_COLORS` palette — no changes.
- Add `onNodeSelect: (nodeName: string | null) => void` prop; clicking a node calls this.
- Converter ghost toggle: a checkbox in DAG controls labeled "Show converters". When unchecked (default), nodes with `kind === 'converter'` are hidden from the layout (removed from both nodes and edges). When checked, they render with dashed outline style.
- The layout engine re-runs when nodes change; zoom/pan state is preserved via `useRef`.

### 5.4 Events Stream (`components/events/`)

#### `EventsStream.tsx`
- Fetches `getRunEvents(runId)` on mount.
- Subscribes to all relevant WS message types; appends new events to top of list.
- Renders `EventFilters` + scrollable list of `EventLine` rows.
- Props: `runId: string`, `wsClient: WebSocketClient`.
- State: `events: WorkflowEvent[]`, `activeCategories: Set<EventCategory>`.

#### `EventLine.tsx`
- One line: timestamp (HH:mm:ss), category badge, description, affected node/scope.
- Clicking the row expands to show full JSON payload in a `<pre>` block.
- Props: `event: WorkflowEvent`.
- State: `expanded: boolean`.

#### `EventFilters.tsx`
- Toggle chips per event category. "All" chip resets to show everything.
- Props: `active: Set<EventCategory>`, `onChange: (s: Set<EventCategory>) => void`.

### 5.5 Node Detail Tab (`components/nodeDetail/`)

#### `NodeDetailTab.tsx`
- If `selectedNode` is null: renders placeholder "Select a node in the DAG to inspect it."
- Fetches `getRunNode(runId, nodeName)` when `selectedNode` changes.
- Routes to `ReasoningNodeView`, `ToolNodeView`, or base view based on `node.kind`.
- Always renders common fields: name, scope, state, attempt, dependencies, times, duration.
- If `node.state === 'failed'`: renders `NodeErrorView` at top.
- Props: `runId: string`, `selectedNode: string | null`.

#### `ReasoningNodeView.tsx`
- Displays: backend, model, toolset (comma-separated), purpose prompt (fetched via `getNodePurpose`, rendered as `<pre>` for now — markdown render is a future enhancement), tool-call trace from signals, total tokens (if available from node metadata), LLM latency.
- Props: `runId: string`, `node: NodeState`.

#### `ToolNodeView.tsx`
- Displays: tool name, version, resolved inputs (JSON block), outputs (JSON block), stdout/stderr (fetched via `getNodeLogs`, shown in a scrollable `<pre>` with monospace font), invocation duration.
- Props: `runId: string`, `node: NodeState`.

#### `NodeErrorView.tsx`
- Renders error category as a red badge, full error message, stack trace in collapsible `<pre>`.
- Props: `errorCategory: string`, `errorMessage: string`, `stackTrace?: string`.

### 5.6 Registry Usage Tab (`components/registryUsage/`)

#### `RegistryUsageTab.tsx`
- Fetches `getRunRegistryUsage(runId)` on mount and on `tool:invoked` WS events.
- Renders a table of `ToolUsageEntry` rows, sorted by `totalDurationMs` descending.
- Props: `runId: string`, `wsClient: WebSocketClient`, `onNavigateToTool: (name: string) => void`.
- State: `usage: ToolUsageSummary[]`, `loading: boolean`.

#### `ToolUsageEntry.tsx`
- One row: tool name (clickable link, calls `onNavigateToTool`), version, invocation count, success/failure split (`N ok / M fail`), total duration (formatted: `1.2s` / `342ms`), invoking nodes (comma list, truncated to 3 + "…").
- Props: `entry: ToolUsageSummary`, `onNavigate: (name: string) => void`.

### 5.7 Tool Registry Browser (`components/registry/`)

#### `RegistryBrowser.tsx`
- Root component. Three-pane layout: left 25% = `ToolTree` + `RegistrySearch`, center/right 75% = `ToolDetailPane`.
- Fetches `listCategories()` and `listTools()` on mount.
- Subscribes to `registry:tool_registered` WS messages to append new tools.
- State: `categories: RegistryCategory[]`, `tools: ToolSummary[]`, `selectedTool: { name: string; version: number } | null`, `searchQuery: string`.
- Props: `wsClient: WebSocketClient`, `initialToolName?: string` (for navigation from registry usage tab).

#### `RegistrySearch.tsx`
- Controlled text input. Debounced (300ms) calls `listTools(query)` and updates the tool list.
- Props: `value: string`, `onChange: (q: string) => void`.

#### `ToolTree.tsx`
- Renders categories as collapsible sections; tools under each category as clickable rows.
- Active tool is highlighted.
- Props: `categories: RegistryCategory[]`, `tools: ToolSummary[]`, `selectedTool: string | null`, `onSelectTool: (name: string, version: number) => void`.
- State: `expanded: Set<string>` (which categories are open; all open by default if total tools < 50).

#### `ToolDetailPane.tsx`
- Shown when a tool is selected. Fetches `getToolDetail(name, version)` on selection.
- Tab bar within the pane: Overview / Source / Tests / Invocation History.
- Overview tab renders `ToolManifestView`.
- Source tab renders `ToolSourceViewer`.
- Tests tab renders the tests source code + "Run Tests" button.
- History tab renders `ToolInvocationHistory`.
- Props: `toolName: string`, `toolVersion: number`.

#### `ToolManifestView.tsx`
- Displays: name, version, category, description, tags (chips), input ports table (name / schema / required), output ports table.
- Props: `tool: ToolDetail`.

#### `ToolSourceViewer.tsx`
- Fetches `getToolSource(name, version)` and renders in a `<pre>` block with monospace font and line numbers.
- A "Copy" button copies the source to clipboard.
- Props: `toolName: string`, `toolVersion: number`.

#### `ToolInvocationHistory.tsx`
- Fetches `getToolInvocations(name, version)`.
- Renders a table: run ID (truncated), node, scope, success badge, duration, timestamp.
- Props: `toolName: string`, `toolVersion: number`.

---

## 6. Styling Convention

The existing codebase uses **inline styles** with CSS custom properties (e.g., `var(--color-bg)`, `var(--color-text-primary)`, `var(--color-accent)`, `var(--color-border)`). There is one global `theme.css` file. New components follow the same pattern: inline styles only, no CSS modules, no external CSS files except for the existing `DagVisualization.css` and `WorkflowPanel.css` (which are retained).

Color conventions carried forward:
- Background: `var(--color-bg, #181818)`
- Text primary: `var(--color-text-primary, #e0e0e0)`
- Text secondary: `var(--color-text-secondary, #888)`
- Accent (tabs, selection): `var(--color-accent, #569cd6)`
- Border: `var(--color-border, #333)`
- Status badge colors: green=`#4ade80`, yellow=`#facc15`, red=`#f87171`, orange=`#fb923c`, gray=`#525252`, amber=`#f59e0b`

---

## 7. WebSocket Extension

`services/websocket-client.ts` is extended minimally: the `MessageHandler` type is broadened to accept the new `ServerMessage` variants. No structural changes to the class are required — the existing `onMessage` subscription pattern handles new message types automatically once `types.ts` is updated.

A new `useWorkflowEvents` hook in `hooks/useWorkflowEvents.ts` encapsulates the pattern of subscribing to a websocket client, filtering messages by `runId`, and updating local state. This hook is used by `RunDetailView`, `EventsStream`, `RegistryUsageTab`, and `RunHistoryPanel` — avoiding four separate copies of the subscription boilerplate.

---

## 8. Constraints Summary

| Constraint | Rule |
|---|---|
| State management | React hooks only — no Zustand, no Redux |
| File size | One component per file, target < 300 lines |
| Tests | None — no test framework exists, do not add one |
| CSS | Inline styles + CSS variables only |
| TypeScript | Strict; all props typed; no `any` |
| API client | All REST calls go through `services/api.ts` |
| WebSocket | All WS subscriptions go through existing `WebSocketClient` |
| New files | Prefer editing existing files; create new files only for new components |
| Imports | Full paths from `src/` root; no relative `../../..` beyond one level |
