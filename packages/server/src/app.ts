import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { TerminalRegistry } from './modules/terminal/terminal-registry.js';
import { createWebSocketServer } from './transport/websocket.js';
import { getDb } from './db/database.js';
import { WorkspaceRepository } from './db/workspace-repository.js';
import { PresetRepository } from './db/preset-repository.js';
import { WorkflowRepository } from './db/workflow-repository.js';
import { AgentBootstrap } from './modules/knowledge/agent-bootstrap.js';
import { KnowledgeWatcher } from './modules/knowledge/knowledge-watcher.js';
import { seedPresetsFromFilesystem } from './modules/workflow/preset-resolver.js';

const PORT = parseInt(process.env.PORT ?? '11001', 10);

const app = express();
app.use(express.json());
const server = http.createServer(app);

const registry = new TerminalRegistry();
const bootstrap = new AgentBootstrap();
const watcher = new KnowledgeWatcher(registry);

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

app.get('/api/list-files', (req, res) => {
  const dir = req.query.dir as string;
  const extensions = ((req.query.extensions as string) || '').split(',').filter(Boolean);
  if (!dir) { res.json({ files: [] }); return; }
  try {
    const files = fs.readdirSync(dir)
      .filter(f => {
        if (extensions.length === 0) return true;
        return extensions.some(ext => f.endsWith(`.${ext}`));
      })
      .map(f => {
        const stat = fs.statSync(path.join(dir, f));
        if (!stat.isFile()) return null;
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null && f.size > 0);
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

const workspaceRepo = new WorkspaceRepository(getDb());
const presetRepo = new PresetRepository(getDb());
const workflowRepo = new WorkflowRepository(getDb());

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

app.get('/api/agent-presets', (_req, res) => {
  res.json(presetRepo.list());
});

app.post('/api/agent-presets', (req, res) => {
  try {
    const preset = presetRepo.create(req.body);
    res.json(preset);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create preset' });
  }
});

app.put('/api/agent-presets/:id', (req, res) => {
  presetRepo.update(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/agent-presets/:id', (req, res) => {
  presetRepo.remove(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/agent-presets/seed', (_req, res) => {
  const projectRoot = path.resolve(path.join(__dirname, '..', '..', '..'));
  const imported = seedPresetsFromFilesystem(projectRoot, presetRepo);
  res.json({ imported, total: presetRepo.list().length });
});

app.get('/api/workflows', (_req, res) => {
  res.json(workflowRepo.listRuns());
});

app.get('/api/workflows/:id', (req, res) => {
  const run = workflowRepo.getRun(req.params.id);
  if (!run) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ...run, events: workflowRepo.getEvents(req.params.id) });
});

const projectRoot = path.resolve(path.join(__dirname, '..', '..', '..'));

app.get('/api/workflow-files', (_req, res) => {
  const workflowsDir = path.join(projectRoot, 'workflows');
  try {
    const files = fs.readdirSync(workflowsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    res.json(files);
  } catch {
    res.json([]);
  }
});

app.get('/api/workflow-files/:name', (req, res) => {
  const filePath = path.join(projectRoot, 'workflows', req.params.name);
  if (!filePath.startsWith(path.join(projectRoot, 'workflows'))) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ name: req.params.name, content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

createWebSocketServer(server, registry, bootstrap, presetRepo, workflowRepo, projectRoot);

registry.onTerminalExit(() => {
  bootstrap.regenerateAgentsList(registry.listWithPurpose());
});

registry.onSpawn(() => {
  const caamDir = bootstrap.getCaamDir();
  if (caamDir) {
    const cwd = path.dirname(caamDir);
    watcher.start(cwd);
  }
});

// Auto-seed presets from filesystem on startup
const seeded = seedPresetsFromFilesystem(projectRoot, presetRepo);
if (seeded > 0) {
  console.log(`Seeded ${seeded} preset(s) from workflows/presets/`);
}

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
