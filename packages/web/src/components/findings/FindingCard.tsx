import { useState, useEffect } from 'react';
import type { FindingRecord } from '../../types';
import { getFindingContent } from '../../services/api';

interface FindingCardProps {
  finding: FindingRecord;
  runId: string;
  isNew?: boolean;
}

const VERDICT_COLORS: Record<string, string> = {
  confirmed: '#4ade80',
  falsified: '#f87171',
  inconclusive: '#888',
};

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr !== 1 ? 's' : ''} ago`;
  return `${Math.floor(hr / 24)} day${Math.floor(hr / 24) !== 1 ? 's' : ''} ago`;
}

export function FindingCard({ finding, runId, isNew }: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    if (isNew) {
      setHighlight(true);
      const t = setTimeout(() => setHighlight(false), 1500);
      return () => clearTimeout(t);
    }
  }, [isNew]);

  function handleToggle() {
    setExpanded(e => !e);
    if (!expanded && content === null && !contentLoading) {
      setContentLoading(true);
      getFindingContent(runId, finding.findingId)
        .then(c => setContent(c))
        .catch(() => setContent(null))
        .finally(() => setContentLoading(false));
    }
  }

  const verdictColor = VERDICT_COLORS[finding.verdict] ?? '#888';

  return (
    <div
      onClick={handleToggle}
      style={{
        background: highlight ? 'var(--color-bg-elevated-bright, #2a2a2a)' : 'var(--color-bg-elevated, #1e1e1e)',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'background 0.4s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 10,
          padding: '1px 7px',
          borderRadius: 8,
          background: verdictColor,
          color: finding.verdict === 'inconclusive' ? '#fff' : '#000',
          fontWeight: 600,
        }}>
          {toTitleCase(finding.verdict)}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {finding.summary}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)', flexShrink: 0 }}>
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)', display: 'flex', gap: 8 }}>
        {finding.nodeName && <span>{finding.nodeName}</span>}
        {finding.scope && <span>scope: {finding.scope}</span>}
        <span>{formatRelative(finding.producedAt)}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {contentLoading ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>Loading…</div>
          ) : content !== null ? (
            <pre style={{
              margin: 0,
              fontSize: 11,
              fontFamily: 'monospace',
              background: '#111',
              borderRadius: 4,
              padding: '6px 8px',
              overflowX: 'auto',
              color: 'var(--color-text-primary)',
            }}>
              {content}
            </pre>
          ) : (
            <div style={{ fontSize: 11, color: '#f87171' }}>Failed to load content.</div>
          )}
        </div>
      )}
    </div>
  );
}
