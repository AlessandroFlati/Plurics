import { useSyncExternalStore } from 'react';
import type { TerminalInfo, ServerMessage } from '../types';
import type { WebSocketClient } from '../services/websocket-client';

interface TerminalState {
  terminals: Map<string, TerminalInfo>;
  outputListeners: Map<string, Set<(data: string) => void>>;
}

const state: TerminalState = {
  terminals: new Map(),
  outputListeners: new Map(),
};

let listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function initTerminalStore(ws: WebSocketClient): () => void {
  return ws.onMessage((msg: ServerMessage) => {
    switch (msg.type) {
      case 'terminal:created': {
        state.terminals.set(msg.terminalId, {
          id: msg.terminalId,
          name: msg.name,
          tmuxSession: '',
          status: 'running',
          createdAt: Date.now(),
          cols: 120,
          rows: 30,
        });
        emitChange();
        break;
      }
      case 'terminal:exited': {
        state.terminals.delete(msg.terminalId);
        state.outputListeners.delete(msg.terminalId);
        emitChange();
        break;
      }
      case 'terminal:list': {
        state.terminals.clear();
        for (const t of msg.terminals) {
          state.terminals.set(t.id, t);
        }
        emitChange();
        break;
      }
      case 'terminal:output': {
        const cbs = state.outputListeners.get(msg.terminalId);
        if (cbs) {
          for (const cb of cbs) {
            cb(msg.data);
          }
        }
        break;
      }
    }
  });
}

function getSnapshot(): TerminalInfo[] {
  return Array.from(state.terminals.values());
}

let cachedSnapshot = getSnapshot();
function getStableSnapshot(): TerminalInfo[] {
  const next = getSnapshot();
  if (next.length !== cachedSnapshot.length || next.some((t, i) => t !== cachedSnapshot[i])) {
    cachedSnapshot = next;
  }
  return cachedSnapshot;
}

export function useTerminals(): TerminalInfo[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getStableSnapshot,
  );
}

export function subscribeToOutput(terminalId: string, callback: (data: string) => void): () => void {
  if (!state.outputListeners.has(terminalId)) {
    state.outputListeners.set(terminalId, new Set());
  }
  state.outputListeners.get(terminalId)!.add(callback);
  return () => {
    state.outputListeners.get(terminalId)?.delete(callback);
  };
}
