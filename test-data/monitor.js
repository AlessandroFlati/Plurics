const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:11001/ws');
const startTime = Date.now();
const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(1) + 's';
const log = (p, m) => console.log(`[${elapsed()}] [${p}] ${m}`);

ws.on('open', () => {
  log('WS', 'Connected. Requesting status...');
  ws.send(JSON.stringify({ type: 'workflow:status', runId: 'run-1775752081392-51f1021e' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.type) {
    case 'workflow:started':
      log('STATUS', `Run ${msg.runId}: ${msg.nodeCount} nodes`);
      const states = {};
      msg.nodes.forEach(n => { states[n.state] = (states[n.state] || 0) + 1; });
      log('STATUS', `States: ${JSON.stringify(states)}`);
      msg.nodes.filter(n => !['pending','completed'].includes(n.state)).forEach(n => log('NODE', `  ${n.name}: ${n.state}`));
      break;
    case 'workflow:node-update':
      log('NODE', `${msg.node}: ${msg.fromState} -> ${msg.toState} (${msg.event})`);
      break;
    case 'workflow:finding':
      log('FINDING', `${msg.hypothesisId}: ${msg.content.length} chars`);
      break;
    case 'workflow:completed':
      log('WORKFLOW', `COMPLETED: ${JSON.stringify(msg.summary)}`);
      ws.close();
      break;
    case 'error':
      log('ERROR', msg.message);
      break;
    default:
      if (!['terminal:output','terminal:list','terminal:created','terminal:exited'].includes(msg.type))
        log('MSG', msg.type);
  }
});

ws.on('error', (err) => log('WS', `Error: ${err.message}`));
ws.on('close', () => { log('WS', 'Disconnected'); process.exit(0); });
setInterval(() => {
  const fs = require('fs');
  try {
    const d = JSON.parse(fs.readFileSync('./test-data/.caam/runs/run-1775752081392-51f1021e/node-states.json','utf8'));
    const s = {};
    d.nodes.forEach(n => { s[n.state] = (s[n.state] || 0) + 1; });
    const running = d.nodes.filter(n => n.state === 'running').map(n => n.key);
    log('POLL', `${JSON.stringify(s)} running: [${running.join(', ')}]`);
  } catch {}
}, 60000);
setTimeout(() => { log('TIMEOUT', '4h'); ws.close(); process.exit(1); }, 14400000);
