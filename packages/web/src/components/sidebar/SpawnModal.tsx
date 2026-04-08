import { useState, useEffect, useRef } from 'react';
import './SpawnModal.css';

interface AgentPreset {
  id: number;
  name: string;
  purpose: string;
  use_count: number;
}

interface SpawnModalProps {
  onSpawn: (name: string, purpose: string, presetId?: number) => void;
  onClose: () => void;
}

export function SpawnModal({ onSpawn, onClose }: SpawnModalProps) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/agent-presets')
      .then(r => r.json())
      .then(setPresets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  function handlePresetClick(preset: AgentPreset) {
    setName(preset.name);
    setPurpose(preset.purpose);
    setSelectedPresetId(preset.id);
  }

  function handleSpawn() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSpawn(trimmedName, purpose.trim(), selectedPresetId ?? undefined);
  }

  async function handleSavePreset() {
    const trimmedName = name.trim();
    const trimmedPurpose = purpose.trim();
    if (!trimmedName || !trimmedPurpose) return;

    const existing = presets.find(p => p.name === trimmedName);
    if (existing) {
      await fetch(`/api/agent-presets/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: trimmedPurpose }),
      });
    } else {
      await fetch('/api/agent-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, purpose: trimmedPurpose }),
      });
    }

    const updated = await fetch('/api/agent-presets').then(r => r.json());
    setPresets(updated);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSpawn();
    }
  }

  return (
    <div className="spawn-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spawn-modal" onKeyDown={handleKeyDown}>
        <div className="spawn-modal-header">Spawn Agent</div>
        <div className="spawn-modal-body">
          <div className="spawn-modal-presets">
            <div className="spawn-modal-presets-title">Presets</div>
            {presets.length === 0 && (
              <div className="spawn-modal-preset-empty">No presets saved yet</div>
            )}
            {presets.map(p => (
              <button
                key={p.id}
                className={'spawn-modal-preset-item' + (selectedPresetId === p.id ? ' spawn-modal-preset-item--selected' : '')}
                onClick={() => handlePresetClick(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="spawn-modal-form">
            <label className="spawn-modal-label">Agent Name</label>
            <input
              ref={nameRef}
              type="text"
              className="spawn-modal-input"
              value={name}
              onChange={e => { setName(e.target.value); setSelectedPresetId(null); }}
              placeholder="e.g. code-reviewer"
            />
            <label className="spawn-modal-label">Purpose (purpose.md)</label>
            <textarea
              className="spawn-modal-textarea"
              value={purpose}
              onChange={e => { setPurpose(e.target.value); setSelectedPresetId(null); }}
              placeholder="Describe this agent's role, responsibilities, and instructions..."
            />
          </div>
        </div>
        <div className="spawn-modal-footer">
          <button
            className="spawn-modal-btn spawn-modal-btn--save"
            onClick={handleSavePreset}
            disabled={!name.trim() || !purpose.trim()}
          >
            Save as Preset
          </button>
          <button className="spawn-modal-btn" onClick={onClose}>Cancel</button>
          <button
            className="spawn-modal-btn spawn-modal-btn--primary"
            onClick={handleSpawn}
            disabled={!name.trim()}
          >
            Spawn
          </button>
        </div>
      </div>
    </div>
  );
}
