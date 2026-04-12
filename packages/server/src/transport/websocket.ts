import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'node:http';
import type { ClientMessage, ServerMessage } from './protocol.js';
import type { AgentRegistry } from '../modules/agents/agent-registry.js';
import type { AgentBootstrap } from '../modules/knowledge/agent-bootstrap.js';
import type { PresetRepository } from '../db/preset-repository.js';
import type { WorkflowRepository } from '../db/workflow-repository.js';
import type { RegistryClient } from '../modules/registry/index.js';
import { DagExecutor } from '../modules/workflow/dag-executor.js';
import { parseWorkflow } from '../modules/workflow/yaml-parser.js';
import { validateInputManifest } from '../modules/workflow/input-validator.js';

export const activeExecutors = new Map<string, DagExecutor>();

export function createWebSocketServer(
  server: http.Server,
  registry: AgentRegistry,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
  workflowRepo: WorkflowRepository,
  projectRoot: string,
  registryClient?: RegistryClient,
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendMessage(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      try {
        await handleMessage(ws, msg, registry, bootstrap, presetRepo, workflowRepo, projectRoot, registryClient);
      } catch (err) {
        sendMessage(ws, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });
  });

  return wss;
}

async function handleMessage(
  ws: WebSocket,
  msg: ClientMessage,
  registry: AgentRegistry,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
  workflowRepo: WorkflowRepository,
  projectRoot: string,
  registryClient?: RegistryClient,
): Promise<void> {
  switch (msg.type) {
    case 'workflow:start': {
      // Validate input manifest if provided
      if (msg.inputManifest) {
        const manifestErrors = validateInputManifest(msg.inputManifest, msg.workspacePath);
        if (manifestErrors.length > 0) {
          sendMessage(ws, { type: 'error', message: `Input manifest errors: ${manifestErrors.map(e => e.message).join('; ')}` });
          return;
        }
      }

      const config = parseWorkflow(msg.yamlContent);

      // Populate _yamlPath so the plugin can be resolved relative to the workflow directory
      if (msg.yamlPath) {
        config._yamlPath = msg.yamlPath;
      }

      // Merge config overrides from input manifest
      if (msg.inputManifest?.config_overrides) {
        config.config = { ...config.config, ...msg.inputManifest.config_overrides } as typeof config.config;
      }

      const executor = new DagExecutor(config, msg.workspacePath, projectRoot, registry, bootstrap, presetRepo, registryClient);

      executor.setStateChangeHandler((runId, node, fromState, toState, event, terminalId) => {
        sendMessage(ws, { type: 'workflow:node-update', runId, node, fromState, toState, event, terminalId });
        sendMessage(ws, { type: 'node:state_changed', timestamp: new Date().toISOString(), runId, payload: { nodeName: node, scope: null, previousState: fromState, newState: toState, attempt: 1 } });
      });

      executor.setCompleteHandler((runId, summary) => {
        workflowRepo.updateRunStatus(runId, summary.failed > 0 ? 'failed' : 'completed', summary.completed, summary.failed);
        sendMessage(ws, { type: 'workflow:completed', runId, summary });
        sendMessage(ws, { type: 'workflow:state_changed', timestamp: new Date().toISOString(), runId, payload: { status: summary.failed > 0 ? 'failed' : 'completed', previousStatus: 'running' } });
        activeExecutors.delete(runId);
      });

      executor.setFindingHandler((runId, hypothesisId, content) => {
        sendMessage(ws, { type: 'workflow:finding', runId, hypothesisId, content });
      });

      executor.setSignalReceivedHandler((runId, signalId, nodeName, scope, status, decisionSummary, outputCount) => {
        sendMessage(ws, { type: 'signal:received', timestamp: new Date().toISOString(), runId, payload: { signalId, nodeName, scope, status, decisionSummary, outputCount } });
      });

      executor.setToolInvokedHandler((runId, toolName, toolVersion, invokingNode, scope, success, durationMs) => {
        sendMessage(ws, { type: 'tool:invoked', timestamp: new Date().toISOString(), runId, payload: { toolName, toolVersion, invokingNode, scope, success, durationMs } });
      });

      activeExecutors.set(executor.runId, executor);

      const nodeCount = Object.keys(config.nodes).length;
      workflowRepo.createRun({
        id: executor.runId,
        workflow_name: config.name,
        workspace_path: msg.workspacePath,
        yaml_content: msg.yamlContent,
        status: 'running',
        node_count: nodeCount,
      });

      // Send workflow:started BEFORE start() so the client has the node list
      // before receiving node-update events
      const initialNodes = Object.keys(config.nodes).map(name => ({ name, state: 'pending' as const, scope: null }));
      sendMessage(ws, { type: 'workflow:started', runId: executor.runId, nodeCount, nodes: initialNodes });

      await executor.start(msg.inputManifest ?? null);
      break;
    }

    case 'workflow:abort': {
      const executor = activeExecutors.get(msg.runId);
      if (!executor) {
        sendMessage(ws, { type: 'error', message: `Workflow run not found: ${msg.runId}` });
        return;
      }
      await executor.abort();
      workflowRepo.updateRunStatus(msg.runId, 'aborted', 0, 0);
      activeExecutors.delete(msg.runId);
      break;
    }

    case 'workflow:pause': {
      const executor = activeExecutors.get(msg.runId);
      if (!executor) {
        sendMessage(ws, { type: 'error', message: `Workflow run not found: ${msg.runId}` });
        return;
      }
      executor.pause();
      sendMessage(ws, { type: 'workflow:paused', runId: msg.runId });
      sendMessage(ws, { type: 'workflow:state_changed', timestamp: new Date().toISOString(), runId: msg.runId, payload: { status: 'paused', previousStatus: 'running' } });
      break;
    }

    case 'workflow:resume': {
      const executor = activeExecutors.get(msg.runId);
      if (!executor) {
        sendMessage(ws, { type: 'error', message: `Workflow run not found: ${msg.runId}` });
        return;
      }
      executor.resume();
      sendMessage(ws, { type: 'workflow:resumed', runId: msg.runId });
      break;
    }

    case 'workflow:status': {
      const run = workflowRepo.getRun(msg.runId);
      if (!run) {
        sendMessage(ws, { type: 'error', message: `Workflow run not found: ${msg.runId}` });
        return;
      }
      const executor = activeExecutors.get(msg.runId);
      if (executor) {
        const nodes = [...executor.getNodes().values()].map(n => ({ name: n.name, state: n.state, scope: n.scope }));
        sendMessage(ws, { type: 'workflow:started', runId: msg.runId, nodeCount: run.node_count, nodes });
      }
      break;
    }

    case 'workflow:resume-run': {
      // Check if already active
      if (activeExecutors.has(msg.runId)) {
        sendMessage(ws, { type: 'error', message: `Run ${msg.runId} is already active` });
        return;
      }

      // Load run from DB
      const run = workflowRepo.getRun(msg.runId);
      if (!run) {
        sendMessage(ws, { type: 'error', message: `Run not found: ${msg.runId}` });
        return;
      }
      if (run.status === 'completed') {
        sendMessage(ws, { type: 'error', message: `Run ${msg.runId} already completed` });
        return;
      }

      // Rebuild executor from stored YAML
      const config = parseWorkflow(run.yaml_content);
      const executor = new DagExecutor(config, run.workspace_path, projectRoot, registry, bootstrap, presetRepo, registryClient);

      executor.setStateChangeHandler((runId, node, fromState, toState, event, terminalId) => {
        sendMessage(ws, { type: 'workflow:node-update', runId, node, fromState, toState, event, terminalId });
        sendMessage(ws, { type: 'node:state_changed', timestamp: new Date().toISOString(), runId, payload: { nodeName: node, scope: null, previousState: fromState, newState: toState, attempt: 1 } });
      });

      executor.setCompleteHandler((runId, summary) => {
        workflowRepo.updateRunStatus(runId, summary.failed > 0 ? 'failed' : 'completed', summary.completed, summary.failed);
        sendMessage(ws, { type: 'workflow:completed', runId, summary });
        sendMessage(ws, { type: 'workflow:state_changed', timestamp: new Date().toISOString(), runId, payload: { status: summary.failed > 0 ? 'failed' : 'completed', previousStatus: 'running' } });
        activeExecutors.delete(runId);
      });

      executor.setFindingHandler((runId, hypothesisId, content) => {
        sendMessage(ws, { type: 'workflow:finding', runId, hypothesisId, content });
      });

      executor.setSignalReceivedHandler((runId, signalId, nodeName, scope, status, decisionSummary, outputCount) => {
        sendMessage(ws, { type: 'signal:received', timestamp: new Date().toISOString(), runId, payload: { signalId, nodeName, scope, status, decisionSummary, outputCount } });
      });

      executor.setToolInvokedHandler((runId, toolName, toolVersion, invokingNode, scope, success, durationMs) => {
        sendMessage(ws, { type: 'tool:invoked', timestamp: new Date().toISOString(), runId, payload: { toolName, toolVersion, invokingNode, scope, success, durationMs } });
      });

      try {
        await executor.resumeFrom(msg.runId);
      } catch (err) {
        sendMessage(ws, { type: 'error', message: `Resume failed: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      activeExecutors.set(msg.runId, executor);
      workflowRepo.updateRunStatus(msg.runId, 'running', 0, 0);

      // Send current state to client
      const nodes = [...executor.getNodes().values()].map(n => ({ name: n.name, state: n.state, scope: n.scope }));
      sendMessage(ws, { type: 'workflow:started', runId: msg.runId, nodeCount: nodes.length, nodes });
      break;
    }

    default:
      sendMessage(ws, { type: 'error', message: `Unknown message type: ${(msg as { type: string }).type}` });
  }
}

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
