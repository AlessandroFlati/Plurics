import http from 'node:http';
import express from 'express';
import { TmuxManager } from './modules/terminal/tmux-manager.js';
import { TerminalRegistry } from './modules/terminal/terminal-registry.js';
import { createWebSocketServer } from './transport/websocket.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const app = express();
const server = http.createServer(app);

const tmux = new TmuxManager();
const registry = new TerminalRegistry(tmux);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/terminals', (_req, res) => {
  res.json(registry.list());
});

createWebSocketServer(server, registry);

registry.discover().then((discovered) => {
  if (discovered.length > 0) {
    console.log(`Discovered ${discovered.length} existing tmux session(s)`);
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
