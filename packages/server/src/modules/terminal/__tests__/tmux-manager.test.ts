import { describe, it, expect, afterEach } from 'vitest';
import { TmuxManager } from '../tmux-manager.js';
import { TMUX_PREFIX } from '../types.js';

const tmux = new TmuxManager();

async function killTestSessions() {
  const sessions = await tmux.listSessions();
  for (const name of sessions) {
    await tmux.killSession(name);
  }
}

describe('TmuxManager', () => {
  afterEach(async () => {
    await killTestSessions();
  });

  it('creates a tmux session with the caam- prefix', async () => {
    const name = await tmux.createSession('test-session', 'bash', 80, 24);
    expect(name).toBe(`${TMUX_PREFIX}test-session`);
    const sessions = await tmux.listSessions();
    expect(sessions).toContain(`${TMUX_PREFIX}test-session`);
  });

  it('lists only caam- prefixed sessions', async () => {
    await tmux.createSession('list-test', 'bash', 80, 24);
    const sessions = await tmux.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    for (const s of sessions) {
      expect(s.startsWith(TMUX_PREFIX)).toBe(true);
    }
  });

  it('kills a session', async () => {
    await tmux.createSession('kill-test', 'bash', 80, 24);
    await tmux.killSession(`${TMUX_PREFIX}kill-test`);
    const sessions = await tmux.listSessions();
    expect(sessions).not.toContain(`${TMUX_PREFIX}kill-test`);
  });

  it('sends keys to a session', async () => {
    await tmux.createSession('keys-test', 'bash', 80, 24);
    await tmux.sendKeys(`${TMUX_PREFIX}keys-test`, 'echo hello\n');
  });

  it('captures pane content', async () => {
    await tmux.createSession('capture-test', 'bash', 80, 24);
    await tmux.sendKeys(`${TMUX_PREFIX}capture-test`, 'echo TESTMARKER\n');
    await new Promise(r => setTimeout(r, 500));
    const content = await tmux.capturePane(`${TMUX_PREFIX}capture-test`);
    expect(content).toContain('TESTMARKER');
  });

  it('throws when killing a non-existent session', async () => {
    await expect(tmux.killSession(`${TMUX_PREFIX}nonexistent-${Date.now()}`))
      .rejects.toThrow();
  });
});
