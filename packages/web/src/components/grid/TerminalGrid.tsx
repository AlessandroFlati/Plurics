import { useState, useMemo } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import { TerminalPane } from '../terminal/TerminalPane';
import { LayoutPresets } from './LayoutPresets';
import type { TerminalInfo } from '../../types';
import type { WebSocketClient } from '../../services/websocket-client';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './TerminalGrid.css';

const ReactGridLayout = WidthProvider(RGL);

interface TerminalGridProps {
  terminals: TerminalInfo[];
  ws: WebSocketClient | null;
}

export function TerminalGrid({ terminals, ws }: TerminalGridProps) {
  const [gridCols, setGridCols] = useState(2);
  const [gridRows, setGridRows] = useState(2);
  const [customLayout, setCustomLayout] = useState<Layout[] | null>(null);

  const autoLayout: Layout[] = useMemo(() => {
    return terminals.map((t, i) => ({
      i: t.id,
      x: i % gridCols,
      y: Math.floor(i / gridCols),
      w: 1,
      h: 1,
    }));
  }, [terminals, gridCols]);

  const layout = customLayout ?? autoLayout;

  function handlePresetSelect(cols: number, _rows: number) {
    setGridCols(cols);
    setGridRows(_rows);
    setCustomLayout(null);
  }

  function handleLayoutChange(newLayout: Layout[]) {
    setCustomLayout(newLayout);
  }

  const rowHeight = Math.floor((window.innerHeight - 40) / gridRows) - 10;

  return (
    <div className="terminal-grid">
      <div className="terminal-grid-toolbar">
        <LayoutPresets selectedCols={gridCols} selectedRows={gridRows} onSelect={handlePresetSelect} />
      </div>
      <ReactGridLayout
        className="terminal-grid-layout"
        layout={layout}
        cols={gridCols}
        rowHeight={rowHeight}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".terminal-pane-header"
        compactType="vertical"
        margin={[4, 4]}
      >
        {terminals.map((t) => (
          <div key={t.id}>
            <TerminalPane terminal={t} ws={ws} />
          </div>
        ))}
      </ReactGridLayout>
    </div>
  );
}
