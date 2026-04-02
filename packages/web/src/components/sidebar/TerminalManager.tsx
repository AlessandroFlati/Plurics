import { useState, useRef, useEffect, useCallback } from 'react';
import type { TerminalInfo } from '../../types';
import './TerminalManager.css';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string, cwd: string) => void;
  onKill: (id: string) => void;
}

export function TerminalManager({ terminals, onSpawn, onKill }: TerminalManagerProps) {
  const [newName, setNewName] = useState('');
  const [cwdInput, setCwdInput] = useState('');
  const [cwdLocked, setCwdLocked] = useState(false);
  const [cwdError, setCwdError] = useState('');
  const [validating, setValidating] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cwdWrapperRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/list-dirs?prefix=${encodeURIComponent(value)}`);
        const dirs: string[] = await res.json();
        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
        setSelectedIdx(-1);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 150);
  }, []);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (cwdWrapperRef.current && !cwdWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleCwdChange(value: string) {
    setCwdInput(value);
    setCwdError('');
    fetchSuggestions(value);
  }

  function selectSuggestion(dir: string) {
    // Append / so user can keep drilling down
    const withSlash = dir.endsWith('/') ? dir : dir + '/';
    setCwdInput(withSlash);
    setShowSuggestions(false);
    setSelectedIdx(-1);
    fetchSuggestions(withSlash);
  }

  async function handleSetCwd() {
    const pathValue = cwdInput.trim();
    if (!pathValue) {
      setCwdError('Enter a path');
      return;
    }
    setValidating(true);
    setCwdError('');
    setShowSuggestions(false);
    try {
      const res = await fetch('/api/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathValue }),
      });
      const data = await res.json();
      if (data.valid) {
        setCwdLocked(true);
        setCwdError('');
      } else {
        setCwdError(data.error || 'Invalid path');
      }
    } catch {
      setCwdError('Failed to validate path');
    } finally {
      setValidating(false);
    }
  }

  function handleChangeCwd() {
    setCwdLocked(false);
    setCwdError('');
  }

  function handleSpawn() {
    if (!cwdLocked) return;
    const name = newName.trim() || `agent-${terminals.length + 1}`;
    onSpawn(name, cwdInput.trim());
    setNewName('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSpawn();
    }
  }

  function handleCwdKeyDown(e: React.KeyboardEvent) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(prev => Math.max(prev - 1, -1));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && selectedIdx >= 0)) {
        e.preventDefault();
        const idx = selectedIdx >= 0 ? selectedIdx : 0;
        selectSuggestion(suggestions[idx]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === 'Enter') {
      handleSetCwd();
    }
  }

  return (
    <div className="terminal-manager">
      <h2 className="terminal-manager-title">Terminals</h2>

      <div className="terminal-manager-cwd" ref={cwdWrapperRef}>
        <label className="terminal-manager-label">Working directory</label>
        <div className="terminal-manager-cwd-row">
          <div className="terminal-manager-autocomplete">
            <input
              type="text"
              value={cwdInput}
              onChange={(e) => handleCwdChange(e.target.value)}
              onKeyDown={handleCwdKeyDown}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              placeholder="/path/to/project"
              className={'terminal-manager-input' + (cwdError ? ' terminal-manager-input--error' : '')}
              disabled={cwdLocked || validating}
            />
            {showSuggestions && (
              <ul className="terminal-manager-suggestions">
                {suggestions.map((dir, i) => (
                  <li
                    key={dir}
                    className={'terminal-manager-suggestion' + (i === selectedIdx ? ' terminal-manager-suggestion--selected' : '')}
                    onMouseDown={() => selectSuggestion(dir)}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    {dir.split('/').filter(Boolean).pop() ?? dir}/
                  </li>
                ))}
              </ul>
            )}
          </div>
          {cwdLocked ? (
            <button onClick={handleChangeCwd} className="terminal-manager-btn terminal-manager-btn--secondary">
              Change
            </button>
          ) : (
            <button onClick={handleSetCwd} className="terminal-manager-btn" disabled={validating}>
              {validating ? '...' : 'Set'}
            </button>
          )}
        </div>
        {cwdError && <div className="terminal-manager-error">{cwdError}</div>}
        {cwdLocked && <div className="terminal-manager-success">Path set</div>}
      </div>

      <div className={'terminal-manager-spawn' + (cwdLocked ? '' : ' terminal-manager-spawn--disabled')}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Terminal name..."
          className="terminal-manager-input"
          disabled={!cwdLocked}
        />
        <button onClick={handleSpawn} className="terminal-manager-btn" disabled={!cwdLocked}>
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
