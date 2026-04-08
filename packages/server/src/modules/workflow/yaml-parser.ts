import { parse as parseYaml } from 'yaml';
import type { WorkflowConfig, WorkflowNodeDef } from './types.js';

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

  if (!raw.shared_context) {
    raw.shared_context = '';
  }

  validateNodeGraph(raw.nodes);

  return raw as WorkflowConfig;
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
  }

  detectCycles(nodes);
}

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
