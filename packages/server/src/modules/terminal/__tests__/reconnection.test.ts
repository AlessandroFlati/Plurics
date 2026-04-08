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

describe('Reconnection', () => {
  it('list returns existing terminals after reconnect', async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc1', command: 'bash' });
    await waitUntil(msgs1, m => m.type === 'terminal:created');
    const created = msgs1.find(m => m.type === 'terminal:created') as any;
    send(ws1, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    ws1.close();

    const ws2 = await connect();
    const msgs2 = collect(ws2);
    send(ws2, { type: 'terminal:list' });
    const list = await waitUntil(msgs2, m => m.type === 'terminal:list');
    if (list.type !== 'terminal:list') throw new Error('');
    expect(list.terminals.length).toBeGreaterThanOrEqual(1);
    ws2.close();
  });

  it('subscribe to existing terminal receives output via SIGWINCH', { timeout: 10000 }, async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc2', command: 'bash' });
    const created = await waitUntil(msgs1, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws1, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    ws1.close();

    const ws2 = await connect();
    const msgs2 = collect(ws2);
    send(ws2, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const output = await waitUntil(msgs2, m => m.type === 'terminal:output', 8000);
    expect(output.type).toBe('terminal:output');
    ws2.close();
  });

  it('resize existing terminal on reconnect', { timeout: 10000 }, async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc3', command: 'bash' });
    const created = await waitUntil(msgs1, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws1, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    ws1.close();

    const ws2 = await connect();
    const msgs2 = collect(ws2);
    send(ws2, { type: 'terminal:resize', terminalId: created.terminalId, cols: 100, rows: 30 });
    send(ws2, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const output = await waitUntil(msgs2, m => m.type === 'terminal:output', 8000);
    expect(output.type).toBe('terminal:output');
    ws2.close();
  });

  it('multiple clients subscribe to same terminal', { timeout: 10000 }, async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc4', command: 'bash' });
    const created = await waitUntil(msgs1, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws1, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    send(ws1, { type: 'terminal:subscribe', terminalId: created.terminalId });

    const ws2 = await connect();
    const msgs2 = collect(ws2);
    send(ws2, { type: 'terminal:subscribe', terminalId: created.terminalId });

    await new Promise(r => setTimeout(r, 500));
    send(ws1, { type: 'terminal:input', terminalId: created.terminalId, data: 'echo MULTI\n' });

    const out1 = await waitUntil(msgs1, m => m.type === 'terminal:output' && 'data' in m && m.data.includes('MULTI'), 8000);
    const out2 = await waitUntil(msgs2, m => m.type === 'terminal:output' && 'data' in m && m.data.includes('MULTI'), 8000);
    expect(out1.type).toBe('terminal:output');
    expect(out2.type).toBe('terminal:output');
    ws1.close();
    ws2.close();
  });
});
