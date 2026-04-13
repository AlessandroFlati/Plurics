import { useState } from 'react';
import type { WorkflowEvent, EventCategory } from '../../types';

interface EventLineProps {
  event: WorkflowEvent;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getCategoryColor(cat: EventCategory): string {
  if (cat === 'workflow_started' || cat === 'workflow_completed' || cat === 'workflow_failed') {
    return '#569cd6';
  }
  if (cat === 'node_state_transition') return '#facc15';
  if (cat === 'signal_received' || cat === 'finding_produced') return '#4ade80';
  if (cat === 'tool_invoked') return '#fb923c';
  return '#888';
}

function getCategoryLabel(cat: EventCategory): string {
  const labels: Record<string, string> = {
    workflow_started: 'workflow',
    workflow_completed: 'workflow',
    workflow_failed: 'workflow',
    node_state_transition: 'node',
    signal_received: 'signal',
    finding_produced: 'finding',
    tool_invoked: 'tool',
  };
  return labels[cat] ?? cat;
}

export function EventLine({ event }: EventLineProps) {
  const [expanded, setExpanded] = useState(false);
  const color = getCategoryColor(event.category);
  const desc = expanded ? event.description : (event.description.length > 80 ? event.description.slice(0, 80) + '…' : event.description);

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        borderBottom: '1px solid var(--color-border, #333)',
        padding: '6px 12px',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-secondary, #888)', flexShrink: 0 }}>
          {formatTime(event.timestamp)}
        </span>
        <span style={{
          fontSize: 10,
          padding: '1px 7px',
          borderRadius: 8,
          background: color,
          color: '#000',
          fontWeight: 600,
          flexShrink: 0,
        }}>
          {getCategoryLabel(event.category)}
        </span>
        <span style={{ color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>
          {desc}
        </span>
        {event.nodeName && (
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)', flexShrink: 0 }}>
            {event.nodeName}
          </span>
        )}
        <span style={{ fontSize: 11, flexShrink: 0, color: 'var(--color-text-secondary, #888)' }}>
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
      </div>
      {expanded && (
        <pre style={{
          margin: '6px 0 0 0',
          fontSize: 11,
          fontFamily: 'monospace',
          background: 'var(--color-bg-elevated, #1e1e1e)',
          borderRadius: 4,
          padding: '6px 8px',
          overflowX: 'auto',
          color: 'var(--color-text-primary)',
        }}>
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
