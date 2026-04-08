import { describe, it, expect, afterEach } from 'vitest';
import { TerminalSession } from '../terminal-session.js';
import { TmuxManager } from '../tmux-manager.js';

const tmux = new TmuxManager();
const sessions: TerminalSession[] = [];

afterEach(async () => {
  for (const s of sessions) {
    await s.destroy();
  }
  sessions.length = 0;
});

describe('TerminalSession', () => {
  it('creates and exposes metadata', async () => {
    const session = await TerminalSession.create(tmux, {
      name: 'meta-test',
      command: 'bash',
      cols: 80,
      rows: 24,
    });
    sessions.push(session);

    expect(session.id).toBeTruthy();
    expect(session.name).toBe('meta-test');
    expect(session.info.status).toBe('running');
    expect(session.info.cols).toBe(80);
    expect(session.info.rows).toBe(24);
  });

  it('writes data and receives output', async () => {
    const session = await TerminalSession.create(tmux, {
      name: 'io-test',
      command: 'bash',
    });
    sessions.push(session);

    const received: string[] = [];
    session.onData((data) => received.push(data));

    session.write('echo IOCHECK\n');

    await new Promise(r => setTimeout(r, 1000));
    const scrollback = await session.getScrollback();
    expect(scrollback).toContain('IOCHECK');
  });

  it('destroys the session and cleans up', async () => {
    const session = await TerminalSession.create(tmux, {
      name: 'destroy-test',
      command: 'bash',
    });

    await session.destroy();
    const exists = await tmux.hasSession(session.tmuxSession);
    expect(exists).toBe(false);
  });
});
