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

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws: WebSocket, msg: ClientMessage) {
  ws.send(JSON.stringify(msg));
}

function collect(ws: WebSocket): ServerMessage[] {
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  return msgs;
}

function waitUntil(msgs: ServerMessage[], pred: (m: ServerMessage) => boolean, ms = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('waitUntil timeout')), ms);
    const check = setInterval(() => {
      const found = msgs.find(pred);
      if (found) { clearInterval(check); clearTimeout(timeout); resolve(found); }
    }, 50);
  });
}

beforeEach(async () => {
  registry = new TerminalRegistry(new TmuxManager());
  const app = express();
  httpServer = http.createServer(app);
  createWebSocketServer(httpServer, registry);
  await new Promise<void>(r => httpServer.listen(0, r));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  await registry.destroyAll();
  await new Promise<void>(r => httpServer.close(() => r()));
});

describe('Terminal lifecycle', () => {
  it('spawn returns terminal:created', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc1', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    expect(created.type).toBe('terminal:created');
    ws.close();
  });

  it('resize triggers pipe-pane and deferred command', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc2', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const output = await waitUntil(msgs, m => m.type === 'terminal:output');
    expect(output.type).toBe('terminal:output');
    ws.close();
  });

  it('subscribe receives output', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc3', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    await new Promise(r => setTimeout(r, 300));
    send(ws, { type: 'terminal:input', terminalId: created.terminalId, data: 'echo TEST_OUT\n' });
    const output = await waitUntil(msgs, m => m.type === 'terminal:output' && 'data' in m && m.data.includes('TEST_OUT'));
    expect(output.type).toBe('terminal:output');
    ws.close();
  });

  it('kill sends Ctrl+C and session exits', { timeout: 15000 }, async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc4', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    send(ws, { type: 'terminal:kill', terminalId: created.terminalId });
    const exited = await waitUntil(msgs, m => m.type === 'terminal:exited', 10000);
    expect(exited.type).toBe('terminal:exited');
    ws.close();
  });

  it('terminal exits on its own when command ends', { timeout: 15000 }, async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc5', command: 'echo done' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const exited = await waitUntil(msgs, m => m.type === 'terminal:exited', 10000);
    expect(exited.type).toBe('terminal:exited');
    ws.close();
  });

  it('spawn with custom command', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc6', command: 'echo hello' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    expect(created.type).toBe('terminal:created');
    ws.close();
  });
});
