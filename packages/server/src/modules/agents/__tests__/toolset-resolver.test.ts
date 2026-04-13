import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveToolset, ResolverError } from '../toolset-resolver.js';
import type { ToolRecord } from '../../registry/types.js';

// Minimal mock ToolRecord factory
function makeTool(name: string, category: string): ToolRecord {
  return {
    name,
    version: 1,
    description: `Tool ${name}`,
    category,
    tags: [],
    inputs: [
      { name: 'x', direction: 'input', schemaName: 'Float', required: true,
        default: undefined, description: null, position: 0 },
    ],
    outputs: [
      { name: 'result', direction: 'output', schemaName: 'Float', required: true,
        default: undefined, description: null, position: 0 },
    ],
    entryPoint: 'tool.py:run',
    language: 'python',
    requires: [],
    stability: 'stable',
    costClass: 'fast',
    author: null,
    createdAt: '2026-01-01T00:00:00Z',
    changeType: 'net_new' as const,
    toolHash: 'abc123',
    status: 'active',
    directory: '/tmp/tools/' + name,
  };
}

const mockRegistry = {
  listToolsByCategory: vi.fn(),
  getTool: vi.fn(),
  listTools: vi.fn(),
};

describe('resolveToolset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a category entry to ToolDefinition[]', async () => {
    mockRegistry.listToolsByCategory.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
      makeTool('statistics.std', 'descriptive_statistics'),
      makeTool('statistics.median', 'descriptive_statistics'),
    ]);

    const { definitions, toolNameMap } = await resolveToolset(
      [{ category: 'descriptive_statistics' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(3);
    expect(definitions[0].name).toBe('statistics_mean');
    expect(toolNameMap.get('statistics_mean')).toBe('statistics.mean');
    expect(mockRegistry.listToolsByCategory).toHaveBeenCalledWith('descriptive_statistics');
  });

  it('resolves exact name entry', async () => {
    mockRegistry.getTool.mockResolvedValue(makeTool('sklearn.pca', 'sklearn'));

    const { definitions, toolNameMap } = await resolveToolset(
      [{ name: 'sklearn.pca' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(1);
    expect(definitions[0].name).toBe('sklearn_pca');
    expect(toolNameMap.get('sklearn_pca')).toBe('sklearn.pca');
  });

  it('resolves glob pattern', async () => {
    mockRegistry.listTools.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
      makeTool('statistics.std', 'descriptive_statistics'),
      makeTool('sklearn.pca', 'sklearn'),
    ]);

    const { definitions } = await resolveToolset(
      [{ name: 'statistics.*' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(2);
    expect(definitions.map(d => d.name)).toEqual(
      expect.arrayContaining(['statistics_mean', 'statistics_std']),
    );
  });

  it('deduplicates when same tool appears in multiple entries', async () => {
    mockRegistry.listToolsByCategory.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
    ]);
    mockRegistry.getTool.mockResolvedValue(
      makeTool('statistics.mean', 'descriptive_statistics'),
    );

    const { definitions } = await resolveToolset(
      [{ category: 'descriptive_statistics' }, { name: 'statistics.mean' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(1);
  });

  it('throws ResolverError(tool_not_found) for unknown exact name', async () => {
    mockRegistry.getTool.mockResolvedValue(null);

    await expect(
      resolveToolset([{ name: 'noexist.tool' }], mockRegistry as any),
    ).rejects.toThrow(ResolverError);

    await expect(
      resolveToolset([{ name: 'noexist.tool' }], mockRegistry as any),
    ).rejects.toMatchObject({ category: 'tool_not_found' });
  });

  it('throws ResolverError(toolset_empty_glob) when glob matches nothing', async () => {
    mockRegistry.listTools.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
    ]);

    await expect(
      resolveToolset([{ name: 'zzz.*' }], mockRegistry as any),
    ).rejects.toMatchObject({ category: 'toolset_empty_glob' });
  });

  it('maps structured schema ports to object type with description hint', async () => {
    const tool = makeTool('sklearn.pca', 'sklearn');
    tool.inputs = [
      { name: 'matrix', direction: 'input', schemaName: 'NumpyArray',
        required: true, default: undefined, description: null, position: 0 },
    ];
    mockRegistry.getTool.mockResolvedValue(tool);

    const { definitions } = await resolveToolset([{ name: 'sklearn.pca' }], mockRegistry as any);

    const prop = definitions[0].inputSchema.properties['matrix'];
    expect(prop.type).toBe('object');
    expect(prop.description).toContain('NumpyArray');
    expect(prop.description).toContain('value_ref');
  });

  it('returns empty arrays for empty toolset', async () => {
    const { definitions, toolNameMap } = await resolveToolset([], mockRegistry as any);
    expect(definitions).toHaveLength(0);
    expect(toolNameMap.size).toBe(0);
  });
});
