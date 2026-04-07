import './EmptySlot.css';

interface EmptySlotProps {
  onSpawn: () => void;
}

export function EmptySlot({ onSpawn }: EmptySlotProps) {
  return (
    <div className="empty-slot" onClick={onSpawn} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSpawn(); }}>
      <span className="empty-slot-icon">+</span>
      <span className="empty-slot-label">Spawn terminal</span>
    </div>
  );
}
