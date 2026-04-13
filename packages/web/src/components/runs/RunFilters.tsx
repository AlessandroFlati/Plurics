import type { RunFilters } from '../../types';
import type { RunStatus } from '../../types';

interface RunFiltersProps {
  value: RunFilters;
  onChange: (f: RunFilters) => void;
}

interface ChipDef {
  label: string;
  status?: RunStatus;
  activeBackground: string;
  activeColor: string;
}

const CHIPS: ChipDef[] = [
  { label: 'All', activeBackground: 'var(--color-accent, #569cd6)', activeColor: '#fff' },
  { label: 'Running', status: 'running', activeBackground: '#facc15', activeColor: '#000' },
  { label: 'Completed', status: 'completed', activeBackground: '#4ade80', activeColor: '#000' },
  { label: 'Failed', status: 'failed', activeBackground: '#f87171', activeColor: '#000' },
  { label: 'Paused', status: 'paused', activeBackground: '#fb923c', activeColor: '#000' },
  { label: 'Interrupted', status: 'interrupted', activeBackground: '#f59e0b', activeColor: '#000' },
];

export function RunFilters({ value, onChange }: RunFiltersProps) {
  function handleChip(chip: ChipDef) {
    onChange({ ...value, status: chip.status });
  }

  return (
    <div style={{
      padding: '8px 12px',
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      borderBottom: '1px solid var(--color-border, #333)',
      flexWrap: 'wrap',
    }}>
      {CHIPS.map(chip => {
        const isActive = chip.status === undefined
          ? value.status === undefined
          : value.status === chip.status;
        return (
          <button
            key={chip.label}
            onClick={() => handleChip(chip)}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-ui)',
              cursor: 'pointer',
              borderRadius: 12,
              border: isActive ? 'none' : '1px solid var(--color-border, #555)',
              background: isActive ? chip.activeBackground : 'transparent',
              color: isActive ? chip.activeColor : 'var(--color-text-secondary, #aaa)',
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {chip.label}
          </button>
        );
      })}
      <input
        type="text"
        value={value.workflowName ?? ''}
        onChange={e => onChange({ ...value, workflowName: e.target.value || undefined })}
        placeholder="Filter by workflow name..."
        style={{
          flex: 1,
          minWidth: 120,
          fontSize: 11,
          fontFamily: 'var(--font-ui)',
          background: 'transparent',
          border: '1px solid var(--color-border, #555)',
          borderRadius: 4,
          color: 'var(--color-text-primary)',
          padding: '3px 8px',
          outline: 'none',
        }}
      />
    </div>
  );
}
