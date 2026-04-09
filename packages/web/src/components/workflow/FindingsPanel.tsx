import { useState } from 'react';
import type { Finding } from './WorkflowPanel';
import './FindingsPanel.css';

interface FindingsPanelProps {
  findings: Finding[];
}

function extractVerdict(content: string): string {
  const match = content.match(/## Verdict\s*\n+\s*\**(CONFIRMED|CONFIRMED WITH RESERVATIONS|NOT CONFIRMED|FALSIFIED)\**/i);
  return match ? match[1] : 'PENDING';
}

function extractTitle(content: string): string {
  const match = content.match(/^# Finding:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function verdictColor(verdict: string): string {
  switch (verdict.toUpperCase()) {
    case 'CONFIRMED': return 'var(--color-success, #4caf50)';
    case 'CONFIRMED WITH RESERVATIONS': return 'var(--color-warning, #ff9800)';
    case 'NOT CONFIRMED': return 'var(--color-text-secondary, #888)';
    case 'FALSIFIED': return 'var(--color-error, #f44336)';
    default: return 'var(--color-text-secondary, #888)';
  }
}

export function FindingsPanel({ findings }: FindingsPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (findings.length === 0) {
    return (
      <div className="findings-panel">
        <div className="findings-panel-title">Findings</div>
        <div className="findings-panel-empty">No findings yet. Findings appear as hypotheses complete the pipeline.</div>
      </div>
    );
  }

  return (
    <div className="findings-panel">
      <div className="findings-panel-title">Findings ({findings.length})</div>
      <div className="findings-panel-list">
        {findings.map(f => {
          const verdict = extractVerdict(f.content);
          const title = extractTitle(f.content);
          const isExpanded = expanded === f.hypothesisId;

          return (
            <div key={f.hypothesisId} className="findings-panel-item">
              <button
                className="findings-panel-item-header"
                onClick={() => setExpanded(isExpanded ? null : f.hypothesisId)}
              >
                <span className="findings-panel-item-id">{f.hypothesisId}</span>
                {title && <span className="findings-panel-item-title">{title}</span>}
                <span
                  className="findings-panel-item-verdict"
                  style={{ color: verdictColor(verdict) }}
                >
                  {verdict}
                </span>
                <span className="findings-panel-item-chevron">{isExpanded ? '\u25B4' : '\u25BE'}</span>
              </button>
              {isExpanded && (
                <div className="findings-panel-item-content">
                  <pre>{f.content}</pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
