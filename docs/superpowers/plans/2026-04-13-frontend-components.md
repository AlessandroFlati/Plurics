# Frontend React Components — Implementation Plan

**Date:** 2026-04-13 05:26 UTC
**Spec:** `docs/superpowers/specs/2026-04-13-frontend-components-design.md`
**Design doc:** `docs/design/ui.md`
**Target directory:** `packages/web/src/`
**Task count:** 25

---

## Prerequisites

- All backend endpoints from `docs/design/ui.md` §5-§6 are implemented (confirmed).
- The frontend builds cleanly: `cd packages/web && npm run build` passes before starting.
- Read the spec fully before executing any task.
- Execute tasks in order — later tasks depend on types and hooks created in earlier tasks.

---

## Task 1 — Extend `types.ts` with new shared types

**Files:** `packages/web/src/types.ts`

Add to the bottom of `types.ts` (do not remove anything existing):

1. `RunStatus` type alias (`'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'interrupted'`).
2. `RunSummary` interface — all fields from spec §2.1.
3. `NodeState` interface — `nodeName`, `scope`, `kind: 'reasoning' | 'tool' | 'converter'`, `state`, `attempt`, timing fields, optional backend/model/toolName/toolVersion, `lastSignalSummary`, `errorCategory`, `errorMessage`.
4. `WorkflowEvent` interface and `EventCategory` type.
5. `FindingRecord` interface (note: existing `Finding` type in WorkflowPanel stays; this is the REST-backed richer type).
6. `ToolSummary`, `ToolDetail`, `ToolPort`, `ToolInvocationRecord`, `RegistryCategory`, `ToolUsageSummary` interfaces.
7. `RunFilters` interface.
8. Extend the `ServerMessage` union with the six new WS message variants from spec §2.2. The existing variants stay — append new entries to the union.

**Verification:** `npx tsc --noEmit` in `packages/web/` passes with no new errors.

---

## Task 2 — Create `services/api.ts`

**Files:** `packages/web/src/services/api.ts` (new file)

Create the REST API client module. Full implementation:

```typescript
const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, options);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}
```

Implement all functions listed in spec §3:

**Run functions:**
- `listRuns(filters?)` — builds query string from filters object, calls `GET /runs`.
- `getRun(runId)` — `GET /runs/:runId`.
- `getRunNodes(runId)` — `GET /runs/:runId/nodes`.
- `getRunNode(runId, nodeName)` — `GET /runs/:runId/nodes/:nodeName`.
- `getRunEvents(runId)` — `GET /runs/:runId/events`.
- `getRunFindings(runId)` — `GET /runs/:runId/findings`.
- `getFindingContent(runId, findingId)` — `GET /runs/:runId/findings/:findingId`, returns `string`.
- `getNodeLogs(runId, nodeName)` — `GET /runs/:runId/logs/:nodeName`, returns `{ stdout, stderr }`.
- `getNodePurpose(runId, nodeName)` — `GET /runs/:runId/purposes/:nodeName`, returns `string`.
- `startRun(body)` — `POST /runs/start`, body is JSON.
- `pauseRun(runId)` — `POST /runs/:runId/pause`.
- `resumeRun(runId)` — `POST /runs/:runId/resume`.
- `abortRun(runId)` — `POST /runs/:runId/abort`.

**Registry functions:**
- `listTools(query?, category?)` — `GET /registry/tools` with optional query params.
- `getToolDetail(name, version)` — `GET /registry/tools/:name/:version`.
- `getToolSource(name, version)` — `GET /registry/tools/:name/:version/source`, returns `string` (text, not JSON envelope).
- `getToolInvocations(name, version)` — `GET /registry/tools/:name/:version/invocations`.
- `listCategories()` — `GET /registry/categories`.
- `getRunRegistryUsage(runId)` — `GET /runs/:runId/registry-usage`.

All functions exported. The file must be under 120 lines total.

**Verification:** Module imports cleanly with no TypeScript errors.

---

## Task 3 — Create `hooks/useWorkflowEvents.ts`

**Files:** `packages/web/src/hooks/useWorkflowEvents.ts` (new file)

This hook centralizes WS subscription + runId filtering. Signature:

```typescript
function useWorkflowEvents(
  wsClient: WebSocketClient | null,
  runId: string | null,
  handler: (msg: ServerMessage) => void
): void
```

Implementation:
- Use `useEffect` to call `wsClient.onMessage(handler)` — store the unsubscribe function from the return value and call it in the cleanup.
- The handler is called for ALL messages; the caller filters by `runId` inside their handler if needed. (The hook does NOT filter — keeping it simple.)
- Re-subscribe when `wsClient` or `runId` changes.
- Memoize `handler` with `useCallback` at the call site (document this requirement in JSDoc).

The file is < 30 lines.

---

## Task 4 — Create `components/runs/RunFilters.tsx`

**Files:** `packages/web/src/components/runs/RunFilters.tsx` (new file)

Props:
```typescript
interface RunFiltersProps {
  value: RunFilters;
  onChange: (f: RunFilters) => void;
}
```

Render:
- A horizontal flex row of status chips: "All", "Running", "Completed", "Failed", "Paused", "Interrupted".
- Clicking a chip sets `value.status` (or unsets it for "All").
- A text input for `value.workflowName` filter (placeholder: "Filter by workflow name…").
- Active chip has `background: var(--color-accent, #569cd6)`, inactive chips have transparent background with border.
- Styles: inline only. Container has `padding: 8px 12px`, `display: flex`, `gap: 8px`, `alignItems: center`, `borderBottom: '1px solid var(--color-border, #333)'`.

Status chip accent colors (background when active):
- Running: `#facc15`, text black.
- Completed: `#4ade80`, text black.
- Failed: `#f87171`, text black.
- Paused: `#fb923c`, text black.
- Interrupted: `#f59e0b`, text black.
- All: `var(--color-accent, #569cd6)`, text white.

---

## Task 5 — Create `components/runs/RunEntry.tsx`

**Files:** `packages/web/src/components/runs/RunEntry.tsx` (new file)

Props:
```typescript
interface RunEntryProps {
  run: RunSummary;
  selected: boolean;
  onClick: () => void;
  onResume: (runId: string) => void;
}
```

Layout (horizontal flex row):
- Left: status color bar (4px wide, full height, color matches status).
- Center: two-line block:
  - Line 1: `run.workflowName` in bold, version badge (`v{N}` in a small pill), `run.startedAt` formatted as relative time ("3 min ago", "2 hours ago") using a simple helper function.
  - Line 2: node summary (`{completed}/{total}` for completed runs, `{completed}/{total} ({running} running)` for running), findings count (`{N} findings` if > 0).
- Right: status badge (text label + background color per status), duration (`{N}s` or `{N}m {N}s`), and "Resume" button if status is `'interrupted'` or `'paused'`.

Helper `formatRelative(isoString: string): string` — inline in the file. Uses `Date.now() - Date.parse(isoString)` and returns human string.

Selected row: `background: 'var(--color-bg-elevated, #232323)'`, normal row: transparent. On hover: subtle background change.

Cursor: `pointer`. Padding: `10px 12px`.

"Resume" button: small, inline, calls `onResume(run.runId)` and `stopPropagation()`.

---

## Task 6 — Create `components/runs/RunHistoryPanel.tsx`

**Files:** `packages/web/src/components/runs/RunHistoryPanel.tsx` (new file)

Props:
```typescript
interface RunHistoryPanelProps {
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onResumeRun: (runId: string) => void;
  wsClient: WebSocketClient | null;
}
```

State: `runs: RunSummary[]`, `filters: RunFilters`, `loading: boolean`, `error: string | null`.

Lifecycle:
1. On mount: `setLoading(true)`, call `listRuns()`, set `runs`, `setLoading(false)`.
2. Use `useWorkflowEvents` hook to subscribe. In the handler:
   - On `workflow:state_changed`: find the matching `runId` in `runs` and update its `status` in place using functional state update.
   - On `workflow:started` (existing `ServerMessage` variant `workflow:started`): prepend a new `RunSummary` stub to `runs` (populate what's available from the WS message, set `findingsCount: 0`, `nodesCompleted: 0`, etc.).
3. When `filters` changes: re-call `listRuns(filters)` and replace `runs`.

Layout (vertical flex, fixed width 280px):
- Header: "Run History" title, filter chips row (`RunFilters`).
- Body: if `loading`: centered spinner text "Loading…". If `error`: red error text. If `runs` is empty: "No runs found." centered. Otherwise: scrollable list of `RunEntry` rows.

Import `RunEntry`, `RunFilters`, `listRuns` from api, `useWorkflowEvents` hook.

---

## Task 7 — Create `components/runDetail/WorkflowControls.tsx`

**Files:** `packages/web/src/components/runDetail/WorkflowControls.tsx` (new file)

Props:
```typescript
interface WorkflowControlsProps {
  runId: string;
  status: RunStatus;
}
```

Three buttons: Pause, Resume, Abort.

Enabled states:
- Pause: enabled when `status === 'running'`.
- Resume: enabled when `status === 'interrupted' || status === 'paused'`.
- Abort: enabled when `status === 'running' || status === 'paused' || status === 'interrupted'`.

Each button has independent loading state (`pauseLoading`, `resumeLoading`, `abortLoading`). On click: set loading true, call appropriate api function, catch error and display inline (state `actionError: string | null`), finally set loading false.

Styles: horizontal flex, gap 8px. Buttons: small (fontSize 12, padding `4px 10px`), rounded border, matching colors:
- Pause: border `#facc15`, text `#facc15`.
- Resume: border `#4ade80`, text `#4ade80`.
- Abort: border `#f87171`, text `#f87171`.
Disabled: opacity 0.4, cursor not-allowed.

If `actionError`: render it in small red text below the buttons.

---

## Task 8 — Create `components/runDetail/RunMetadataHeader.tsx`

**Files:** `packages/web/src/components/runDetail/RunMetadataHeader.tsx` (new file)

Props:
```typescript
interface RunMetadataHeaderProps {
  run: RunSummary;
}
```

A narrow horizontal strip (height ~52px) with:
- Left: workflow name (bold, 14px), run ID (monospace, 11px, truncated to 8 chars + `…`, with a small copy button that calls `navigator.clipboard.writeText(run.runId)`).
- Center: status badge (background color per status, text label), start time, duration if available.
- Right: metrics: `{nodesCompleted}/{nodesTotal} nodes`, `{findingsCount} findings`.
- Far right: `WorkflowControls` component.

Background: `var(--color-bg-elevated, #1e1e1e)`. Border-bottom: `1px solid var(--color-border, #333)`. Padding: `0 16px`.

Imports `WorkflowControls`.

---

## Task 9 — Create `components/events/EventFilters.tsx`

**Files:** `packages/web/src/components/events/EventFilters.tsx` (new file)

Props:
```typescript
interface EventFiltersProps {
  active: Set<EventCategory>;
  onChange: (s: Set<EventCategory>) => void;
}
```

A chip row. One "All" chip (clears/fills the set). Then one chip per `EventCategory` value. Toggling a chip adds/removes it from the set.

Displayed labels for categories:
- `workflow_started` → "Started"
- `workflow_completed` → "Completed"
- `workflow_failed` → "Failed"
- `node_state_transition` → "Node transitions"
- `signal_received` → "Signals"
- `tool_invoked` → "Tool calls"
- `finding_produced` → "Findings"
- Others: title-case the raw value.

Active chips: `background: var(--color-accent, #569cd6)`. Container: scrollable horizontal row, `flexWrap: 'wrap'`, `gap: 6px`, `padding: 6px 12px`.

---

## Task 10 — Create `components/events/EventLine.tsx`

**Files:** `packages/web/src/components/events/EventLine.tsx` (new file)

Props: `event: WorkflowEvent`.
State: `expanded: boolean`.

Collapsed layout (single flex row):
- Timestamp: `HH:mm:ss` from `event.timestamp` — inline `formatTime` helper.
- Category badge: small pill with background color per category group:
  - Workflow lifecycle: `#569cd6` (blue).
  - Node transitions: `#facc15` (yellow).
  - Signal/finding: `#4ade80` (green).
  - Tool: `#fb923c` (orange).
- Description: `event.description` (truncated to 80 chars on collapsed).
- Node/scope: if `event.nodeName`, show in small gray text.
- Right: chevron icon (▼/▶) showing expand state.

Expanded state: reveals full `description` (no truncation) + `<pre>` block with `JSON.stringify(event.payload, null, 2)`.

Click on row: toggle `expanded`. Cursor: pointer.

Border-bottom: `1px solid var(--color-border, #333)`. Padding: `6px 12px`.

---

## Task 11 — Create `components/events/EventsStream.tsx`

**Files:** `packages/web/src/components/events/EventsStream.tsx` (new file)

Props:
```typescript
interface EventsStreamProps {
  runId: string;
  wsClient: WebSocketClient | null;
}
```

State: `events: WorkflowEvent[]`, `activeCategories: Set<EventCategory>` (all enabled by default), `loading: boolean`.

Lifecycle:
1. On `runId` change: fetch `getRunEvents(runId)`, set `events`.
2. Use `useWorkflowEvents` hook. On `node:state_changed`, `signal:received`, `tool:invoked`, `finding:produced`, `workflow:state_changed` messages matching `runId`: convert to a `WorkflowEvent`-shaped object and prepend to `events`. The conversion maps WS message fields to the `WorkflowEvent` interface (synthesize `eventId: Date.now()`, fill `category` and `description` from message type).

Filtered events: `events.filter(e => activeCategories.size === 0 || activeCategories.has(e.category))`.

Render: `EventFilters` at top, then a `div` with `overflow: auto` containing one `EventLine` per filtered event.

Note: events are prepended (newest first) in the live feed. Historical events from REST are ordered by the server (newest first as well, if the API returns that order — check; if oldest first, reverse on load).

---

## Task 12 — Create `components/nodeDetail/NodeErrorView.tsx`

**Files:** `packages/web/src/components/nodeDetail/NodeErrorView.tsx` (new file)

Props:
```typescript
interface NodeErrorViewProps {
  errorCategory: string;
  errorMessage: string;
  stackTrace?: string;
}
```

State: `stackExpanded: boolean`.

Layout:
- Red badge pill: `errorCategory` text.
- `errorMessage` in a `<p>` with color `#f87171`.
- If `stackTrace`: a "Show stack trace" toggle button. When expanded: `<pre>` with monospace 11px font, background `#1a0000`, padding, border-radius, overflow-x scroll.

Container: `background: rgba(248, 113, 113, 0.08)`, `borderLeft: '3px solid #f87171'`, `padding: '10px 12px'`, `marginBottom: 12`.

---

## Task 13 — Create `components/nodeDetail/ReasoningNodeView.tsx`

**Files:** `packages/web/src/components/nodeDetail/ReasoningNodeView.tsx` (new file)

Props:
```typescript
interface ReasoningNodeViewProps {
  runId: string;
  node: NodeState;
}
```

State: `purpose: string | null`, `purposeLoading: boolean`, `logs: { stdout: string; stderr: string } | null`.

Lifecycle: on `node.nodeName` change, fetch `getNodePurpose(runId, node.nodeName)` and store in `purpose`.

Sections rendered in order:
1. **Backend / Model**: two-column grid, label `Backend` and label `Model`, values from `node.backend` and `node.model` (or "—" if absent).
2. **Purpose prompt**: label "Purpose", then the `purpose` string in a `<pre>` block (monospace 12px, background `#1a1a1a`, max-height 200px, overflow auto).
3. **Tokens**: show `node` metadata fields if available. If absent: "Token data not available."
4. **Tool-call trace**: placeholder text "Tool-call trace available in node signals." for this implementation phase.

---

## Task 14 — Create `components/nodeDetail/ToolNodeView.tsx`

**Files:** `packages/web/src/components/nodeDetail/ToolNodeView.tsx` (new file)

Props:
```typescript
interface ToolNodeViewProps {
  runId: string;
  node: NodeState;
}
```

State: `logs: { stdout: string; stderr: string } | null`, `logsLoading: boolean`.

Lifecycle: on `node.nodeName` change, fetch `getNodeLogs(runId, node.nodeName)` and store.

Sections:
1. **Tool**: `node.toolName` (bold) `v{node.toolVersion}`.
2. **Invocation duration**: `{node.durationMs}ms` or "—".
3. **stdout**: `<pre>` with monospace 11px, max-height 160px, overflow auto. Empty stdout: italic "No output."
4. **stderr**: same format. Empty: italic "No stderr."

---

## Task 15 — Create `components/nodeDetail/NodeDetailTab.tsx`

**Files:** `packages/web/src/components/nodeDetail/NodeDetailTab.tsx` (new file)

Props:
```typescript
interface NodeDetailTabProps {
  runId: string;
  selectedNode: string | null;
}
```

State: `node: NodeState | null`, `loading: boolean`, `error: string | null`.

Lifecycle: on `selectedNode` change, if not null: fetch `getRunNode(runId, selectedNode)` and store.

Render:
- If `selectedNode === null`: centered placeholder text "Select a node in the DAG to inspect it."
- If `loading`: "Loading node…"
- If `error`: red error text.
- If `node`:
  1. Common section (always shown):
     - Name, scope (if any), state badge, attempt counter.
     - Start/end times, duration.
     - Attempt counter if > 1.
  2. If `node.state === 'failed'`: `<NodeErrorView>` with error fields from node.
  3. Kind-specific view:
     - `kind === 'reasoning'`: `<ReasoningNodeView runId={runId} node={node} />`
     - `kind === 'tool'`: `<ToolNodeView runId={runId} node={node} />`
     - `kind === 'converter'`: same as tool node view (converters are essentially tool nodes).

Import all three sub-components. File stays under 100 lines by delegating.

---

## Task 16 — Create `components/registryUsage/ToolUsageEntry.tsx`

**Files:** `packages/web/src/components/registryUsage/ToolUsageEntry.tsx` (new file)

Props:
```typescript
interface ToolUsageEntryProps {
  entry: ToolUsageSummary;
  onNavigate: (toolName: string) => void;
}
```

One table row (`<tr>`):
- Tool name: clickable, calls `onNavigate(entry.toolName)`, styled as link (accent color, underline on hover).
- Version: `v{entry.toolVersion}`.
- Invocations: `{entry.invocationCount}`.
- Success/failure: `{entry.successCount} ok / {entry.failureCount} fail` — failure count in red if > 0.
- Duration: format as `Xms` if < 1000ms, `X.Xs` if < 60000ms, `Xm Xs` otherwise.
- Nodes: `entry.invokingNodes.slice(0, 3).join(', ')` + `' …'` if length > 3.

---

## Task 17 — Create `components/registryUsage/RegistryUsageTab.tsx`

**Files:** `packages/web/src/components/registryUsage/RegistryUsageTab.tsx` (new file)

Props:
```typescript
interface RegistryUsageTabProps {
  runId: string;
  wsClient: WebSocketClient | null;
  onNavigateToTool: (toolName: string) => void;
}
```

State: `usage: ToolUsageSummary[]`, `loading: boolean`.

Lifecycle:
1. On `runId` change: fetch `getRunRegistryUsage(runId)`, sort by `totalDurationMs` descending, set `usage`.
2. Use `useWorkflowEvents` hook. On `tool:invoked` message with matching `runId`: find the tool in `usage` by name+version, increment counts and add duration. If not found: append a new entry.

Render: if empty, show "No tool invocations recorded for this run." Otherwise render a `<table>` with columns: Tool / Version / Invocations / Success-Failure / Duration / Nodes. Each row is a `ToolUsageEntry`.

Table styles: `width: '100%'`, `borderCollapse: 'collapse'`. Header row: `background: var(--color-bg-elevated, #1e1e1e)`, sticky (`position: sticky; top: 0`). Row border-bottom: `1px solid var(--color-border, #333)`. Cell padding: `6px 10px`.

---

## Task 18 — Create `components/runDetail/RightPanelTabs.tsx`

**Files:** `packages/web/src/components/runDetail/RightPanelTabs.tsx` (new file)

Props:
```typescript
interface RightPanelTabsProps {
  runId: string;
  selectedNode: string | null;
  wsClient: WebSocketClient | null;
  onNavigateToTool: (toolName: string) => void;
}
```

State: `activeTab: 'findings' | 'events' | 'node' | 'registry'`. Default: `'findings'`.

Effect: when `selectedNode` changes from `null` to a non-null value, auto-switch to `'node'` tab.

Tab bar: four buttons styled like existing `App.tsx` tab buttons (see lines 68-101 of `App.tsx`): border-bottom 2px accent when active, transparent otherwise.

Tab content area: `flex: 1`, `overflow: auto`. Render only the active tab's component (no hidden mounting — mount on first activation and keep mounted via `display: none` to avoid redundant fetches). Actually: for simplicity, just conditionally render based on `activeTab`. Each sub-component handles its own data fetching so remounting on tab switch triggers a re-fetch, which is acceptable at this stage.

Tab components:
- `'findings'`: `<FindingsPanel runId={runId} wsClient={wsClient} />` — this wraps the existing `FindingsPanel` with the REST-backed version (see Task 19).
- `'events'`: `<EventsStream runId={runId} wsClient={wsClient} />`.
- `'node'`: `<NodeDetailTab runId={runId} selectedNode={selectedNode} />`.
- `'registry'`: `<RegistryUsageTab runId={runId} wsClient={wsClient} onNavigateToTool={onNavigateToTool} />`.

---

## Task 19 — Create `components/findings/FindingCard.tsx`

**Files:** `packages/web/src/components/findings/FindingCard.tsx` (new file)

Props:
```typescript
interface FindingCardProps {
  finding: FindingRecord;
  runId: string;
}
```

State: `expanded: boolean`, `content: string | null`, `contentLoading: boolean`.

Collapsed: a card with:
- Verdict badge: `confirmed` = green `#4ade80`, `falsified` = red `#f87171`, `inconclusive` = gray `#888`. Badge text is title-case verdict.
- Summary line: `finding.summary`.
- Metadata line (small gray): node name, scope if any, timestamp formatted as relative.
- Expand chevron.

Expanded: additionally render `content` in a `<pre>` block (monospace, overflow-x auto). On first expansion, fetch `getFindingContent(runId, finding.findingId)` and store. Show "Loading…" while fetching.

Card style: `background: var(--color-bg-elevated, #1e1e1e)`, `borderRadius: 6`, `padding: 10px 12px`, `marginBottom: 8`, `cursor: pointer`.

Highlight animation: if the card is "new" (prop `isNew?: boolean`), apply a brief CSS animation via a `@keyframes` rule injected in a `<style>` tag on first mount, or simply set `backgroundColor` with a state-driven animation. Use the simpler state approach: `isNew` prop triggers a `useEffect` that sets a `highlight: boolean` state to true for 1500ms (via `setTimeout`), rendering a slightly brighter background during that window.

---

## Task 20 — Create REST-backed `components/findings/FindingsPanel.tsx` wrapper

**Files:** `packages/web/src/components/findings/RunFindingsPanel.tsx` (new file; the existing `FindingsPanel.tsx` under `components/workflow/` is unchanged)

This is a new component (not replacing the old one) that wraps `FindingCard` rows for the run detail context.

Props:
```typescript
interface RunFindingsPanelProps {
  runId: string;
  wsClient: WebSocketClient | null;
}
```

State: `findings: FindingRecord[]`, `loading: boolean`, `newFindingIds: Set<number>`.

Lifecycle:
1. On `runId` change: fetch `getRunFindings(runId)`, set `findings`.
2. Use `useWorkflowEvents` hook. On `finding:produced` matching `runId`: prepend a new `FindingRecord` stub (from the WS payload fields), add its `findingId` to `newFindingIds`, remove from `newFindingIds` after 2000ms.

Render: scrollable `div`, each `FindingRecord` rendered as `<FindingCard finding={f} runId={runId} isNew={newFindingIds.has(f.findingId)} />`.

If empty: "No findings produced by this run yet."

---

## Task 21 — Create `components/runDetail/RunDetailView.tsx`

**Files:** `packages/web/src/components/runDetail/RunDetailView.tsx` (new file)

Props:
```typescript
interface RunDetailViewProps {
  runId: string;
  wsClient: WebSocketClient | null;
  onNavigateToTool: (toolName: string) => void;
}
```

State: `run: RunSummary | null`, `nodes: NodeState[]`, `selectedNode: string | null`, `loading: boolean`.

Lifecycle:
1. On `runId` change: fetch `getRun(runId)` and `getRunNodes(runId)` in parallel (use `Promise.all`).
2. Use `useWorkflowEvents` hook. On `node:state_changed` matching `runId`: update the matching node in `nodes` (find by `nodeName` + `scope`, update `state` and `attempt`). On `workflow:state_changed` matching `runId`: update `run.status`.

Layout: full-height vertical flex column:
1. `<RunMetadataHeader run={run} />` — flex-shrink 0.
2. Horizontal flex row (flex: 1, min-height 0):
   - Left (65% width): `<DagVisualization nodes={nodes} yamlContent={''}` with `onNodeSelect={setSelectedNode}` added prop — see Task 22 for DAG changes.
   - Right (35% width, border-left): `<RightPanelTabs runId={runId} selectedNode={selectedNode} wsClient={wsClient} onNavigateToTool={onNavigateToTool} />`.

Both columns have `overflow: hidden` at the outer level; internal scrolling is within each component.

---

## Task 22 — Update `DagVisualization.tsx` for new node taxonomy

**Files:** `packages/web/src/components/workflow/DagVisualization.tsx`

This task modifies the existing file. Read it fully before editing.

Changes to make:

1. **Broaden accepted props**: Add optional `onNodeSelect?: (nodeName: string | null) => void` prop. Add optional `nodesDetail?: NodeState[]` prop (the richer type from `types.ts`).

2. **Secondary label in node box**: In the SVG `<text>` or `<foreignObject>` block for each node, add a second `<text>` element rendering a secondary label:
   - If `nodesDetail` contains an entry for this node with `kind === 'tool'`: secondary label = `tool.toolName ?? ''`.
   - If `kind === 'reasoning'`: secondary label = `tool.backend ?? ''` (shown in tooltip on hover, not inline, to preserve node box size).
   - Secondary label style: font-size 10px, fill `rgba(255,255,255,0.5)`.

3. **Click handler**: When a node box is clicked, call `onNodeSelect(node.name)`. When the SVG background is clicked (not a node), call `onNodeSelect(null)`.

4. **Selected node highlight**: if a `selectedNode` prop is provided (added alongside `onNodeSelect`), render that node box with a 2px white border stroke instead of the default 1px.

5. **Converter ghost toggle**: Add a boolean state `showConverters` (default `false`). Add a small toggle button in the component's control bar area labeled "Show converters". When false: filter out nodes where their `nodesDetail` entry has `kind === 'converter'` before layout. When true: include them but render with `strokeDasharray="4 2"` on the rect border.

Keep all existing functionality intact. Do not change the color palette, layout algorithm, or pan/zoom handling.

---

## Task 23 — Create Registry Browser tree and search

**Files:**
- `packages/web/src/components/registry/RegistrySearch.tsx` (new)
- `packages/web/src/components/registry/ToolTree.tsx` (new)

**`RegistrySearch.tsx`:**

Props: `value: string`, `onChange: (q: string) => void`.
State: `localValue: string` (mirrors prop), uses `useEffect` to debounce calling `onChange` 300ms after `localValue` changes.

Renders: a text input, full-width, with placeholder "Search tools by name, description, or tag…", styled with dark background, border `var(--color-border, #333)`, padding `8px 12px`, font-size 13px.

**`ToolTree.tsx`:**

Props:
```typescript
interface ToolTreeProps {
  categories: RegistryCategory[];
  tools: ToolSummary[];
  selectedTool: string | null;
  onSelectTool: (name: string, version: number) => void;
}
```

State: `expanded: Set<string>`.
Init: if total tools < 50, expand all categories by default.

For each category:
- A clickable header row with the category name, tool count badge, and expand arrow.
- When expanded: the tools in that category as clickable rows.

Tool row: category filtered via `tools.filter(t => t.category === cat.name)`.
Selected tool row: highlighted background.
Tool row shows: name (bold), version badge, tags (up to 3, as small colored chips).

Layout: vertical scroll in a fixed-width panel (set by parent). Padding: 0. Headers: `padding: 8px 12px`, bold, cursor pointer. Tool rows: `padding: 6px 20px` (indented), cursor pointer.

---

## Task 24 — Create Registry Browser detail pane

**Files:**
- `packages/web/src/components/registry/ToolManifestView.tsx` (new)
- `packages/web/src/components/registry/ToolSourceViewer.tsx` (new)
- `packages/web/src/components/registry/ToolInvocationHistory.tsx` (new)
- `packages/web/src/components/registry/ToolDetailPane.tsx` (new)

**`ToolManifestView.tsx`:**

Props: `tool: ToolDetail`.
Render: description paragraph, tags as chips (background `var(--color-accent, #569cd6)` with opacity, small text), then two tables (input ports / output ports). Each table: columns Name / Schema / Required. `required: true` shown as "yes" with green dot; false as "no".

**`ToolSourceViewer.tsx`:**

Props: `toolName: string`, `toolVersion: number`.
State: `source: string | null`, `loading: boolean`, `error: string | null`.
On mount: fetch `getToolSource(toolName, toolVersion)`.
Render: "Copy" button (top-right) that calls `navigator.clipboard.writeText(source)`. Then `<pre>` with `font-family: monospace`, `font-size: 12px`, `line-height: 1.5`, `overflow: auto`, `background: #111`, `padding: 12px`, `borderRadius: 4px`. Add simple line numbers via split/map: each line wrapped in a `<span>` with a `::before` CSS counter (use inline counter via index + 1 padded to 3 chars).

**`ToolInvocationHistory.tsx`:**

Props: `toolName: string`, `toolVersion: number`.
State: `invocations: ToolInvocationRecord[]`, `loading: boolean`.
On mount: fetch `getToolInvocations(toolName, toolVersion)`.
Render: table with columns: Run ID / Node / Scope / Result / Duration / Time. Run ID truncated to 8 chars. Result: green "ok" or red "fail". Duration: formatted. Time: relative.

**`ToolDetailPane.tsx`:**

Props: `toolName: string`, `toolVersion: number`.
State: `tool: ToolDetail | null`, `loading: boolean`, `activeTab: 'overview' | 'source' | 'tests' | 'history'`.
On `toolName` or `toolVersion` change: fetch `getToolDetail(toolName, toolVersion)`.
Render: title bar with `tool.name v{tool.version}` and category badge. Tab bar (Overview / Source / Tests / History). Tab content:
- Overview: `<ToolManifestView tool={tool} />`.
- Source: `<ToolSourceViewer toolName={toolName} toolVersion={toolVersion} />`.
- Tests: `<ToolSourceViewer>` variant using tests source — or a placeholder "Tests viewer coming soon." if tests source is not differentiated by the API in this phase.
- History: `<ToolInvocationHistory toolName={toolName} toolVersion={toolVersion} />`.

---

## Task 25 — Create `RegistryBrowser.tsx` and wire `App.tsx`

**Files:**
- `packages/web/src/components/registry/RegistryBrowser.tsx` (new)
- `packages/web/src/App.tsx` (modify)

**`RegistryBrowser.tsx`:**

Props:
```typescript
interface RegistryBrowserProps {
  wsClient: WebSocketClient | null;
  initialToolName?: string | null;
}
```

State: `categories: RegistryCategory[]`, `tools: ToolSummary[]`, `selectedTool: { name: string; version: number } | null`, `searchQuery: string`, `loading: boolean`.

Lifecycle:
1. On mount: `Promise.all([listCategories(), listTools()])` — set state.
2. When `searchQuery` changes (debounced via `RegistrySearch`): call `listTools(searchQuery)` and update `tools`.
3. When `initialToolName` changes and is non-null: find that tool in `tools`, auto-select it.
4. Use `useWorkflowEvents` for `registry:tool_registered` messages: append a new `ToolSummary` stub to `tools` and refresh `categories`.

Layout: horizontal flex, full height.
- Left panel (280px, fixed, border-right): `<RegistrySearch>` at top, then `<ToolTree>` below (scrollable).
- Right panel (flex: 1): if `selectedTool` is null: centered "Select a tool from the list." Otherwise: `<ToolDetailPane toolName={selectedTool.name} toolVersion={selectedTool.version} />`.

**`App.tsx` rewiring:**

Read the current `App.tsx` before editing. Replace the layout with the new three-panel structure:

1. Add state: `selectedRunId: string | null`, `activeView: 'run-detail' | 'registry'`, `navigateToTool: string | null`.
2. Replace the current left sidebar area with `<RunHistoryPanel>` at a fixed 280px width.
3. Replace the main content area:
   - If `activeView === 'run-detail'` and `selectedRunId`: render `<RunDetailView runId={selectedRunId} wsClient={wsRef.current} onNavigateToTool={(name) => { setNavigateToTool(name); setActiveView('registry'); }} />`.
   - If `activeView === 'registry'`: render `<RegistryBrowser wsClient={wsRef.current} initialToolName={navigateToTool} />`.
   - If neither: render the existing empty state text.
4. Keep the existing `<Sidebar>` at its current position (it contains the workflow start controls).
5. Add a small top nav strip: "Runs" and "Registry" buttons to switch `activeView`. Style like existing tab buttons.

Preserve the existing `useWorkflowState` hook usage from `WorkflowPanel` — it is still needed for the sidebar's workflow start flow. When a new run starts via the sidebar, set `selectedRunId` to the new run's ID and `activeView` to `'run-detail'`.

---

## Execution Order and Dependencies

```
Task 1  →  Task 2  →  Task 3  (foundation: types, API, hook)
Task 4, 5  (independent, depend on Task 1)
Task 6  (depends on 3, 4, 5)
Task 7, 8  (depend on 2)
Task 9, 10  (independent, depend on 1)
Task 11  (depends on 3, 9, 10)
Task 12, 13, 14  (depend on 2)
Task 15  (depends on 12, 13, 14)
Task 16  (depends on 1)
Task 17  (depends on 3, 16)
Task 18  (depends on 15, 17, 11; also needs Task 20)
Task 19  (depends on 2)
Task 20  (depends on 3, 19)
Task 21  (depends on 8, 18, 22)
Task 22  (modifies existing file; depends on 1)
Task 23  (depends on 2)
Task 24  (depends on 2, 23)
Task 25  (depends on all above; modifies App.tsx last)
```

Safe parallel batches:
- Batch A: Tasks 1-3 (sequential within batch).
- Batch B: Tasks 4, 5, 7, 9, 10, 12 (all depend only on Task 1 or 2).
- Batch C: Tasks 6, 8, 11, 13, 14, 16, 22 (depend on Batch B).
- Batch D: Tasks 15, 17, 19, 23, 24 (depend on Batch C).
- Batch E: Tasks 18, 20, 21 (depend on Batch D).
- Batch F: Task 25 (depends on everything).

---

## Verification Checklist

After all tasks are complete:

1. `cd packages/web && npm run build` — zero TypeScript errors, zero Vite build errors.
2. Open `http://localhost:11000` in browser; confirm new layout renders (no blank screen).
3. Run history panel loads and shows existing runs.
4. Clicking a run entry opens run detail view with DAG on left and tabbed panel on right.
5. Events tab shows events stream for the selected run.
6. Node detail tab shows placeholder when no node selected; shows node info after clicking a DAG node.
7. Registry browser renders tool tree after clicking the "Registry" nav button.
8. No console errors from TypeScript strict mode violations or undefined prop accesses.

---

## Notes

- The existing `FindingsPanel.tsx` under `components/workflow/` is NOT removed — it is still used by the sidebar's live-run view. The new `RunFindingsPanel.tsx` is the REST-backed version used in `RightPanelTabs`.
- `WorkflowPanel.tsx` and its `useWorkflowState` hook are retained intact — the sidebar still uses them for the workflow start/live-monitor flow. The new `RunDetailView` is a separate, cleaner component for the post-start inspection UX.
- Do not add any npm packages without first checking if an equivalent utility can be written inline in < 20 lines. The existing `package.json` shows no UI library dependencies; this should remain true.
- The `DagVisualization.css` file stays unchanged. All new styles are inline.
