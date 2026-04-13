import { useState, useEffect } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import { RunFindingsPanel } from '../findings/RunFindingsPanel';
import { EventsStream } from '../events/EventsStream';
import { NodeDetailTab } from '../nodeDetail/NodeDetailTab';
import { RegistryUsageTab } from '../registryUsage/RegistryUsageTab';

interface RightPanelTabsProps {
  runId: string;
  selectedNode: string | null;
  wsClient: WebSocketClient | null;
  onNavigateToTool: (toolName: string) => void;
}

type Tab = 'findings' | 'events' | 'node' | 'registry';

const TABS: { id: Tab; label: string }[] = [
  { id: 'findings', label: 'Findings' },
  { id: 'events', label: 'Events' },
  { id: 'node', label: 'Node' },
  { id: 'registry', label: 'Registry' },
];

export function RightPanelTabs({ runId, selectedNode, wsClient, onNavigateToTool }: RightPanelTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('findings');

  useEffect(() => {
    if (selectedNode !== null) {
      setActiveTab('node');
    }
  }, [selectedNode]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border, #333)',
        flexShrink: 0,
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-accent, #569cd6)' : '2px solid transparent',
                color: isActive ? 'var(--color-accent, #569cd6)' : 'var(--color-text-secondary, #888)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {activeTab === 'findings' && (
          <RunFindingsPanel runId={runId} wsClient={wsClient} />
        )}
        {activeTab === 'events' && (
          <EventsStream runId={runId} wsClient={wsClient} />
        )}
        {activeTab === 'node' && (
          <NodeDetailTab runId={runId} selectedNode={selectedNode} />
        )}
        {activeTab === 'registry' && (
          <RegistryUsageTab runId={runId} wsClient={wsClient} onNavigateToTool={onNavigateToTool} />
        )}
      </div>
    </div>
  );
}
