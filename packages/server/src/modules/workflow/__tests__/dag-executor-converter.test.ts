/**
 * Task 28 — Integration test: 2-node workflow with OhlcFrame→ReturnSeries converter
 *
 * Verifies that DagExecutor automatically inserts and invokes
 * convert.OhlcFrame_to_ReturnSeries when a producer node outputs OhlcFrame
 * and the downstream consumer expects ReturnSeries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DagExecutor } from '../dag-executor.js';
import { RegistryClient } from '../../registry/registry-client.js';
import type { WorkflowConfig } from '../types.js';

// Use __dirname — avoid import.meta.url for CJS compat
const FIXTURES = path.resolve(__dirname, '..', '..', 'registry', '__tests__', 'fixtures');
const SEEDS = path.resolve(__dirname, '..', '..', 'registry', 'seeds', 'tools');

function pythonAvailable(): boolean {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

const pandasAvailable = ((): boolean => {
  if (!pythonAvailable()) return false;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', 'import pandas, numpy'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
})();

describe.skipIf(!pythonAvailable() || !pandasAvailable)(
  'converter insertion end-to-end (OhlcFrame → ReturnSeries)',
  () => {
    let tmpRoot: string;
    let workspacePath: string;
    let rc: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-converter-'));
      workspacePath = path.join(tmpRoot, 'workspace');
      fs.mkdirSync(workspacePath, { recursive: true });

      rc = new RegistryClient({ rootDir: path.join(tmpRoot, 'registry') });
      await rc.initialize();

      // Producer: outputs OhlcFrame
      await rc.register({
        manifestPath: path.join(FIXTURES, 'ohlc_producer', 'tool.yaml'),
        caller: 'human',
      });
      // Consumer: expects ReturnSeries
      await rc.register({
        manifestPath: path.join(FIXTURES, 'return_consumer', 'tool.yaml'),
        caller: 'human',
      });
      // Converter: OhlcFrame → ReturnSeries (seed tool)
      await rc.register({
        manifestPath: path.join(SEEDS, 'convert.OhlcFrame_to_ReturnSeries', 'v1', 'tool.yaml'),
        caller: 'seed',
      });
    });

    afterEach(() => {
      rc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('executes a 2-node workflow with auto-inserted OhlcFrame→ReturnSeries converter', async () => {
      const workflowConfig: WorkflowConfig = {
        name: 'test-ohlc-to-return',
        config: { agent_timeout_seconds: 60 },
        nodes: {
          producer: {
            kind: 'tool',
            tool: 'test.ohlc_producer',
            toolInputs: {},
            depends_on: [],
          },
          consumer: {
            kind: 'tool',
            tool: 'test.return_consumer',
            // Wire producer's ohlc output to consumer's returns input (type mismatch → converter inserted)
            toolInputs: { returns: '${producer.outputs.ohlc}' },
            depends_on: ['producer'],
          },
        },
        _yamlPath: '',
      } as unknown as WorkflowConfig;

      const agentRegistry = { getAgentConfig: () => null } as unknown as import('../../agents/agent-registry.js').AgentRegistry;
      const bootstrap = { setCwd: () => {}, getSystemPrompt: async () => '' } as unknown as import('../../knowledge/agent-bootstrap.js').AgentBootstrap;
      const presetRepo = { findByPath: async () => null } as unknown as import('../../../db/preset-repository.js').PresetRepository;

      const executor = new DagExecutor(
        workflowConfig,
        workspacePath,
        tmpRoot,
        agentRegistry,
        bootstrap,
        presetRepo,
        rc,
      );

      let completed = false;
      executor.setCompleteHandler(() => { completed = true; });

      // start() must not throw (type checker finds converter and inserts it)
      await executor.start();

      // Wait up to 30s for completion
      const deadline = Date.now() + 30_000;
      while (!completed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(completed).toBe(true);

      // 1. converterEventLog must contain an entry for convert.OhlcFrame_to_ReturnSeries
      const converterEvent = executor.converterEventLog.find(
        (e) =>
          e.type === 'converter_inserted' &&
          e.converterTool === 'convert.OhlcFrame_to_ReturnSeries',
      );
      expect(converterEvent).toBeDefined();
      expect(converterEvent?.upstreamNode).toBe('producer');
      expect(converterEvent?.upstreamPort).toBe('ohlc');
      expect(converterEvent?.downstreamNode).toBe('consumer');
      expect(converterEvent?.downstreamPort).toBe('returns');
      expect(typeof converterEvent?.convertedHandle).toBe('string');
      expect(converterEvent?.durationMs).toBeGreaterThanOrEqual(0);

      // 2. Consumer signal file must exist and show success
      const runId = executor.runId;
      const signalDir = path.join(workspacePath, '.plurics', 'runs', runId, 'signals');
      const consumerSignalPath = path.join(signalDir, 'consumer.done.json');
      expect(fs.existsSync(consumerSignalPath)).toBe(true);
      const consumerSignal = JSON.parse(fs.readFileSync(consumerSignalPath, 'utf-8'));
      expect(consumerSignal.status).toBe('success');
    }, 30_000);
  },
);
