import { describe, it, expect, afterEach } from 'vitest';
import { TerminalRegistry } from '../terminal-registry.js';
import { TmuxManager } from '../tmux-manager.js';

const tmux = new TmuxManager();
let registry: TerminalRegistry;

afterEach(async () => {
  await registry.destroyAll();
});

describe('TerminalRegistry', () => {
  it('spawns a terminal and retrieves it by id', async () => {
    registry = new TerminalRegistry(tmux);
    const info = await registry.spawn({ name: 'reg-test', command: 'bash' });
    expect(info.name).toBe('reg-test');
    const session = registry.get(info.id);
    expect(session).toBeDefined();
    expect(session!.name).toBe('reg-test');
  });

  it('lists all terminals', async () => {
    registry = new TerminalRegistry(tmux);
    await registry.spawn({ name: 'list-a', command: 'bash' });
    await registry.spawn({ name: 'list-b', command: 'bash' });
    const all = registry.list();
    expect(all).toHaveLength(2);
  });

  it('kills a terminal and removes it from the registry', async () => {
    registry = new TerminalRegistry(tmux);
    const info = await registry.spawn({ name: 'kill-reg', command: 'bash' });
    await registry.kill(info.id);
    expect(registry.get(info.id)).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it('discovers existing tmux sessions', async () => {
    registry = new TerminalRegistry(tmux);
    await tmux.createSession('discover-me', 'bash', 80, 24);
    await registry.discover();
    const all = registry.list();
    expect(all.some(t => t.name === 'discover-me')).toBe(true);
  });
});
