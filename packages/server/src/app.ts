import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { TerminalRegistry } from './modules/terminal/terminal-registry.js';
import { createWebSocketServer } from './transport/websocket.js';
import { getDb } from './db/database.js';
import { WorkspaceRepository } from './db/workspace-repository.js';

const PORT = parseInt(process.env.PORT ?? '11001', 10);

const app = express();
app.use(express.json());
const server = http.createServer(app);

const registry = new TerminalRegistry();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/terminals', (_req, res) => {
  res.json(registry.list());
});

app.post('/api/validate-path', (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== 'string') {
    res.json({ valid: false, error: 'Path is required' });
    return;
  }
  try {
    const stat = fs.statSync(path);
    if (!stat.isDirectory()) {
      res.json({ valid: false, error: 'Path is not a directory' });
      return;
    }
    res.json({ valid: true });
  } catch {
    res.json({ valid: false, error: 'Path does not exist' });
  }
});

app.get('/api/list-dirs', (req, res) => {
  const prefix = (req.query.prefix as string) || '';
  if (!prefix) {
    res.json([]);
    return;
  }
  try {
    // If prefix ends with /, list contents of that directory
    // Otherwise, list parent directory filtered by the basename prefix
    let dirToRead: string;
    let filter: string;
    if (prefix.endsWith('/') || prefix.endsWith('\\')) {
      dirToRead = prefix;
      filter = '';
    } else {
      dirToRead = path.dirname(prefix);
      filter = path.basename(prefix).toLowerCase();
    }
    const entries = fs.readdirSync(dirToRead, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .filter(e => !filter || e.name.toLowerCase().startsWith(filter))
      .slice(0, 20)
      .map(e => path.join(dirToRead, e.name));
    res.json(dirs);
  } catch {
    res.json([]);
  }
});

const workspaceRepo = new WorkspaceRepository(getDb());

app.get('/api/workspaces', (_req, res) => {
  const workspaces = workspaceRepo.list();
  res.json(workspaces.map(w => ({
    ...w,
    agents: workspaceRepo.getAgents(w.id),
  })));
});

app.post('/api/workspaces', (req, res) => {
  try {
    const ws = workspaceRepo.create(req.body);
    res.json({ ...ws, agents: workspaceRepo.getAgents(ws.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workspace' });
  }
});

app.put('/api/workspaces/:id', (req, res) => {
  workspaceRepo.update(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/workspaces/:id', (req, res) => {
  workspaceRepo.remove(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/workspaces/:id/select', (req, res) => {
  workspaceRepo.select(Number(req.params.id));
  res.json({ ok: true });
});

createWebSocketServer(server, registry);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
