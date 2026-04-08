// packages/web/src/components/grid/SplitLayout.tsx

import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TerminalPane } from '../terminal/TerminalPane';
import { EmptySlot } from './EmptySlot';
import type { LayoutNode } from './split-tree';
import type { TerminalInfo } from '../../types';
import type { WebSocketClient } from '../../services/websocket-client';
import './SplitLayout.css';

interface SplitLayoutProps {
  layout: LayoutNode;
  terminals: Map<string, TerminalInfo>;
  ws: WebSocketClient | null;
  onSpawnInSlot: (leafPath: string) => void;
  onSplitH: (terminalId: string) => void;
  onSplitV: (terminalId: string) => void;
  onMerge: (terminalId: string) => void;
}

export function SplitLayout({ layout, terminals, ws, onSpawnInSlot, onSplitH, onSplitV, onMerge }: SplitLayoutProps) {
  return (
    <div className="split-layout">
      <RenderNode node={layout} terminals={terminals} ws={ws} onSpawnInSlot={onSpawnInSlot} onSplitH={onSplitH} onSplitV={onSplitV} onMerge={onMerge} path="root" />
    </div>
  );
}

interface RenderNodeProps {
  node: LayoutNode;
  terminals: Map<string, TerminalInfo>;
  ws: WebSocketClient | null;
  onSpawnInSlot: (leafPath: string) => void;
  onSplitH: (terminalId: string) => void;
  onSplitV: (terminalId: string) => void;
  onMerge: (terminalId: string) => void;
  path: string;
}

function RenderNode({ node, terminals, ws, onSpawnInSlot, onSplitH, onSplitV, onMerge, path }: RenderNodeProps) {
  if (node.type === 'leaf') {
    if (node.terminalId && terminals.has(node.terminalId)) {
      const t = terminals.get(node.terminalId)!;
      return (
        <TerminalPane
          terminal={t}
          ws={ws}
          onSplitH={() => onSplitH(t.id)}
          onSplitV={() => onSplitV(t.id)}
          onMerge={() => onMerge(t.id)}
          canMerge={path !== 'root'}
        />
      );
    }
    return <EmptySlot onSpawn={() => onSpawnInSlot(path)} />;
  }

  const isVertical = node.direction === 'vertical';

  return (
    <Allotment vertical={isVertical} defaultSizes={[node.ratio * 100, (1 - node.ratio) * 100]}>
      <Allotment.Pane minSize={isVertical ? 100 : 200}>
        <RenderNode node={node.children[0]} terminals={terminals} ws={ws} onSpawnInSlot={onSpawnInSlot} onSplitH={onSplitH} onSplitV={onSplitV} onMerge={onMerge} path={`${path}.0`} />
      </Allotment.Pane>
      <Allotment.Pane minSize={isVertical ? 100 : 200}>
        <RenderNode node={node.children[1]} terminals={terminals} ws={ws} onSpawnInSlot={onSpawnInSlot} onSplitH={onSplitH} onSplitV={onSplitV} onMerge={onMerge} path={`${path}.1`} />
      </Allotment.Pane>
    </Allotment>
  );
}
