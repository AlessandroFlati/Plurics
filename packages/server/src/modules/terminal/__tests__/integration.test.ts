import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import express from 'express';
import { TmuxManager } from '../tmux-manager.js';
import { TerminalRegistry } from '../terminal-registry.js';
import { createWebSocketServer } from '../../../transport/websocket.js';
import type { ServerMessage, ClientMessage } from '../../../transport/protocol.js';

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

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

function waitFor(ws: WebSocket, predicate: (msg: ServerMessage) => boolean, timeoutMs = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
    ws.on('message', function handler(data) {
      const msg: ServerMessage = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    });
  });
}

beforeEach(async () => {
  const tmux = new TmuxManager();
  registry = new TerminalRegistry(tmux);
  const app = express();
  httpServer = http.createServer(app);
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

describe('End-to-end integration', () => {
  it('spawns a terminal, subscribes, and receives output', { timeout: 15000 }, async () => {
    const ws = await connectClient();

    // Spawn
    send(ws, { type: 'terminal:spawn', name: 'e2e-test', command: 'bash' });
    const created = await waitFor(ws, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('unexpected');
    const terminalId = created.terminalId;

    // Resize triggers pipe-pane + deferred command
    send(ws, { type: 'terminal:resize', terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 800));

    // Subscribe -- should receive screen content as terminal:output
    const outputPromise = waitFor(ws, m => m.type === 'terminal:output');
    send(ws, { type: 'terminal:subscribe', terminalId });
    const output = await outputPromise;
    expect(output.type).toBe('terminal:output');

    ws.close();
  });

  it('lists terminals after spawning', async () => {
    const ws = await connectClient();

    send(ws, { type: 'terminal:spawn', name: 'list-e2e-a', command: 'bash' });
    await waitFor(ws, m => m.type === 'terminal:created');

    send(ws, { type: 'terminal:spawn', name: 'list-e2e-b', command: 'bash' });
    await waitFor(ws, m => m.type === 'terminal:created');

    send(ws, { type: 'terminal:list' });
    const list = await waitFor(ws, m => m.type === 'terminal:list');
    if (list.type !== 'terminal:list') throw new Error('unexpected');
    expect(list.terminals).toHaveLength(2);

    ws.close();
  });
});
