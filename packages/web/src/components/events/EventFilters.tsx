import type { EventCategory } from '../../types';

interface EventFiltersProps {
  active: Set<EventCategory>;
  onChange: (s: Set<EventCategory>) => void;
}

const ALL_CATEGORIES: EventCategory[] = [
  'workflow_started',
  'workflow_completed',
  'workflow_failed',
  'node_state_transition',
  'signal_received',
  'tool_invoked',
  'finding_produced',
];

const CATEGORY_LABELS: Record<EventCategory, string> = {
  workflow_started: 'Started',
  workflow_completed: 'Completed',
  workflow_failed: 'Failed',
  node_state_transition: 'Node transitions',
  signal_received: 'Signals',
  tool_invoked: 'Tool calls',
  finding_produced: 'Findings',
};

function toTitleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getLabel(cat: EventCategory): string {
  return CATEGORY_LABELS[cat] ?? toTitleCase(cat);
}

export function EventFilters({ active, onChange }: EventFiltersProps) {
  const allActive = active.size === 0 || active.size === ALL_CATEGORIES.length;

  function handleAll() {
    onChange(new Set());
  }

  function handleToggle(cat: EventCategory) {
    const next = new Set(active);
    if (next.has(cat)) {
      next.delete(cat);
    } else {
      next.add(cat);
    }
    onChange(next);
  }

  const chipBase: React.CSSProperties = {
    fontSize: 11,
    padding: '3px 10px',
    borderRadius: 12,
    border: '1px solid var(--color-border, #555)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-ui)',
  };

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      padding: '6px 12px',
      borderBottom: '1px solid var(--color-border, #333)',
    }}>
      <button
        onClick={handleAll}
        style={{
          ...chipBase,
          background: allActive ? 'var(--color-accent, #569cd6)' : 'transparent',
          color: allActive ? '#fff' : 'var(--color-text-primary)',
        }}
      >
        All
      </button>
      {ALL_CATEGORIES.map(cat => {
        const isActive = active.has(cat);
        return (
          <button
            key={cat}
            onClick={() => handleToggle(cat)}
            style={{
              ...chipBase,
              background: isActive ? 'var(--color-accent, #569cd6)' : 'transparent',
              color: isActive ? '#fff' : 'var(--color-text-primary)',
            }}
          >
            {getLabel(cat)}
          </button>
        );
      })}
    </div>
  );
}
