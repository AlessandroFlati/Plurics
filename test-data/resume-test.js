const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:11001/ws');
const startTime = Date.now();
const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(1) + 's';
const log = (p, m) => console.log(`[${elapsed()}] [${p}] ${m}`);

ws.on('open', () => {
  log('WS', 'Connected. Sending workflow:resume-run...');
  ws.send(JSON.stringify({ type: 'workflow:resume-run', runId: 'run-1775741240187-bf59e32d' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.type) {
    case 'workflow:started':
      log('WORKFLOW', `Resumed: ${msg.runId} (${msg.nodeCount} nodes)`);
      const states = {};
      msg.nodes.forEach(n => { states[n.state] = (states[n.state] || 0) + 1; });
      log('WORKFLOW', `States: ${JSON.stringify(states)}`);
      msg.nodes.filter(n => n.state !== 'pending').forEach(n => log('NODE', `  ${n.name}: ${n.state}`));
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
      ws.close();
      break;
    default:
      if (!['terminal:output', 'terminal:list', 'terminal:created', 'terminal:exited'].includes(msg.type))
        log('MSG', `${msg.type}`);
  }
});

ws.on('error', (err) => log('WS', `Error: ${err.message}`));
ws.on('close', () => { log('WS', 'Disconnected'); process.exit(0); });

// Status every 30s
setInterval(() => log('STATUS', 'alive'), 30000);

// 2h timeout
setTimeout(() => { log('TIMEOUT', '2h'); ws.close(); process.exit(1); }, 7200000);
