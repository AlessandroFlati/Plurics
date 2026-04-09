/**
 * End-to-end test: starts the research-swarm workflow via WebSocket,
 * monitors node transitions, and logs everything.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URL = 'ws://localhost:11001/ws';
const WORKSPACE = path.resolve(__dirname);
const YAML_PATH = path.resolve(__dirname, '..', 'workflows', 'research-swarm', 'workflow.yaml');
const MANIFEST_PATH = path.resolve(__dirname, 'input-manifest.json');

const yamlContent = fs.readFileSync(YAML_PATH, 'utf-8');
const inputManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

const ws = new WebSocket(WS_URL);
const startTime = Date.now();
let runId = null;
const nodeHistory = new Map(); // nodeName -> [state transitions]

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(1) + 's';
}

function log(prefix, msg) {
  console.log(`[${elapsed()}] [${prefix}] ${msg}`);
}

ws.on('open', () => {
  log('WS', 'Connected. Sending workflow:start...');
  ws.send(JSON.stringify({
    type: 'workflow:start',
    yamlContent,
    workspacePath: WORKSPACE,
    inputManifest,
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  switch (msg.type) {
    case 'terminal:list':
      // Ignore initial terminal list
      break;

    case 'workflow:started':
      runId = msg.runId;
      log('WORKFLOW', `Started: ${runId} (${msg.nodeCount} nodes)`);
      for (const n of msg.nodes) {
        nodeHistory.set(n.name, [{ state: n.state, time: elapsed() }]);
        log('NODE', `  ${n.name}: ${n.state}`);
      }
      break;

    case 'workflow:node-update':
      log('NODE', `${msg.node}: ${msg.fromState} -> ${msg.toState} (${msg.event})${msg.terminalId ? ' [terminal:' + msg.terminalId.slice(0, 8) + ']' : ''}`);
      if (!nodeHistory.has(msg.node)) nodeHistory.set(msg.node, []);
      nodeHistory.get(msg.node).push({ state: msg.toState, event: msg.event, time: elapsed() });
      break;

    case 'workflow:completed':
      log('WORKFLOW', `COMPLETED: ${JSON.stringify(msg.summary)}`);
      printSummary();
      ws.close();
      break;

    case 'workflow:paused':
      log('WORKFLOW', 'PAUSED');
      break;

    case 'workflow:resumed':
      log('WORKFLOW', 'RESUMED');
      break;

    case 'workflow:finding':
      log('FINDING', `${msg.hypothesisId}: ${msg.content.split('\n').find(l => l.startsWith('## Verdict'))?.replace('## Verdict', '').trim() || '(parsing verdict...)'}`);
      log('FINDING', `  Content length: ${msg.content.length} chars`);
      break;

    case 'error':
      log('ERROR', msg.message);
      break;

    case 'terminal:created':
      log('TERMINAL', `Created: ${msg.name} [${msg.terminalId.slice(0, 8)}]`);
      break;

    case 'terminal:exited':
      log('TERMINAL', `Exited: ${msg.terminalId.slice(0, 8)} (code ${msg.exitCode})`);
      break;

    default:
      // Ignore terminal:output (too noisy) and terminal:list
      if (msg.type !== 'terminal:output') {
        log('MSG', `${msg.type}: ${JSON.stringify(msg).slice(0, 120)}`);
      }
  }
});

ws.on('error', (err) => {
  log('WS', `Error: ${err.message}`);
});

ws.on('close', () => {
  log('WS', 'Disconnected');
  printSummary();
  process.exit(0);
});

function printSummary() {
  console.log('\n=== NODE HISTORY ===');
  for (const [name, history] of nodeHistory) {
    const states = history.map(h => `${h.state}${h.event ? '(' + h.event + ')' : ''} @${h.time}`);
    console.log(`  ${name}: ${states.join(' -> ')}`);
  }

  // Check run directory
  if (runId) {
    const runDir = path.join(WORKSPACE, '.caam', 'runs', runId);
    console.log(`\n=== RUN DIRECTORY: ${runDir} ===`);
    try {
      for (const subdir of ['purposes', 'logs', 'signals']) {
        const dirPath = path.join(runDir, subdir);
        try {
          const files = fs.readdirSync(dirPath);
          console.log(`  ${subdir}/: ${files.length} files${files.length > 0 ? ' [' + files.slice(0, 5).join(', ') + (files.length > 5 ? '...' : '') + ']' : ''}`);
        } catch {
          console.log(`  ${subdir}/: (not found)`);
        }
      }

      // Check metadata
      const metaPath = path.join(runDir, 'run-metadata.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        console.log(`  run-metadata.json: status=${meta.status}, summary=${JSON.stringify(meta.summary)}`);
      } catch {
        console.log('  run-metadata.json: (not found)');
      }
    } catch {
      console.log('  (run directory not found)');
    }
  }
}

// Safety timeout: 4 hours
setTimeout(() => {
  log('TIMEOUT', 'Test timed out after 4 hours');
  printSummary();
  ws.close();
  process.exit(1);
}, 14400000);

// Print periodic status every 30 seconds
setInterval(() => {
  const running = [...nodeHistory.entries()]
    .filter(([, h]) => h[h.length - 1]?.state === 'running')
    .map(([name]) => name);
  if (running.length > 0) {
    log('STATUS', `Running: ${running.join(', ')}`);
  }
}, 30000);
