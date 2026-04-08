import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../yaml-parser.js';

const VALID_YAML = `
name: test-workflow
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
shared_context: "Test context"
nodes:
  ingestor:
    preset: data-ingestor
  profiler:
    preset: data-profiler
    depends_on: [ingestor]
  analyst:
    preset: analyst
    depends_on: [profiler]
`;

describe('parseWorkflow', () => {
  it('parses valid workflow YAML', () => {
    const config = parseWorkflow(VALID_YAML);
    expect(config.name).toBe('test-workflow');
    expect(config.version).toBe(1);
    expect(config.config.max_total_tests).toBe(50);
    expect(Object.keys(config.nodes)).toHaveLength(3);
    expect(config.nodes.profiler.depends_on).toEqual(['ingestor']);
  });

  it('rejects missing name', () => {
    const yaml = VALID_YAML.replace('name: test-workflow', '');
    expect(() => parseWorkflow(yaml)).toThrow('Missing required field: "name"');
  });

  it('rejects missing config fields', () => {
    const yaml = VALID_YAML.replace('max_total_tests: 50', '');
    expect(() => parseWorkflow(yaml)).toThrow('Missing required field: "max_total_tests"');
  });

  it('rejects unknown dependency', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    depends_on: [nonexistent]
`;
    expect(() => parseWorkflow(yaml)).toThrow('depends on unknown node "nonexistent"');
  });

  it('rejects unknown branch target', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    branch:
      - condition: "always"
        goto: nonexistent
`;
    expect(() => parseWorkflow(yaml)).toThrow('branches to unknown node "nonexistent"');
  });

  it('detects cycles without max_invocations', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    depends_on: [b]
  b:
    preset: preset-b
    depends_on: [a]
`;
    expect(() => parseWorkflow(yaml)).toThrow('Cycle detected');
  });

  it('defaults shared_context to empty string', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
`;
    const config = parseWorkflow(yaml);
    expect(config.shared_context).toBe('');
  });

  it('rejects node without preset', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    depends_on: []
`;
    expect(() => parseWorkflow(yaml)).toThrow('must have a "preset" string');
  });
});
