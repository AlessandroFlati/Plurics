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

function waitUntil(msgs: ServerMessage[], pred: (m: ServerMessage) => boolean, ms = 3000): Promise<ServerMessage> {
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

describe('Error handling', () => {
  it('input to non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:input', terminalId: 'nonexistent', data: 'test' });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('kill non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:kill', terminalId: 'nonexistent' });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('resize non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:resize', terminalId: 'nonexistent', cols: 80, rows: 24 });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('subscribe to non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:subscribe', terminalId: 'nonexistent' });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('invalid JSON returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    ws.send('not json');
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });
});
