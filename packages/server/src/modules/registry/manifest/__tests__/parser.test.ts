import { describe, it, expect } from 'vitest';
import { parseToolManifest, ManifestParseError } from '../parser.js';

const MINIMAL_YAML = `
name: test.echo_int
version: 1
change_type: net_new
description: Echo an integer.

inputs:
  value:
    schema: Integer
    required: true
    description: the value to echo

outputs:
  echoed:
    schema: Integer
    description: same as input

implementation:
  language: python
  entry_point: tool.py:run
`;

describe('parseToolManifest', () => {
  it('parses a minimal manifest', () => {
    const m = parseToolManifest(MINIMAL_YAML);
    expect(m.name).toBe('test.echo_int');
    expect(m.version).toBe(1);
    expect(m.description).toBe('Echo an integer.');
    expect(m.inputs.value).toEqual({
      schema: 'Integer',
      required: true,
      description: 'the value to echo',
    });
    expect(m.outputs.echoed).toEqual({
      schema: 'Integer',
      description: 'same as input',
    });
    expect(m.implementation).toEqual({
      language: 'python',
      entryPoint: 'tool.py:run',
    });
  });

  it('parses optional top-level fields', () => {
    const yaml = `${MINIMAL_YAML}
category: testing
tags: [fixture, primitive]
metadata:
  author: seed
  stability: stable
  cost_class: fast
`;
    const m = parseToolManifest(yaml);
    expect(m.category).toBe('testing');
    expect(m.tags).toEqual(['fixture', 'primitive']);
    expect(m.metadata?.author).toBe('seed');
    expect(m.metadata?.stability).toBe('stable');
    expect(m.metadata?.costClass).toBe('fast');
  });

  it('parses tests block when present', () => {
    const yaml = `${MINIMAL_YAML}
tests:
  file: tests.py
  required: true
`;
    const m = parseToolManifest(yaml);
    expect(m.tests).toEqual({ file: 'tests.py', required: true });
  });

  it('parses implementation.requires', () => {
    const yaml = `
name: x.y
version: 1
change_type: net_new
description: d
inputs: {}
outputs: {}
implementation:
  language: python
  entry_point: tool.py:run
  requires:
    - numpy>=1.24
    - scipy
`;
    const m = parseToolManifest(yaml);
    expect(m.implementation.requires).toEqual(['numpy>=1.24', 'scipy']);
  });

  it('throws ManifestParseError on malformed YAML', () => {
    expect(() => parseToolManifest('name: [unclosed')).toThrow(ManifestParseError);
  });

  it('throws when name is missing', () => {
    expect(() => parseToolManifest('version: 1\nchange_type: net_new\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/name/);
  });

  it('throws when version is missing or not an integer', () => {
    expect(() => parseToolManifest('name: x\nchange_type: net_new\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/version/);
    expect(() => parseToolManifest('name: x\nversion: "abc"\nchange_type: net_new\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/version/);
  });

  it('throws when change_type is missing', () => {
    expect(() => parseToolManifest('name: x\nversion: 1\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/change_type/);
  });

  it('throws when change_type is invalid', () => {
    expect(() => parseToolManifest('name: x\nversion: 1\nchange_type: breaking\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/change_type/);
  });

  it('accepts all valid change_type values', () => {
    for (const ct of ['net_new', 'additive', 'destructive']) {
      const yaml = `name: x\nversion: 1\nchange_type: ${ct}\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run`;
      const m = parseToolManifest(yaml);
      expect(m.change_type).toBe(ct);
    }
  });

  it('throws when implementation.language is not python', () => {
    const yaml = `
name: x
version: 1
change_type: net_new
description: d
inputs: {}
outputs: {}
implementation:
  language: rust
  entry_point: tool.py:run
`;
    expect(() => parseToolManifest(yaml)).toThrow(/python/);
  });

  it('throws when a port is missing a schema', () => {
    const yaml = `
name: x
version: 1
change_type: net_new
description: d
inputs:
  broken:
    required: true
outputs: {}
implementation:
  language: python
  entry_point: tool.py:run
`;
    expect(() => parseToolManifest(yaml)).toThrow(/schema/);
  });
});
