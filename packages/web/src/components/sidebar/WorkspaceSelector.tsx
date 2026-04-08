import { useState, useEffect, useRef, useCallback } from 'react';
import './WorkspaceSelector.css';

interface WorkspaceInfo {
  id: number;
  path: string;
  label: string | null;
  use_count: number;
  agents: Array<{ name: string; purpose: string | null }>;
}

interface WorkspaceSelectorProps {
  onSelect: (workspace: WorkspaceInfo) => void;
  onNewPath: (path: string) => void;
  locked: boolean;
  onUnlock: () => void;
}

export function WorkspaceSelector({ onSelect, onNewPath: _onNewPath, locked, onUnlock }: WorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [input, setInput] = useState('C:\\Users\\aless\\PycharmProjects\\');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/workspaces').then(r => r.json()).then(setWorkspaces).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchDirSuggestions = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/list-dirs?prefix=${encodeURIComponent(value)}`);
        const dirs: string[] = await res.json();
        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
        setSelectedIdx(-1);
      } catch { setSuggestions([]); setShowSuggestions(false); }
    }, 150);
  }, []);

  function handleInputChange(value: string) {
    setInput(value);
    setError('');
    fetchDirSuggestions(value);
  }

  function selectDir(dir: string) {
    const sep = dir.includes('\\') ? '\\' : '/';
    const withSlash = dir.endsWith('/') || dir.endsWith('\\') ? dir : dir + sep;
    setInput(withSlash);
    setShowSuggestions(false);
    setSelectedIdx(-1);
    fetchDirSuggestions(withSlash);
  }

  async function handleSet() {
    const pathValue = input.trim().replace(/[/\\]+$/, '');
    if (!pathValue) { setError('Enter a path'); return; }
    setValidating(true);
    setError('');
    setShowSuggestions(false);
    try {
      const res = await fetch('/api/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathValue }),
      });
      const data = await res.json();
      if (!data.valid) { setError(data.error || 'Invalid path'); return; }

      const existing = workspaces.find(w => w.path === pathValue);
      if (existing) {
        await fetch(`/api/workspaces/${existing.id}/select`, { method: 'POST' });
        onSelect(existing);
      } else {
        const createRes = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: pathValue }),
        });
        const newWs = await createRes.json();
        setWorkspaces(prev => [newWs, ...prev]);
        onSelect(newWs);
      }
    } catch {
      setError('Failed to validate path');
    } finally {
      setValidating(false);
    }
  }

  function handleSelectExisting(ws: WorkspaceInfo) {
    setInput(ws.path);
    fetch(`/api/workspaces/${ws.id}/select`, { method: 'POST' });
    onSelect(ws);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(prev => Math.max(prev - 1, -1)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && selectedIdx >= 0)) {
        e.preventDefault();
        selectDir(suggestions[selectedIdx >= 0 ? selectedIdx : 0]);
        return;
      }
      if (e.key === 'Escape') { setShowSuggestions(false); return; }
    }
    if (e.key === 'Enter') handleSet();
  }

  return (
    <div className="workspace-selector" ref={wrapperRef}>
      <label className="workspace-selector-label">Workspace</label>

      {workspaces.length > 0 && !locked && (
        <div className="workspace-selector-recent">
          {workspaces.slice(0, 5).map(ws => (
            <button
              key={ws.id}
              className="workspace-selector-recent-item"
              onClick={() => handleSelectExisting(ws)}
              title={ws.path}
            >
              {ws.label || ws.path.split(/[/\\]/).filter(Boolean).pop() || ws.path}
            </button>
          ))}
        </div>
      )}

      <div className="workspace-selector-row">
        <div className="workspace-selector-autocomplete">
          <input
            type="text"
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="C:\path\to\project"
            className={'workspace-selector-input' + (error ? ' workspace-selector-input--error' : '')}
            disabled={locked || validating}
          />
          {showSuggestions && (
            <ul className="workspace-selector-suggestions">
              {suggestions.map((dir, i) => (
                <li
                  key={dir}
                  className={'workspace-selector-suggestion' + (i === selectedIdx ? ' workspace-selector-suggestion--selected' : '')}
                  onMouseDown={() => selectDir(dir)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  {dir.split(/[/\\]/).filter(Boolean).pop() ?? dir}{dir.includes('\\') ? '\\' : '/'}
                </li>
              ))}
            </ul>
          )}
        </div>
        {locked ? (
          <button onClick={onUnlock} className="workspace-selector-btn workspace-selector-btn--secondary">Change</button>
        ) : (
          <button onClick={handleSet} className="workspace-selector-btn" disabled={validating}>
            {validating ? '...' : 'Set'}
          </button>
        )}
      </div>
      {error && <div className="workspace-selector-error">{error}</div>}
      {locked && <div className="workspace-selector-success">Workspace active</div>}
    </div>
  );
}
