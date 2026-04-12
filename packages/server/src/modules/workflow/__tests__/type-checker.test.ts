import { describe, it, expect } from 'vitest';
import { checkWorkflow } from '../type-checker.js';
import type { TypeCheckResult } from '../type-checker.js';
import type { ParsedWorkflowYaml } from '../yaml-parser.js';
import type { ToolRecord, ConverterRecord, ListFilters } from '../../registry/types.js';

// ---------- Mock registry ----------

interface MockTool {
  name: string;
  version: number;
  inputs: Array<{ name: string; schemaName: string; required: boolean }>;
  outputs: Array<{ name: string; schemaName: string }>;
  category?: string;
}

interface MockConverter {
  sourceSchema: string;
  targetSchema: string;
  toolName: string;
  toolVersion: number;
}

function makeToolRecord(tool: MockTool): ToolRecord {
  return {
    name: tool.name,
    version: tool.version,
    description: '',
    category: tool.category ?? null,
    tags: [],
    inputs: tool.inputs.map((p, i) => ({
      name: p.name,
      direction: 'input' as const,
      schemaName: p.schemaName,
      required: p.required,
      default: undefined,
      description: null,
      position: i,
    })),
    outputs: tool.outputs.map((p, i) => ({
      name: p.name,
      direction: 'output' as const,
      schemaName: p.schemaName,
      required: true,
      default: undefined,
      description: null,
      position: i,
    })),
    entryPoint: 'tool.py:run',
    language: 'python',
    requires: [],
    stability: null,
    costClass: null,
    author: null,
    createdAt: '2026-01-01',
    toolHash: 'abc123',
    status: 'active',
    directory: '/fake/dir',
  };
}

class MockRegistryClient {
  private tools = new Map<string, ToolRecord>();
  private converters: MockConverter[] = [];

  addTool(tool: MockTool): this {
    this.tools.set(tool.name, makeToolRecord(tool));
    return this;
  }

  addConverter(conv: MockConverter): this {
    this.converters.push(conv);
    return this;
  }

  get(name: string): ToolRecord | null {
    return this.tools.get(name) ?? null;
  }

  list(filters?: ListFilters): ToolRecord[] {
    const all = [...this.tools.values()];
    if (!filters?.category) return all;
    return all.filter((t) => t.category === filters.category);
  }

  findConverter(source: string, target: string): ConverterRecord | null {
    const found = this.converters.find(
      (c) => c.sourceSchema === source && c.targetSchema === target,
    );
    return found ?? null;
  }

  getSchemaRegistry(): object {
    return {};
  }
}

// ---------- Workflow helpers ----------

function makeToolWorkflow(
  overrides: Partial<ParsedWorkflowYaml> = {},
  nodeOverrides: Record<string, object> = {},
): ParsedWorkflowYaml {
  return {
    name: 'test-workflow',
    version: 1,
    config: { agent_timeout_seconds: 60 },
    shared_context: '',
    nodes: nodeOverrides as ParsedWorkflowYaml['nodes'],
    ...overrides,
  } as ParsedWorkflowYaml;
}

// ---------- Tests ----------

describe('checkWorkflow — happy path', () => {
  it('returns ok:true for a well-typed single tool node', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.produce',
      version: 1,
      inputs: [],
      outputs: [{ name: 'result', schemaName: 'Integer' }],
    });

    const workflow = makeToolWorkflow({}, {
      produce: {
        kind: 'tool',
        tool: 'test.produce',
        toolInputs: {},
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.resolvedPlan.nodes.get('produce')?.kind).toBe('tool');
    expect(result.resolvedPlan.nodes.get('produce')?.resolvedToolName).toBe('test.produce');
  });

  it('returns ok:true for two nodes with matching schemas', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.produce',
      version: 1,
      inputs: [],
      outputs: [{ name: 'arr', schemaName: 'NumpyArray' }],
    });
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'arr', schemaName: 'NumpyArray', required: true }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      produce: {
        kind: 'tool',
        tool: 'test.produce',
        toolInputs: {},
        depends_on: [],
      },
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: { arr: '${produce.outputs.arr}' },
        depends_on: ['produce'],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.resolvedPlan.converterInsertions).toHaveLength(0);
  });
});

describe('checkWorkflow — converter auto-insertion', () => {
  it('auto-inserts converter when schemas mismatch but converter is registered', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.produce',
      version: 1,
      inputs: [],
      outputs: [{ name: 'frame', schemaName: 'DataFrame' }],
    });
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'arr', schemaName: 'NumpyArray', required: true }],
      outputs: [],
    });
    registry.addConverter({
      sourceSchema: 'DataFrame',
      targetSchema: 'NumpyArray',
      toolName: 'convert.DataFrame_to_NumpyArray',
      toolVersion: 1,
    });

    const workflow = makeToolWorkflow({}, {
      produce: {
        kind: 'tool',
        tool: 'test.produce',
        toolInputs: {},
        depends_on: [],
      },
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: { arr: '${produce.outputs.frame}' },
        depends_on: ['produce'],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.resolvedPlan.converterInsertions).toHaveLength(1);
    const insertion = result.resolvedPlan.converterInsertions[0];
    expect(insertion.converterTool).toBe('convert.DataFrame_to_NumpyArray');
    expect(insertion.upstreamNode).toBe('produce');
    expect(insertion.downstreamNode).toBe('consume');
  });
});

describe('checkWorkflow — type mismatch errors', () => {
  it('emits type_mismatch when schemas differ and no converter exists', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.produce',
      version: 1,
      inputs: [],
      outputs: [{ name: 'frame', schemaName: 'DataFrame' }],
    });
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'frame', schemaName: 'OhlcFrame', required: true }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      produce: {
        kind: 'tool',
        tool: 'test.produce',
        toolInputs: {},
        depends_on: [],
      },
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: { frame: '${produce.outputs.frame}' },
        depends_on: ['produce'],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].category).toBe('type_mismatch');
    expect(result.errors[0].location.nodeName).toBe('consume');
    expect(result.errors[0].details?.sourceSchema).toBe('DataFrame');
    expect(result.errors[0].details?.targetSchema).toBe('OhlcFrame');
  });

  it('error message contains expected template text per §5.6', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.produce',
      version: 1,
      inputs: [],
      outputs: [{ name: 'frame', schemaName: 'DataFrame' }],
    });
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'frame', schemaName: 'OhlcFrame', required: true }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      produce: {
        kind: 'tool',
        tool: 'test.produce',
        toolInputs: {},
        depends_on: [],
      },
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: { frame: '${produce.outputs.frame}' },
        depends_on: ['produce'],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    const msg = result.errors[0].message;
    expect(msg).toContain('No converter is registered');
    expect(msg).toContain('Possible fixes');
    expect(msg).toContain('DataFrame');
    expect(msg).toContain('OhlcFrame');
    expect(msg).toContain('test-workflow');
  });
});

describe('checkWorkflow — missing required input', () => {
  it('emits missing_required_input when required port is absent', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'values', schemaName: 'JsonArray', required: true }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: {},  // missing 'values'
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].category).toBe('missing_required_input');
    expect(result.errors[0].message).toContain('values');
  });

  it('does not emit error for optional port that is absent', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.tool',
      version: 1,
      inputs: [{ name: 'opt', schemaName: 'String', required: false }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      node: {
        kind: 'tool',
        tool: 'test.tool',
        toolInputs: {},
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
  });
});

describe('checkWorkflow — tool not found', () => {
  it('emits tool_not_found when tool is not in registry', () => {
    const registry = new MockRegistryClient();

    const workflow = makeToolWorkflow({}, {
      node: {
        kind: 'tool',
        tool: 'does.not.exist',
        toolInputs: {},
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].category).toBe('tool_not_found');
    expect(result.errors[0].message).toContain('does.not.exist');
  });
});

describe('checkWorkflow — reasoning node validation', () => {
  it('emits invalid_backend for unsupported backend', () => {
    const registry = new MockRegistryClient();

    const workflow = makeToolWorkflow({}, {
      reason: {
        kind: 'reasoning',
        backend: 'gpt4all',
        preset: 'dummy',
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].category).toBe('invalid_backend');
    expect(result.errors[0].message).toContain('gpt4all');
  });

  it('accepts valid backends (claude, openai-compat, ollama)', () => {
    const registry = new MockRegistryClient();

    for (const backend of ['claude', 'openai-compat', 'ollama']) {
      const workflow = makeToolWorkflow({}, {
        reason: {
          kind: 'reasoning',
          backend,
          preset: 'dummy',
          depends_on: [],
        },
      });
      const result = checkWorkflow(workflow, registry as any, {} as any);
      const backendErrors = result.errors.filter((e) => e.category === 'invalid_backend');
      expect(backendErrors).toHaveLength(0);
    }
  });

  it('emits empty_category warning when category has no tools', () => {
    const registry = new MockRegistryClient();

    const workflow = makeToolWorkflow({}, {
      reason: {
        kind: 'reasoning',
        backend: 'claude',
        preset: 'dummy',
        toolset: [{ category: 'nonexistent.category' }],
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].category).toBe('empty_category');
    expect(result.warnings[0].message).toContain('nonexistent.category');
  });

  it('resolves toolset entries by name', () => {
    const registry = new MockRegistryClient();
    registry.addTool({ name: 'math.add', version: 1, inputs: [], outputs: [] });

    const workflow = makeToolWorkflow({}, {
      reason: {
        kind: 'reasoning',
        backend: 'claude',
        preset: 'dummy',
        toolset: [{ name: 'math.add' }],
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
    expect(result.resolvedPlan.nodes.get('reason')?.resolvedToolset).toContain('math.add');
  });
});

describe('checkWorkflow — invalid upstream reference', () => {
  it('emits invalid_reference for unknown upstream node', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'x', schemaName: 'Integer', required: true }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: { x: '${missing.outputs.x}' },
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].category).toBe('invalid_reference');
    expect(result.errors[0].message).toContain('missing');
  });

  it('emits invalid_reference for depends_on referencing ghost node', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.tool',
      version: 1,
      inputs: [],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      node: {
        kind: 'tool',
        tool: 'test.tool',
        toolInputs: {},
        depends_on: ['ghost_node'],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(false);
    const refErrors = result.errors.filter((e) => e.category === 'invalid_reference');
    expect(refErrors).toHaveLength(1);
    expect(refErrors[0].message).toContain('ghost_node');
  });
});

describe('checkWorkflow — parametrized type compatibility', () => {
  it('ok:true when List[Integer] matches List[Integer]', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.produce',
      version: 1,
      inputs: [],
      outputs: [{ name: 'vals', schemaName: 'List[Integer]' }],
    });
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'vals', schemaName: 'List[Integer]', required: true }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      produce: {
        kind: 'tool',
        tool: 'test.produce',
        toolInputs: {},
        depends_on: [],
      },
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: { vals: '${produce.outputs.vals}' },
        depends_on: ['produce'],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('ok:false when List[Integer] fed to List[Float]', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'test.produce',
      version: 1,
      inputs: [],
      outputs: [{ name: 'vals', schemaName: 'List[Integer]' }],
    });
    registry.addTool({
      name: 'test.consume',
      version: 1,
      inputs: [{ name: 'vals', schemaName: 'List[Float]', required: true }],
      outputs: [],
    });

    const workflow = makeToolWorkflow({}, {
      produce: {
        kind: 'tool',
        tool: 'test.produce',
        toolInputs: {},
        depends_on: [],
      },
      consume: {
        kind: 'tool',
        tool: 'test.consume',
        toolInputs: { vals: '${produce.outputs.vals}' },
        depends_on: ['produce'],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(false);
    expect(result.errors[0].category).toBe('type_mismatch');
  });
});

describe('checkWorkflow — resolved plan', () => {
  it('resolvedPlan.nodes has correct metadata', () => {
    const registry = new MockRegistryClient();
    registry.addTool({
      name: 'math.add',
      version: 2,
      inputs: [{ name: 'a', schemaName: 'Integer', required: true }],
      outputs: [{ name: 'result', schemaName: 'Integer' }],
    });

    const workflow = makeToolWorkflow({}, {
      add_node: {
        kind: 'tool',
        tool: 'math.add',
        toolInputs: { a: 5 },
        depends_on: [],
      },
    });

    const result = checkWorkflow(workflow, registry as any, {} as any);
    expect(result.ok).toBe(true);
    const node = result.resolvedPlan.nodes.get('add_node');
    expect(node?.resolvedVersion).toBe(2);
    expect(node?.resolvedToolName).toBe('math.add');
  });
});
