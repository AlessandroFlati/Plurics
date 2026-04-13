import { useState, useEffect, useCallback } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { WorkflowEvent, EventCategory, ServerMessage } from '../../types';
import { getRunEvents } from '../../services/api';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { EventFilters } from './EventFilters';
import { EventLine } from './EventLine';

interface EventsStreamProps {
  runId: string;
  wsClient: WebSocketClient | null;
}

const ALL_CATEGORIES = new Set<EventCategory>();

function wsMessageToEvent(msg: ServerMessage & { runId: string }, counter: number): WorkflowEvent | null {
  const base = {
    eventId: Date.now() + counter,
    runId: msg.runId,
    timestamp: new Date().toISOString(),
    payload: msg as unknown as Record<string, unknown>,
    scope: null,
  };
  if (msg.type === 'node:state_changed') {
    return { ...base, category: 'node_state_transition', description: `Node ${msg.nodeName} -> ${msg.state}`, nodeName: msg.nodeName };
  }
  if (msg.type === 'signal:received') {
    return { ...base, category: 'signal_received', description: msg.summary, nodeName: msg.nodeName };
  }
  if (msg.type === 'tool:invoked') {
    return { ...base, category: 'tool_invoked', description: `${msg.toolName} v${msg.toolVersion} invoked by ${msg.nodeName}`, nodeName: msg.nodeName };
  }
  if (msg.type === 'finding:produced') {
    return { ...base, category: 'finding_produced', description: `Finding produced (id: ${msg.findingId})`, nodeName: null };
  }
  if (msg.type === 'workflow:state_changed') {
    const cat: EventCategory = msg.status === 'completed' ? 'workflow_completed' : msg.status === 'failed' ? 'workflow_failed' : 'workflow_started';
    return { ...base, category: cat, description: `Workflow status changed to ${msg.status}`, nodeName: null };
  }
  return null;
}

let _counter = 0;

export function EventsStream({ runId, wsClient }: EventsStreamProps) {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [activeCategories, setActiveCategories] = useState<Set<EventCategory>>(ALL_CATEGORIES);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getRunEvents(runId)
      .then(data => setEvents(data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [runId]);

  const handler = useCallback((msg: ServerMessage) => {
    if (!('runId' in msg) || (msg as { runId?: string }).runId !== runId) return;
    const typed = msg as ServerMessage & { runId: string };
    if (
      msg.type === 'node:state_changed' ||
      msg.type === 'signal:received' ||
      msg.type === 'tool:invoked' ||
      msg.type === 'finding:produced' ||
      msg.type === 'workflow:state_changed'
    ) {
      const ev = wsMessageToEvent(typed, ++_counter);
      if (ev) setEvents(prev => [ev, ...prev]);
    }
  }, [runId]);

  useWorkflowEvents(wsClient, runId, handler);

  const filtered = activeCategories.size === 0
    ? events
    : events.filter(e => activeCategories.has(e.category));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <EventFilters active={activeCategories} onChange={setActiveCategories} />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: 16, color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>Loading events…</div>
        )}
        {!loading && filtered.map((ev, i) => (
          <EventLine key={String(ev.eventId) + i} event={ev} />
        ))}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 16, color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>No events.</div>
        )}
      </div>
    </div>
  );
}
