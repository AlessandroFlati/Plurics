export type SplitDirection = 'horizontal' | 'vertical';

export type LayoutNode =
  | { type: 'leaf'; terminalId: string | null }
  | { type: 'split'; direction: SplitDirection; ratio: number; children: [LayoutNode, LayoutNode] };

export function createPreset(cols: number, rows: number): LayoutNode {
  if (cols === 1 && rows === 1) {
    return { type: 'leaf', terminalId: null };
  }
  if (rows === 1) {
    return splitN(cols, 'horizontal');
  }
  if (cols === 1) {
    return splitN(rows, 'vertical');
  }
  const rowNodes: LayoutNode[] = [];
  for (let r = 0; r < rows; r++) {
    rowNodes.push(splitN(cols, 'horizontal'));
  }
  return buildBalancedTree(rowNodes, 'vertical');
}

function splitN(count: number, direction: SplitDirection): LayoutNode {
  if (count === 1) return { type: 'leaf', terminalId: null };
  const nodes: LayoutNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({ type: 'leaf', terminalId: null });
  }
  return buildBalancedTree(nodes, direction);
}

function buildBalancedTree(nodes: LayoutNode[], direction: SplitDirection): LayoutNode {
  if (nodes.length === 1) return nodes[0];
  if (nodes.length === 2) {
    return { type: 'split', direction, ratio: 0.5, children: [nodes[0], nodes[1]] };
  }
  const mid = Math.ceil(nodes.length / 2);
  const left = buildBalancedTree(nodes.slice(0, mid), direction);
  const right = buildBalancedTree(nodes.slice(mid), direction);
  return { type: 'split', direction, ratio: mid / nodes.length, children: [left, right] };
}

export function countLeaves(node: LayoutNode): number {
  if (node.type === 'leaf') return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

export function findLeaf(node: LayoutNode, terminalId: string): boolean {
  if (node.type === 'leaf') return node.terminalId === terminalId;
  return findLeaf(node.children[0], terminalId) || findLeaf(node.children[1], terminalId);
}

export function assignTerminals(node: LayoutNode, terminalIds: string[]): LayoutNode {
  let idx = 0;
  function assign(n: LayoutNode): LayoutNode {
    if (n.type === 'leaf') {
      const id = idx < terminalIds.length ? terminalIds[idx++] : null;
      return { type: 'leaf', terminalId: id };
    }
    return {
      type: 'split',
      direction: n.direction,
      ratio: n.ratio,
      children: [assign(n.children[0]), assign(n.children[1])],
    };
  }
  return assign(node);
}

export function splitLeaf(
  node: LayoutNode,
  terminalId: string,
  direction: SplitDirection,
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.terminalId === terminalId) {
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [
          { type: 'leaf', terminalId },
          { type: 'leaf', terminalId: null },
        ],
      };
    }
    return node;
  }
  return {
    type: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: [
      splitLeaf(node.children[0], terminalId, direction),
      splitLeaf(node.children[1], terminalId, direction),
    ],
  };
}

/** Remove the pane containing `removeTerminalId` and collapse the split. */
export function mergePane(node: LayoutNode, removeTerminalId: string): LayoutNode {
  if (node.type === 'leaf') return node;

  const leftHas = findLeaf(node.children[0], removeTerminalId);
  const rightHas = findLeaf(node.children[1], removeTerminalId);

  // The terminal to remove is a direct child of this split -- collapse to sibling
  if (leftHas && node.children[0].type === 'leaf' && node.children[0].terminalId === removeTerminalId) {
    return node.children[1];
  }
  if (rightHas && node.children[1].type === 'leaf' && node.children[1].terminalId === removeTerminalId) {
    return node.children[0];
  }

  // Recurse into the subtree that contains the terminal
  if (leftHas) {
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      children: [mergePane(node.children[0], removeTerminalId), node.children[1]],
    };
  }
  if (rightHas) {
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      children: [node.children[0], mergePane(node.children[1], removeTerminalId)],
    };
  }

  return node;
}
