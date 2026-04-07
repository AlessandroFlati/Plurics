import { useState } from 'react';
import type { TerminalInfo } from '../../types';
import './TerminalManager.css';
import { WorkspaceSelector } from './WorkspaceSelector';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string, cwd: string) => void;
  onKill: (id: string) => void;
  onPresetSelect: (label: string, cols: number, rows: number) => void;
}

export function TerminalManager({ terminals, onSpawn, onKill, onPresetSelect: _onPresetSelect }: TerminalManagerProps) {
  const [newName, setNewName] = useState('');
  const [activeCwd, setActiveCwd] = useState<string | null>(null);

  function handleSpawn() {
    if (!activeCwd) return;
    const name = newName.trim() || `agent-${terminals.length + 1}`;
    onSpawn(name, activeCwd);
    setNewName('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSpawn();
  }

  return (
    <div className="terminal-manager">
      <div className="terminal-manager-app-header">CAAM</div>

      <div className="terminal-manager-section">
        <div className="terminal-manager-section-label">Workspace</div>
        <WorkspaceSelector
          onSelect={(ws) => { setActiveCwd(ws.path); }}
          onNewPath={(p) => { setActiveCwd(p); }}
          locked={!!activeCwd}
          onUnlock={() => setActiveCwd(null)}
        />
      </div>

      <div className="terminal-manager-divider" />

      <div className="terminal-manager-section">
        <div className="terminal-manager-section-label">Terminals</div>
      </div>
      <div className={'terminal-manager-spawn' + (activeCwd ? '' : ' terminal-manager-spawn--disabled')}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Terminal name..."
          className="terminal-manager-input"
          disabled={!activeCwd}
        />
        <button onClick={handleSpawn} className="terminal-manager-btn" disabled={!activeCwd}>
          Spawn
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
    </div>
  );
}
