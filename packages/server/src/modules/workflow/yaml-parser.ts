import { parse as parseYaml } from 'yaml';
import type {
  WorkflowConfig,
  WorkflowNodeDef,
  VersionPolicy,
  VersionResolution,
  DestructiveChangeAction,
  InvalidationScope,
} from './types.js';

export function parseWorkflow(yamlContent: string): WorkflowConfig {
  const raw = parseYaml(yamlContent);

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Workflow YAML must be an object');
  }

  assertField(raw, 'name', 'string');
  assertField(raw, 'version', 'number');
  assertField(raw, 'config', 'object');
  assertField(raw, 'nodes', 'object');

  // Only agent_timeout_seconds is required by the platform.
  // All other config keys are domain-specific and passed through to the plugin.
  assertField(raw.config, 'agent_timeout_seconds', 'number');

  // Deprecation: max_parallel_hypotheses was the original name for scope
  // concurrency back when the only workflow was research-swarm and scopes
  // were always hypotheses. The new name (max_parallel_scopes) is domain-
  // agnostic. Both are accepted for one release; the legacy name is aliased
  // into the new one with a warning.
  if (raw.config.max_parallel_hypotheses != null && raw.config.max_parallel_scopes == null) {
    console.warn(
      `[plurics] workflow "${raw.name}": "max_parallel_hypotheses" is deprecated, ` +
      `use "max_parallel_scopes" instead. The old name will be removed in a future release.`
    );
    raw.config.max_parallel_scopes = raw.config.max_parallel_hypotheses;
  }

  if (!raw.shared_context) {
    raw.shared_context = '';
  }

  if (raw.version_policy != null) {
    raw.version_policy = parseVersionPolicy(raw.version_policy, 'version_policy');
  }

  validateNodeGraph(raw.nodes);

  return raw as WorkflowConfig;
}

function parseVersionPolicy(raw: unknown, path: string): VersionPolicy {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`"${path}" must be a mapping`);
  }
  const r = raw as Record<string, unknown>;

  let resolution: VersionResolution = 'pin_at_start';
  if (r.resolution !== undefined) {
    if (r.resolution !== 'pin_at_start' && r.resolution !== 'always_latest') {
      throw new Error(`"${path}.resolution" must be pin_at_start|always_latest (got "${r.resolution}")`);
    }
    resolution = r.resolution as VersionResolution;
  }

  let dynamic_tools: string[] = [];
  if (r.dynamic_tools !== undefined) {
    if (!Array.isArray(r.dynamic_tools) || r.dynamic_tools.some(p => typeof p !== 'string')) {
      throw new Error(`"${path}.dynamic_tools" must be a list of strings`);
    }
    dynamic_tools = r.dynamic_tools as string[];
  }

  let action: DestructiveChangeAction = 'invalidate_and_continue';
  let scope: InvalidationScope | InvalidationScope[] = 'contaminated';
  const odc = r.on_destructive_change;
  if (odc !== undefined) {
    if (typeof odc !== 'object' || odc === null) {
      throw new Error(`"${path}.on_destructive_change" must be a mapping`);
    }
    const odcr = odc as Record<string, unknown>;
    if (odcr.action !== undefined) {
      const VALID_ACTIONS = ['invalidate_and_continue', 'abort', 'ignore'];
      if (!VALID_ACTIONS.includes(odcr.action as string)) {
        throw new Error(`"${path}.on_destructive_change.action" must be one of ${VALID_ACTIONS.join('|')}`);
      }
      action = odcr.action as DestructiveChangeAction;
    }
    if (odcr.scope !== undefined) {
      const VALID_SCOPES = ['contaminated', 'all_findings', 'all_candidates'];
      if (Array.isArray(odcr.scope)) {
        if (odcr.scope.some(s => !VALID_SCOPES.includes(s as string))) {
          throw new Error(`"${path}.on_destructive_change.scope" entries must be one of ${VALID_SCOPES.join('|')}`);
        }
        scope = odcr.scope as InvalidationScope[];
      } else {
        if (!VALID_SCOPES.includes(odcr.scope as string)) {
          throw new Error(`"${path}.on_destructive_change.scope" must be one of ${VALID_SCOPES.join('|')}`);
        }
        scope = odcr.scope as InvalidationScope;
      }
    }
  }

  return { resolution, dynamic_tools, on_destructive_change: { action, scope } };
}

function assertField(obj: Record<string, unknown>, field: string, type: string): void {
  if (!(field in obj)) {
    throw new Error(`Missing required field: "${field}"`);
  }
  if (typeof obj[field] !== type) {
    throw new Error(`Field "${field}" must be ${type}, got ${typeof obj[field]}`);
  }
}

function validateNodeGraph(nodes: Record<string, WorkflowNodeDef>): void {
  const nodeNames = new Set(Object.keys(nodes));

  for (const [name, node] of Object.entries(nodes)) {
    if (!node.preset || typeof node.preset !== 'string') {
      throw new Error(`Node "${name}" must have a "preset" string`);
    }

    for (const dep of node.depends_on ?? []) {
      if (!nodeNames.has(dep)) {
        throw new Error(`Node "${name}" depends on unknown node "${dep}"`);
      }
    }

    for (const dep of node.depends_on_all ?? []) {
      if (!nodeNames.has(dep)) {
        throw new Error(`Node "${name}" depends_on_all unknown node "${dep}"`);
      }
    }

    for (const branch of node.branch ?? []) {
      if (!nodeNames.has(branch.goto)) {
        throw new Error(`Node "${name}" branches to unknown node "${branch.goto}"`);
      }
    }

    if (node.next && !nodeNames.has(node.next)) {
      throw new Error(`Node "${name}" has next="${node.next}" which doesn't exist`);
    }

    validateNodeKind(name, node);
  }

  detectCycles(nodes);
}

function validateNodeKind(name: string, node: WorkflowNodeDef): void {
  if (node.kind === undefined || node.kind === null) {
    throw new Error(`Node "${name}": missing required field 'kind'`);
  }
  if (node.kind !== 'reasoning' && node.kind !== 'tool') {
    throw new Error(
      `Node "${name}": invalid kind '${node.kind}', expected 'reasoning' or 'tool'`
    );
  }
  if (node.kind === 'tool' && !node.tool) {
    throw new Error(`Node "${name}": kind is 'tool' but tool field required`);
  }
  if (node.toolset !== undefined) {
    validateToolset(name, node.toolset as unknown[]);
  }
}

function validateToolset(nodeName: string, toolset: unknown[]): void {
  for (const entry of toolset) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Node "${nodeName}": toolset entry must be an object`);
    }
    const e = entry as Record<string, unknown>;
    const hasName = 'name' in e && typeof e['name'] === 'string';
    const hasCategory = 'category' in e && typeof e['category'] === 'string';
    const hasGlob = 'glob' in e && typeof e['glob'] === 'string';
    if (!hasName && !hasCategory && !hasGlob) {
      throw new Error(
        `Node "${nodeName}": toolset entry must have 'name', 'category', or 'glob' field`
      );
    }
  }
}

// Alias used by type-checker.ts for a stable import name.
export type ParsedWorkflowYaml = WorkflowConfig;

function detectCycles(nodes: Record<string, WorkflowNodeDef>): void {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const name of Object.keys(nodes)) {
    inDegree.set(name, 0);
    adjList.set(name, []);
  }

  for (const [name, node] of Object.entries(nodes)) {
    for (const dep of node.depends_on ?? []) {
      adjList.get(dep)!.push(name);
      inDegree.set(name, inDegree.get(name)! + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adjList.get(node)!) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (visited < Object.keys(nodes).length) {
    const cycleNodes = [...inDegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([name]) => name);

    const allHaveLimit = cycleNodes.every(name => nodes[name].max_invocations != null);
    if (!allHaveLimit) {
      throw new Error(
        `Cycle detected among nodes without max_invocations: ${cycleNodes.join(', ')}`
      );
    }
  }
}
