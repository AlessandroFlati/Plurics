import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { subscribeToOutput } from '../../stores/terminal-store';
import type { WebSocketClient } from '../../services/websocket-client';
import type { TerminalInfo } from '../../types';
import '@xterm/xterm/css/xterm.css';
import './TerminalPane.css';

interface TerminalPaneProps {
  terminal: TerminalInfo;
  ws: WebSocketClient | null;
}

export function TerminalPane({ terminal, ws }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);

    // Use WebGL renderer for proper rendering
    try {
      xterm.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, fall back to canvas (default in @xterm/xterm)
    }

    xtermRef.current = xterm;

    // Defer fit() to next frame so the container has dimensions.
    // Always send an explicit resize after fit, because onResize only fires
    // when dimensions actually change -- if the default matches, it won't fire,
    // and the server needs the first resize to start pipe-pane + launch the command.
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        // Send resize (triggers pipe-pane + command start for new terminals)
        ws?.send({
          type: 'terminal:resize',
          terminalId: terminal.id,
          cols: xterm.cols,
          rows: xterm.rows,
        });
        // Subscribe to output (sends current screen content + ongoing output)
        ws?.send({
          type: 'terminal:subscribe',
          terminalId: terminal.id,
        });
      } catch { /* container may not be ready */ }
    });

    xterm.onData((data) => {
      ws?.send({
        type: 'terminal:input',
        terminalId: terminal.id,
        data,
      });
    });

    const unsub = subscribeToOutput(terminal.id, (data) => {
      xterm.write(data);
    });

    xterm.onResize(({ cols, rows }) => {
      ws?.send({
        type: 'terminal:resize',
        terminalId: terminal.id,
        cols,
        rows,
      });
    });

    const observer = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* terminal may be disposed */ }
    });
    observer.observe(containerRef.current);

    return () => {
      unsub();
      observer.disconnect();
      xterm.dispose();
    };
  }, [terminal.id, ws]);

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-header">
        <span className="terminal-pane-name">{terminal.name}</span>
        <span className={`terminal-pane-status terminal-pane-status--${terminal.status}`}>
          {terminal.status}
        </span>
      </div>
      <div className="terminal-pane-body" ref={containerRef} />
    </div>
  );
}
