import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TMUX_PREFIX } from './types.js';

const execFileAsync = promisify(execFile);

export class TmuxManager {
  async createSession(name: string, command: string, cols: number, rows: number): Promise<string> {
    const sessionName = `${TMUX_PREFIX}${name}`;
    await execFileAsync('tmux', [
      'new-session', '-d', '-s', sessionName,
      '-x', String(cols), '-y', String(rows),
      command,
    ]);
    return sessionName;
  }

  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'list-sessions', '-F', '#{session_name}',
      ]);
      return stdout.trim().split('\n').filter(name => name.startsWith(TMUX_PREFIX));
    } catch {
      return [];
    }
  }

  async killSession(sessionName: string): Promise<void> {
    await execFileAsync('tmux', ['kill-session', '-t', sessionName]);
  }

  async sendKeys(sessionName: string, keys: string): Promise<void> {
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, '-l', keys]);
  }

  async capturePane(sessionName: string, lines = 1000): Promise<string> {
    const { stdout } = await execFileAsync('tmux', [
      'capture-pane', '-t', sessionName, '-p', '-S', String(-lines),
    ]);
    return stdout;
  }

  async resizePane(sessionName: string, cols: number, rows: number): Promise<void> {
    await execFileAsync('tmux', [
      'resize-window', '-t', sessionName, '-x', String(cols), '-y', String(rows),
    ]);
  }

  async hasSession(sessionName: string): Promise<boolean> {
    try {
      await execFileAsync('tmux', ['has-session', '-t', sessionName]);
      return true;
    } catch {
      return false;
    }
  }
}
