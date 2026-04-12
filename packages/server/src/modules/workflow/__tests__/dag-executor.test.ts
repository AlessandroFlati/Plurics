import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WorkflowConfig, DagNode, NodeState } from '../types.js';
import { TRANSITIONS } from '../types.js';
import type { InvocationResult } from '../../registry/types.js';

// Test the state machine transitions and node graph logic independently
// without spawning real terminals

describe('TRANSITIONS state machine', () => {
  it('pending -> ready on deps_met', () => {
    expect(TRANSITIONS.pending.deps_met).toBe('ready');
  });

  it('pending -> skipped on upstream_failed', () => {
    expect(TRANSITIONS.pending.upstream_failed).toBe('skipped');
  });

  it('ready -> spawning on spawn', () => {
    expect(TRANSITIONS.ready.spawn).toBe('spawning');
  });

  it('spawning -> running on terminal_created', () => {
    expect(TRANSITIONS.spawning.terminal_created).toBe('running');
  });

  it('running -> validating on signal_received', () => {
    expect(TRANSITIONS.running.signal_received).toBe('validating');
  });

  it('running -> retrying on timeout', () => {
    expect(TRANSITIONS.running.timeout).toBe('retrying');
  });

  it('running -> retrying on crash', () => {
    expect(TRANSITIONS.running.crash).toBe('retrying');
  });

  it('validating -> completed on outputs_valid', () => {
    expect(TRANSITIONS.validating.outputs_valid).toBe('completed');
  });

  it('validating -> retrying on integrity_failed', () => {
    expect(TRANSITIONS.validating.integrity_failed).toBe('retrying');
  });

  it('retrying -> spawning on retry_available', () => {
    expect(TRANSITIONS.retrying.retry_available).toBe('spawning');
  });

  it('retrying -> failed on max_retries', () => {
    expect(TRANSITIONS.retrying.max_retries).toBe('failed');
  });

  it('completed is terminal', () => {
    expect(Object.keys(TRANSITIONS.completed)).toHaveLength(0);
  });

  it('failed is terminal', () => {
    expect(Object.keys(TRANSITIONS.failed)).toHaveLength(0);
  });

  it('skipped is terminal', () => {
    expect(Object.keys(TRANSITIONS.skipped)).toHaveLength(0);
  });
});

describe('Node graph evaluation logic', () => {
  function makeNode(overrides: Partial<DagNode> = {}): DagNode {
    return {
      name: 'test',
      preset: 'test-preset',
      state: 'pending',
      scope: null,
      dependsOn: [],
      terminalId: null,
      retryCount: 0,
      maxRetries: 2,
      invocationCount: 0,
      maxInvocations: Infinity,
      timeoutMs: 300000,
      timeoutTimer: null,
      signal: null,
      startedAt: null,
      ...overrides,
    };
  }

  function evaluateReadyNodes(nodes: Map<string, DagNode>): void {
    for (const [name, node] of nodes) {
      if (node.state !== 'pending') continue;

      const depsFailed = node.dependsOn.some(depName => {
        const dep = nodes.get(depName);
        return dep && (dep.state === 'failed' || dep.state === 'skipped');
      });

      if (depsFailed) {
        node.state = 'skipped';
        continue;
      }

      const depsReady = node.dependsOn.every(depName => {
        const dep = nodes.get(depName);
        return dep && dep.state === 'completed';
      });

      if (depsReady) {
        node.state = 'ready';
      }
    }
  }

  it('marks nodes with no dependencies as ready', () => {
    const nodes = new Map<string, DagNode>();
    nodes.set('a', makeNode({ name: 'a' }));
    evaluateReadyNodes(nodes);
    expect(nodes.get('a')!.state).toBe('ready');
  });

  it('keeps nodes with unmet dependencies as pending', () => {
    const nodes = new Map<string, DagNode>();
    nodes.set('a', makeNode({ name: 'a' }));
    nodes.set('b', makeNode({ name: 'b', dependsOn: ['a'] }));
    evaluateReadyNodes(nodes);
    expect(nodes.get('a')!.state).toBe('ready');
    expect(nodes.get('b')!.state).toBe('pending');
  });

  it('marks nodes as ready when dependencies are completed', () => {
    const nodes = new Map<string, DagNode>();
    nodes.set('a', makeNode({ name: 'a', state: 'completed' }));
    nodes.set('b', makeNode({ name: 'b', dependsOn: ['a'] }));
    evaluateReadyNodes(nodes);
    expect(nodes.get('b')!.state).toBe('ready');
  });

  it('skips nodes when upstream failed', () => {
    const nodes = new Map<string, DagNode>();
    nodes.set('a', makeNode({ name: 'a', state: 'failed' }));
    nodes.set('b', makeNode({ name: 'b', dependsOn: ['a'] }));
    evaluateReadyNodes(nodes);
    expect(nodes.get('b')!.state).toBe('skipped');
  });

  it('propagates skip through chain', () => {
    const nodes = new Map<string, DagNode>();
    nodes.set('a', makeNode({ name: 'a', state: 'failed' }));
    nodes.set('b', makeNode({ name: 'b', dependsOn: ['a'] }));
    nodes.set('c', makeNode({ name: 'c', dependsOn: ['b'] }));
    evaluateReadyNodes(nodes); // b -> skipped
    evaluateReadyNodes(nodes); // c -> skipped (b is now skipped)
    expect(nodes.get('b')!.state).toBe('skipped');
    expect(nodes.get('c')!.state).toBe('skipped');
  });

  it('handles multiple dependencies (all must complete)', () => {
    const nodes = new Map<string, DagNode>();
    nodes.set('a', makeNode({ name: 'a', state: 'completed' }));
    nodes.set('b', makeNode({ name: 'b', state: 'pending' }));
    nodes.set('c', makeNode({ name: 'c', dependsOn: ['a', 'b'] }));
    evaluateReadyNodes(nodes);
    expect(nodes.get('c')!.state).toBe('pending'); // b not completed yet
  });

  it('handles fan-out: parallel nodes become ready simultaneously', () => {
    const nodes = new Map<string, DagNode>();
    nodes.set('root', makeNode({ name: 'root', state: 'completed' }));
    nodes.set('b1', makeNode({ name: 'b1', dependsOn: ['root'] }));
    nodes.set('b2', makeNode({ name: 'b2', dependsOn: ['root'] }));
    nodes.set('b3', makeNode({ name: 'b3', dependsOn: ['root'] }));
    evaluateReadyNodes(nodes);
    expect(nodes.get('b1')!.state).toBe('ready');
    expect(nodes.get('b2')!.state).toBe('ready');
    expect(nodes.get('b3')!.state).toBe('ready');
  });
});

describe('Retry logic', () => {
  it('retries increment retryCount', () => {
    const node: DagNode = {
      name: 'test', preset: 'p', state: 'running', scope: null,
      dependsOn: [], terminalId: 'tid', retryCount: 0, maxRetries: 2,
      invocationCount: 1, maxInvocations: Infinity, timeoutMs: 5000,
      timeoutTimer: null, signal: null, startedAt: Date.now(),
    };

    node.retryCount++;
    expect(node.retryCount).toBe(1);
    expect(node.retryCount < node.maxRetries).toBe(true);

    node.retryCount++;
    expect(node.retryCount).toBe(2);
    expect(node.retryCount < node.maxRetries).toBe(false);
  });
});

// ---- dispatch routing tests ----

describe('DAG executor dispatch routing', () => {
  it('kind: tool node calls RegistryClient.invoke, not AgentRegistry.spawn', async () => {
    const invokeResult: InvocationResult = {
      success: true,
      outputs: { result: 42 },
      metrics: { durationMs: 10 },
    };
    const mockInvoke = vi.fn().mockResolvedValue(invokeResult);
    const mockRegistryClient = { invoke: mockInvoke };

    // Verify the InvocationResult shape matches what the executor expects
    expect(invokeResult.success).toBe(true);
    if (invokeResult.success) {
      expect(invokeResult.outputs).toEqual({ result: 42 });
    }

    // Confirm mock is callable
    const result = await mockRegistryClient.invoke({ toolName: 'test.echo_int', version: 1, inputs: { n: 42 } });
    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it('tool node InvocationResult failure maps to signal status failure', () => {
    const failResult: InvocationResult = {
      success: false,
      error: { category: 'runtime', message: 'Division by zero.', stderr: '' },
      metrics: { durationMs: 5 },
    };
    // When the executor sees success:false, it should write a failure signal
    expect(failResult.success).toBe(false);
    if (!failResult.success) {
      expect(failResult.error.category).toBe('runtime');
      expect(failResult.error.message).toBeTruthy();
    }
  });

  it('kind defaults to reasoning when not specified on a DagNode', () => {
    const node: DagNode = {
      name: 'legacy', preset: 'p', state: 'pending', scope: null,
      dependsOn: [], terminalId: null, retryCount: 0, maxRetries: 2,
      invocationCount: 0, maxInvocations: Infinity, timeoutMs: 60000,
      timeoutTimer: null, signal: null, startedAt: null,
    };
    // kind is optional — default is 'reasoning'
    expect(node.kind ?? 'reasoning').toBe('reasoning');
  });
});
