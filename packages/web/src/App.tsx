import { useEffect, useRef } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { initTerminalStore, useTerminals } from './stores/terminal-store';
import { TerminalGrid } from './components/grid/TerminalGrid';
import { TerminalManager } from './components/sidebar/TerminalManager';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const terminals = useTerminals();

  useEffect(() => {
    const ws = new WebSocketClient(wsUrl);
    wsRef.current = ws;
    const unsub = initTerminalStore(ws);
    ws.connect();
    return () => {
      unsub();
      ws.disconnect();
    };
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#1e1e1e', color: '#fff' }}>
      <TerminalManager
        terminals={terminals}
        onSpawn={(name, cwd) => wsRef.current?.send({ type: 'terminal:spawn', name, cwd })}
        onKill={(id) => wsRef.current?.send({ type: 'terminal:kill', terminalId: id })}
      />
      <TerminalGrid
        terminals={terminals}
        ws={wsRef.current}
      />
    </div>
  );
}
