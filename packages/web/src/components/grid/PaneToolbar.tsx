import './PaneToolbar.css';

interface PaneToolbarProps {
  terminalId: string;
  onSplitH: () => void;
  onSplitV: () => void;
  onMerge: () => void;
  canMerge: boolean;
}

function SplitHIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="12" height="12" rx="1" />
      <line x1="1" y1="7" x2="13" y2="7" />
    </svg>
  );
}

function SplitVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="12" height="12" rx="1" />
      <line x1="7" y1="1" x2="7" y2="13" />
    </svg>
  );
}

export function PaneToolbar({ terminalId: _terminalId, onSplitH, onSplitV, onMerge }: PaneToolbarProps) {
  return (
    <div className="pane-toolbar">
      <button className="pane-toolbar-btn" onClick={onSplitV} title="Split horizontally">
        <SplitHIcon />
      </button>
      <button className="pane-toolbar-btn" onClick={onSplitH} title="Split vertically">
        <SplitVIcon />
      </button>
      <button className="pane-toolbar-btn pane-toolbar-btn--merge" onClick={onMerge} title="Close pane">
        ✕
      </button>
    </div>
  );
}
