import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createWebSocketServer } from '../websocket.js';
import { TerminalRegistry } from '../../modules/terminal/terminal-registry.js';
import { TmuxManager } from '../../modules/terminal/tmux-manager.js';
import type { ServerMessage, ClientMessage } from '../protocol.js';

let httpServer: http.Server;
let registry: TerminalRegistry;
let port: number;

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

beforeEach(async () => {
  const tmux = new TmuxManager();
  registry = new TerminalRegistry(tmux);
  httpServer = http.createServer();
  createWebSocketServer(httpServer, registry);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as { port: number }).port;
      resolve();
    });
  });
});

afterEach(async () => {
  await registry.destroyAll();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('WebSocket transport', () => {
  it('spawns a terminal and returns terminal:created', async () => {
    const ws = await connectClient();
    send(ws, { type: 'terminal:spawn', name: 'ws-test', command: 'bash' });

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('terminal:created');
    if (msg.type === 'terminal:created') {
      expect(msg.name).toBe('ws-test');
      expect(msg.terminalId).toBeTruthy();
    }
    ws.close();
  });

  it('lists terminals', async () => {
    const ws = await connectClient();
    await registry.spawn({ name: 'list-ws', command: 'bash' });

    send(ws, { type: 'terminal:list' });
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('terminal:list');
    if (msg.type === 'terminal:list') {
      expect(msg.terminals).toHaveLength(1);
      expect(msg.terminals[0].name).toBe('list-ws');
    }
    ws.close();
  });

  it('returns error for unknown message type', async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify({ type: 'bogus' }));

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('error');
    ws.close();
  });
});
