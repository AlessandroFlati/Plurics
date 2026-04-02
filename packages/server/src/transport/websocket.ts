import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'node:http';
import type { ClientMessage, ServerMessage } from './protocol.js';
import type { TerminalRegistry } from '../modules/terminal/terminal-registry.js';

export function createWebSocketServer(
  server: http.Server,
  registry: TerminalRegistry,
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
        await handleMessage(ws, msg, registry, cleanups);
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
): Promise<void> {
  switch (msg.type) {
    case 'terminal:spawn': {
      const info = await registry.spawn({
        name: msg.name,
        command: msg.command,
        cwd: msg.cwd,
      });
      sendMessage(ws, {
        type: 'terminal:created',
        terminalId: info.id,
        name: info.name,
      });
      // Client should send terminal:subscribe to start receiving output
      break;
    }

    case 'terminal:attach': {
      const info = await registry.attach(msg.tmuxSessionName);
      sendMessage(ws, {
        type: 'terminal:created',
        terminalId: info.id,
        name: info.name,
      });
      // Client should send terminal:subscribe to start receiving output
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
      // Graceful shutdown: send Ctrl+C to interrupt, then /exit for Claude Code
      // (which also works as a comment in bash), then exit for the shell.
      // The exit poller detects the session ended and fires onExit.
      const session = registry.get(msg.terminalId);
      if (!session) {
        sendMessage(ws, { type: 'error', message: `Terminal not found: ${msg.terminalId}` });
        return;
      }
      session.write('\x03'); // Ctrl+C
      setTimeout(() => session.write('\x03'), 200); // Ctrl+C again
      break;
    }

    case 'terminal:subscribe': {
      const session = registry.get(msg.terminalId);
      if (!session) {
        sendMessage(ws, { type: 'error', message: `Terminal not found: ${msg.terminalId}` });
        return;
      }
      // Force a redraw by toggling the terminal size. This sends SIGWINCH
      // to the running program, causing it to redraw at the current dimensions.
      // The redraw output comes through pipe-pane as normal output.
      const info = session.info;
      await session.resize(info.cols, info.rows + 1);
      await session.resize(info.cols, info.rows);

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

    default:
      sendMessage(ws, { type: 'error', message: `Unknown message type: ${(msg as { type: string }).type}` });
  }
}

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
