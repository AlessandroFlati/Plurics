import { useState } from 'react';
import type { TerminalInfo } from '../../types';
import './TerminalManager.css';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string) => void;
  onKill: (id: string) => void;
}

export function TerminalManager({ terminals, onSpawn, onKill }: TerminalManagerProps) {
  const [newName, setNewName] = useState('');

  function handleSpawn() {
    const name = newName.trim() || `agent-${terminals.length + 1}`;
    onSpawn(name);
    setNewName('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSpawn();
    }
  }

  return (
    <div className="terminal-manager">
      <h2 className="terminal-manager-title">Terminals</h2>
      <div className="terminal-manager-spawn">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Terminal name..."
          className="terminal-manager-input"
        />
        <button onClick={handleSpawn} className="terminal-manager-btn">
          Spawn
        </button>
      </div>
      <ul className="terminal-manager-list">
        {terminals.map((t) => (
          <li key={t.id} className="terminal-manager-item">
            <span className="terminal-manager-item-name">{t.name}</span>
            <span className={`terminal-manager-item-status terminal-manager-item-status--${t.status}`}>
              {t.status}
            </span>
            <button
              className="terminal-manager-item-kill"
              onClick={() => onKill(t.id)}
              title="Kill terminal"
            >
              x
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
