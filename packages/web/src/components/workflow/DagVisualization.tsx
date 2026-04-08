import { useMemo } from 'react';
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

const NODE_W = 120;
const NODE_H = 50;
const LAYER_GAP = 80;
const NODE_GAP = 30;
const PADDING = 40;
const NODE_RX = 8;

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

    // Detect node name (indented exactly 2 spaces, ends with colon)
    const nodeMatch = line.match(/^  ([a-z_]+):$/);
    if (nodeMatch) {
      currentNode = nodeMatch[1];
      continue;
    }

    if (!currentNode) continue;

    // Parse depends_on
    const depsMatch = trimmed.match(/^depends_on:\s*\[(.+)\]$/);
    if (depsMatch) {
      const deps = depsMatch[1].split(',').map(d => d.trim());
      for (const dep of deps) {
        edges.push({ from: dep, to: currentNode });
      }
    }

    // Parse depends_on_all
    const depsAllMatch = trimmed.match(/^depends_on_all:\s*\[(.+)\]$/);
    if (depsAllMatch) {
      const deps = depsAllMatch[1].split(',').map(d => d.trim());
      for (const dep of deps) {
        edges.push({ from: dep, to: currentNode });
      }
    }

    // Parse next
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

  // Compute layers via topological sort (Kahn's algorithm)
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

  // Assign layers to nodes not reached by topo sort (cycles)
  for (const name of nodeNames) {
    if (!layers.has(name)) layers.set(name, 0);
  }

  // Group by layer
  const layerGroups = new Map<number, string[]>();
  for (const [name, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(name);
  }

  const maxLayer = Math.max(...layers.values(), 0);
  const maxNodesInLayer = Math.max(...[...layerGroups.values()].map(g => g.length), 1);

  const totalWidth = maxNodesInLayer * (NODE_W + NODE_GAP) - NODE_GAP + PADDING * 2;
  const totalHeight = (maxLayer + 1) * (NODE_H + LAYER_GAP) - LAYER_GAP + PADDING * 2;

  const layout: LayoutNode[] = [];
  for (const [layer, names] of layerGroups) {
    const layerWidth = names.length * (NODE_W + NODE_GAP) - NODE_GAP;
    const offsetX = (totalWidth - layerWidth) / 2;

    for (let i = 0; i < names.length; i++) {
      const n = nodeMap.get(names[i]);
      layout.push({
        name: names[i],
        state: n?.state ?? 'pending',
        scope: n?.scope ?? null,
        x: offsetX + i * (NODE_W + NODE_GAP),
        y: PADDING + layer * (NODE_H + LAYER_GAP),
        layer,
      });
    }
  }

  return { layout, width: Math.max(totalWidth, 300), height: Math.max(totalHeight, 200) };
}

export function DagVisualization({ nodes, yamlContent }: DagVisualizationProps) {
  const edges = useMemo(() => parseEdgesFromYaml(yamlContent), [yamlContent]);
  const { layout, width, height } = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);

  const layoutMap = new Map(layout.map(n => [n.name, n]));

  const activeStates = new Set(['running', 'spawning', 'validating']);

  return (
    <div className="dag-viz">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <marker id="dag-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" className="dag-viz-arrowhead" />
          </marker>
          <marker id="dag-arrow-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" className="dag-viz-arrowhead dag-viz-arrowhead--active" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = layoutMap.get(edge.from);
          const to = layoutMap.get(edge.to);
          if (!from || !to) return null;

          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;

          const isActive = activeStates.has(from.state) || activeStates.has(to.state);
          const midY = (y1 + y2) / 2;

          return (
            <path
              key={`edge-${i}`}
              d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
              className={`dag-viz-edge${isActive ? ' dag-viz-edge--active' : ''}`}
              markerEnd={`url(#dag-arrow${isActive ? '-active' : ''})`}
            />
          );
        })}

        {/* Nodes */}
        {layout.map(node => {
          const color = STATE_COLORS[node.state] ?? STATE_COLORS.pending;
          const isActive = activeStates.has(node.state);
          const displayName = node.name.length > 14 ? node.name.slice(0, 13) + '...' : node.name;

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
                y={node.y + 22}
              >
                {displayName}
              </text>
              <text
                className="dag-viz-node-state"
                x={node.x + NODE_W / 2}
                y={node.y + 38}
              >
                {node.state}{node.scope ? ` (${node.scope})` : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
