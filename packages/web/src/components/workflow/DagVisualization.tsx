import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import './DagVisualization.css';

interface DagNode {
  name: string;
  state: string;
  scope: string | null;
}

interface DagVisualizationProps {
  nodes: DagNode[];
  yamlContent: string;
}

interface LayoutNode {
  name: string;
  state: string;
  scope: string | null;
  x: number;
  y: number;
  layer: number;
}

interface Edge {
  from: string;
  to: string;
}

const NODE_W = 110;
const NODE_H = 36;
const LAYER_GAP = 50;
const NODE_GAP = 12;
const PADDING = 30;
const NODE_RX = 6;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

const STATE_COLORS: Record<string, string> = {
  pending: '#525252',
  ready: '#007acc',
  spawning: '#007acc',
  running: '#facc15',
  validating: '#facc15',
  completed: '#4ade80',
  retrying: '#fb923c',
  failed: '#f87171',
  skipped: '#525252',
};

function parseEdgesFromYaml(yamlContent: string): Edge[] {
  const edges: Edge[] = [];
  const lines = yamlContent.split('\n');
  let currentNode: string | null = null;
  let inNodes = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'nodes:') {
      inNodes = true;
      continue;
    }

    if (!inNodes) continue;

    const nodeMatch = line.match(/^  ([a-z_]+):$/);
    if (nodeMatch) {
      currentNode = nodeMatch[1];
      continue;
    }

    if (!currentNode) continue;

    const depsMatch = trimmed.match(/^depends_on:\s*\[(.+)\]$/);
    if (depsMatch) {
      const deps = depsMatch[1].split(',').map(d => d.trim());
      for (const dep of deps) {
        edges.push({ from: dep, to: currentNode });
      }
    }

    const depsAllMatch = trimmed.match(/^depends_on_all:\s*\[(.+)\]$/);
    if (depsAllMatch) {
      const deps = depsAllMatch[1].split(',').map(d => d.trim());
      for (const dep of deps) {
        edges.push({ from: dep, to: currentNode });
      }
    }

    const nextMatch = trimmed.match(/^next:\s*(\w+)$/);
    if (nextMatch) {
      edges.push({ from: currentNode, to: nextMatch[1] });
    }
  }

  return edges;
}

function computeLayout(nodes: DagNode[], edges: Edge[]): { layout: LayoutNode[]; width: number; height: number } {
  const nodeNames = nodes.map(n => n.name);
  const nodeMap = new Map(nodes.map(n => [n.name, n]));

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const name of nodeNames) {
    inDegree.set(name, 0);
    adj.set(name, []);
  }
  for (const edge of edges) {
    if (adj.has(edge.from) && inDegree.has(edge.to)) {
      adj.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, inDegree.get(edge.to)! + 1);
    }
  }

  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) {
      queue.push(name);
      layers.set(name, 0);
    }
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    const nodeLayer = layers.get(node)!;
    for (const neighbor of adj.get(node) || []) {
      const newLayer = Math.max(layers.get(neighbor) ?? 0, nodeLayer + 1);
      layers.set(neighbor, newLayer);
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  for (const name of nodeNames) {
    if (!layers.has(name)) layers.set(name, 0);
  }

  const layerGroups = new Map<number, string[]>();
  for (const [name, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(name);
  }

  const maxLayer = Math.max(...layers.values(), 0);
  const maxNodesInLayer = Math.max(...[...layerGroups.values()].map(g => g.length), 1);

  // Horizontal layout: layers = columns (left to right), nodes in layer = rows (top to bottom)
  const totalWidth = (maxLayer + 1) * (NODE_W + LAYER_GAP) - LAYER_GAP + PADDING * 2;
  const totalHeight = maxNodesInLayer * (NODE_H + NODE_GAP) - NODE_GAP + PADDING * 2;

  const layout: LayoutNode[] = [];
  for (const [layer, names] of layerGroups) {
    const layerHeight = names.length * (NODE_H + NODE_GAP) - NODE_GAP;
    const offsetY = (totalHeight - layerHeight) / 2;

    for (let i = 0; i < names.length; i++) {
      const n = nodeMap.get(names[i]);
      layout.push({
        name: names[i],
        state: n?.state ?? 'pending',
        scope: n?.scope ?? null,
        x: PADDING + layer * (NODE_W + LAYER_GAP),
        y: offsetY + i * (NODE_H + NODE_GAP),
        layer,
      });
    }
  }

  return { layout, width: Math.max(totalWidth, 300), height: Math.max(totalHeight, 150) };
}

export function DagVisualization({ nodes, yamlContent }: DagVisualizationProps) {
  const edges = useMemo(() => parseEdgesFromYaml(yamlContent), [yamlContent]);
  const { layout, width: graphW, height: graphH } = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
  const layoutMap = new Map(layout.map(n => [n.name, n]));
  const activeStates = new Set(['running', 'spawning', 'validating']);

  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Center the graph on mount and when graph size changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scaleX = cw / graphW;
    const scaleY = ch / graphH;
    const fitZoom = Math.min(scaleX, scaleY, 1) * 0.9;
    setZoom(fitZoom);
    setPan({
      x: (cw - graphW * fitZoom) / 2,
      y: (ch - graphH * fitZoom) / 2,
    });
  }, [graphW, graphH]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));

    // Zoom towards cursor
    setPan(prev => ({
      x: mx - (mx - prev.x) * (newZoom / zoom),
      y: my - (my - prev.y) * (newZoom / zoom),
    }));
    setZoom(newZoom);
  }, [zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div
      className="dag-viz"
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <svg
        width="100%"
        height="100%"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <defs>
          <marker id="dag-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" className="dag-viz-arrowhead" />
          </marker>
          <marker id="dag-arrow-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" className="dag-viz-arrowhead dag-viz-arrowhead--active" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map((edge, i) => {
            const from = layoutMap.get(edge.from);
            const to = layoutMap.get(edge.to);
            if (!from || !to) return null;

            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;

            const isActive = activeStates.has(from.state) || activeStates.has(to.state);
            const midX = (x1 + x2) / 2;

            return (
              <path
                key={`edge-${i}`}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                className={`dag-viz-edge${isActive ? ' dag-viz-edge--active' : ''}`}
                markerEnd={`url(#dag-arrow${isActive ? '-active' : ''})`}
              />
            );
          })}

          {/* Nodes */}
          {layout.map(node => {
            const color = STATE_COLORS[node.state] ?? STATE_COLORS.pending;
            const isActive = activeStates.has(node.state);
            const displayName = node.name.length > 12 ? node.name.slice(0, 11) + '..' : node.name;

            return (
              <g key={node.name}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={NODE_RX}
                  fill={color + '20'}
                  stroke={color}
                  strokeWidth={isActive ? 2 : 1}
                />
                <text
                  className="dag-viz-node-label"
                  x={node.x + NODE_W / 2}
                  y={node.y + NODE_H / 2 + 4}
                >
                  {displayName}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
