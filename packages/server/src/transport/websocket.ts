import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'node:http';
import type { ClientMessage, ServerMessage } from './protocol.js';
import type { TerminalRegistry } from '../modules/terminal/terminal-registry.js';
import type { AgentBootstrap } from '../modules/knowledge/agent-bootstrap.js';
import type { PresetRepository } from '../db/preset-repository.js';
import type { WorkflowRepository } from '../db/workflow-repository.js';
import { DagExecutor } from '../modules/workflow/dag-executor.js';
import { parseWorkflow } from '../modules/workflow/yaml-parser.js';

const activeExecutors = new Map<string, DagExecutor>();

export function createWebSocketServer(
  server: http.Server,
  registry: TerminalRegistry,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
  workflowRepo: WorkflowRepository,
  projectRoot: string,
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const cleanups: Array<() => void> = [];

    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendMessage(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      try {
        await handleMessage(ws, msg, registry, cleanups, bootstrap, presetRepo, workflowRepo, projectRoot);
      } catch (err) {
        sendMessage(ws, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });

    ws.on('close', () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
    });
  });

  return wss;
}

async function handleMessage(
  ws: WebSocket,
  msg: ClientMessage,
  registry: TerminalRegistry,
  cleanups: Array<() => void>,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
  workflowRepo: WorkflowRepository,
  projectRoot: string,
): Promise<void> {
  switch (msg.type) {
    case 'terminal:spawn': {
      if (msg.cwd) {
        bootstrap.setCwd(msg.cwd);
      }
      const info = await registry.spawn({
        name: msg.name,
        command: msg.command,
        cwd: msg.cwd,
        purpose: msg.purpose,
      });
      if (msg.purpose && msg.name) {
        bootstrap.createAgentFiles(msg.name, msg.purpose);
        bootstrap.regenerateAgentsList(registry.listWithPurpose());
        const session = registry.get(info.id);
        if (session) {
          setTimeout(() => {
            session.write(bootstrap.getInjectionPrompt(msg.name!));
          }, 2000);
        }
      }
      if (msg.presetId) {
        presetRepo.incrementUseCount(msg.presetId);
      }
      sendMessage(ws, {
        type: 'terminal:created',
        terminalId: info.id,
        name: info.name,
      });
      break;
    }

    case 'terminal:input': {
      const session = registry.get(msg.terminalId);
      if (!session) {
        sendMessage(ws, { type: 'error', message: `Terminal not found: ${msg.terminalId}` });
        return;
      }
      session.write(msg.data);
      break;
    }

    case 'terminal:resize': {
      const session = registry.get(msg.terminalId);
      if (!session) {
        sendMessage(ws, { type: 'error', message: `Terminal not found: ${msg.terminalId}` });
        return;
      }
      await session.resize(msg.cols, msg.rows);
      break;
    }

    case 'terminal:kill': {
      await registry.kill(msg.terminalId);
      break;
    }

    case 'terminal:subscribe': {
      const session = registry.get(msg.terminalId);
      if (!session) {
        sendMessage(ws, { type: 'error', message: `Terminal not found: ${msg.terminalId}` });
        return;
      }
      if (session.isCommandRunning) {
        const info = session.info;
        await session.resize(info.cols, info.rows + 1);
        await session.resize(info.cols, info.rows);
      }

      const unsubData = session.onData((data) => {
        sendMessage(ws, {
          type: 'terminal:output',
          terminalId: msg.terminalId,
          data,
        });
      });
      const unsubExit = session.onExit(() => {
        sendMessage(ws, {
          type: 'terminal:exited',
          terminalId: msg.terminalId,
          exitCode: 0,
        });
      });
      cleanups.push(unsubData, unsubExit);
      break;
    }

    case 'terminal:list': {
      sendMessage(ws, {
        type: 'terminal:list',
        terminals: registry.list(),
      });
      break;
    }

    case 'workflow:start': {
      const config = parseWorkflow(msg.yamlContent);
      const executor = new DagExecutor(config, msg.workspacePath, projectRoot, registry, bootstrap, presetRepo);

      executor.setStateChangeHandler((runId, node, fromState, toState, event, terminalId) => {
        sendMessage(ws, { type: 'workflow:node-update', runId, node, fromState, toState, event, terminalId });
      });

      executor.setCompleteHandler((runId, summary) => {
        workflowRepo.updateRunStatus(runId, summary.failed > 0 ? 'failed' : 'completed', summary.completed, summary.failed);
        sendMessage(ws, { type: 'workflow:completed', runId, summary });
        activeExecutors.delete(runId);
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

      await executor.start();
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

    default:
      sendMessage(ws, { type: 'error', message: `Unknown message type: ${(msg as { type: string }).type}` });
  }
}

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
