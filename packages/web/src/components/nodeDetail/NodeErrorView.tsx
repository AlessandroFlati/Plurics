import { useState } from 'react';

interface NodeErrorViewProps {
  errorCategory: string;
  errorMessage: string;
  stackTrace?: string;
}

export function NodeErrorView({ errorCategory, errorMessage, stackTrace }: NodeErrorViewProps) {
  const [stackExpanded, setStackExpanded] = useState(false);

  return (
    <div style={{
      background: 'rgba(248, 113, 113, 0.08)',
      borderLeft: '3px solid #f87171',
      padding: '10px 12px',
      marginBottom: 12,
      borderRadius: 2,
    }}>
      <div style={{
        display: 'inline-block',
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 8,
        background: '#f87171',
        color: '#000',
        fontWeight: 600,
        marginBottom: 6,
      }}>
        {errorCategory}
      </div>
      <p style={{ margin: '0 0 8px 0', fontSize: 12, color: '#f87171' }}>{errorMessage}</p>
      {stackTrace && (
        <>
          <button
            onClick={() => setStackExpanded(e => !e)}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              background: 'transparent',
              border: '1px solid #f87171',
              borderRadius: 4,
              color: '#f87171',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
            }}
          >
            {stackExpanded ? 'Hide stack trace' : 'Show stack trace'}
          </button>
          {stackExpanded && (
            <pre style={{
              marginTop: 8,
              fontSize: 11,
              fontFamily: 'monospace',
              background: '#1a0000',
              borderRadius: 4,
              padding: '8px 10px',
              overflowX: 'auto',
              color: '#f87171',
            }}>
              {stackTrace}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
