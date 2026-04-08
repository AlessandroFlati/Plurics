import { describe, it, expect } from 'vitest';
import {
  type LayoutNode,
  createPreset,
  countLeaves,
  findLeaf,
  splitLeaf,
  mergePane,
  assignTerminals,
} from '../split-tree';

describe('split-tree', () => {
  describe('createPreset', () => {
    it('creates a single leaf for 1x1', () => {
      const tree = createPreset(1, 1);
      expect(tree.type).toBe('leaf');
    });

    it('creates a horizontal split for 2x1', () => {
      const tree = createPreset(2, 1);
      expect(tree.type).toBe('split');
      if (tree.type === 'split') {
        expect(tree.direction).toBe('horizontal');
        expect(tree.children[0].type).toBe('leaf');
        expect(tree.children[1].type).toBe('leaf');
      }
    });

    it('creates a 2x2 grid with 4 leaves', () => {
      const tree = createPreset(2, 2);
      expect(countLeaves(tree)).toBe(4);
    });

    it('creates a 3x2 grid with 6 leaves', () => {
      const tree = createPreset(3, 2);
      expect(countLeaves(tree)).toBe(6);
    });

    it('creates a 3x3 grid with 9 leaves', () => {
      const tree = createPreset(3, 3);
      expect(countLeaves(tree)).toBe(9);
    });
  });

  describe('assignTerminals', () => {
    it('assigns terminal IDs to leaves in order', () => {
      const tree = createPreset(2, 2);
      const assigned = assignTerminals(tree, ['t1', 't2', 't3']);
      const leaves: string[] = [];
      function collect(node: LayoutNode) {
        if (node.type === 'leaf') { if (node.terminalId) leaves.push(node.terminalId); }
        else { node.children.forEach(collect); }
      }
      collect(assigned);
      expect(leaves).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('splitLeaf', () => {
    it('splits a leaf horizontally', () => {
      const tree: LayoutNode = { type: 'leaf', terminalId: 't1' };
      const result = splitLeaf(tree, 't1', 'horizontal');
      expect(result.type).toBe('split');
      if (result.type === 'split') {
        expect(result.direction).toBe('horizontal');
        expect(result.children[0]).toEqual({ type: 'leaf', terminalId: 't1' });
        expect(result.children[1]).toEqual({ type: 'leaf', terminalId: null });
      }
    });

    it('splits a leaf vertically', () => {
      const tree: LayoutNode = { type: 'leaf', terminalId: 't1' };
      const result = splitLeaf(tree, 't1', 'vertical');
      if (result.type === 'split') {
        expect(result.direction).toBe('vertical');
      }
    });

    it('splits a nested leaf', () => {
      const tree: LayoutNode = {
        type: 'split', direction: 'horizontal', ratio: 0.5,
        children: [
          { type: 'leaf', terminalId: 't1' },
          { type: 'leaf', terminalId: 't2' },
        ],
      };
      const result = splitLeaf(tree, 't2', 'vertical');
      expect(countLeaves(result)).toBe(3);
    });
  });

  describe('mergePane', () => {
    it('keeps the specified pane and removes sibling', () => {
      const tree: LayoutNode = {
        type: 'split', direction: 'horizontal', ratio: 0.5,
        children: [
          { type: 'leaf', terminalId: 't1' },
          { type: 'leaf', terminalId: 't2' },
        ],
      };
      const result = mergePane(tree, 't1');
      expect(result).toEqual({ type: 'leaf', terminalId: 't1' });
    });

    it('merges in a nested tree', () => {
      const tree: LayoutNode = {
        type: 'split', direction: 'vertical', ratio: 0.5,
        children: [
          { type: 'leaf', terminalId: 't1' },
          {
            type: 'split', direction: 'horizontal', ratio: 0.5,
            children: [
              { type: 'leaf', terminalId: 't2' },
              { type: 'leaf', terminalId: 't3' },
            ],
          },
        ],
      };
      const result = mergePane(tree, 't2');
      expect(countLeaves(result)).toBe(2);
    });
  });

  describe('findLeaf', () => {
    it('returns true for existing terminal', () => {
      const tree = createPreset(2, 2);
      const assigned = assignTerminals(tree, ['t1']);
      expect(findLeaf(assigned, 't1')).toBe(true);
    });

    it('returns false for missing terminal', () => {
      const tree = createPreset(1, 1);
      expect(findLeaf(tree, 'nonexistent')).toBe(false);
    });
  });
});
