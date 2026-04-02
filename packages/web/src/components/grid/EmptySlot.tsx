// packages/web/src/components/grid/EmptySlot.tsx

interface EmptySlotProps {
  onSpawn: () => void;
}

export function EmptySlot({ onSpawn }: EmptySlotProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: '#1a1a1a',
      border: '1px dashed #444',
      borderRadius: 4,
    }}>
      <button
        onClick={onSpawn}
        style={{
          padding: '8px 16px',
          background: '#0e639c',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Spawn here
      </button>
    </div>
  );
}
