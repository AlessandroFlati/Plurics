import { useState } from 'react';
import type { TerminalInfo } from '../../types';
import type { WebSocketClient } from '../../services/websocket-client';
import './TerminalManager.css';
import { WorkspaceSelector } from './WorkspaceSelector';
import { WorkflowPanel } from '../workflow/WorkflowPanel';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  ws: WebSocketClient | null;
  onSpawn: (name: string, cwd: string) => void;
  onOpenSpawnModal: () => void;
  onKill: (id: string) => void;
  onPresetSelect: (label: string, cols: number, rows: number) => void;
}

export function TerminalManager({ terminals, ws, onSpawn, onOpenSpawnModal, onKill, onPresetSelect: _onPresetSelect }: TerminalManagerProps) {
  const [activeCwd, setActiveCwd] = useState<string | null>(null);

  return (
    <div className="terminal-manager">
      <div className="terminal-manager-app-header">CAAM</div>

      <div className="terminal-manager-section">
        <div className="terminal-manager-section-label">Workspace</div>
        <WorkspaceSelector
          onSelect={(ws) => { setActiveCwd(ws.path); onSpawn(ws.path, ws.path); }}
          onNewPath={(p) => { setActiveCwd(p); onSpawn(p, p); }}
          locked={!!activeCwd}
          onUnlock={() => setActiveCwd(null)}
        />
      </div>

      <div className="terminal-manager-divider" />

      <div className="terminal-manager-section">
        <div className="terminal-manager-section-label">Terminals</div>
      </div>
      <div className={'terminal-manager-spawn' + (activeCwd ? '' : ' terminal-manager-spawn--disabled')}>
        <button onClick={onOpenSpawnModal} className="terminal-manager-btn" disabled={!activeCwd} style={{ width: '100%' }}>
          Spawn Agent
        </button>
      </div>

      <ul className="terminal-manager-list">
        {terminals.map((t) => (
          <li key={t.id} className="terminal-manager-item">
            <div className={`terminal-manager-item-dot terminal-manager-item-dot--${t.status}`} />
            <span className="terminal-manager-item-name">{t.name}</span>
            <button
              className="terminal-manager-item-kill"
              onClick={() => onKill(t.id)}
              title="Kill terminal"
            >
              ✕
            </button>
          </li>
        ))}
        {terminals.length === 0 && (
          <li className="terminal-manager-empty">No terminals running</li>
        )}
      </ul>

      <div className="terminal-manager-divider" />

      <WorkflowPanel ws={ws} workspacePath={activeCwd} />
    </div>
  );
}
