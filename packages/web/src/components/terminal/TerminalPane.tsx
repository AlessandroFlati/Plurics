import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
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

function getCellDimensions(xterm: Terminal): { width: number; height: number } | null {
  // Read cell dimensions from xterm's internal renderer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const core = (xterm as any)._core;
  const dims = core?._renderService?.dimensions?.css?.cell;
  if (dims?.width && dims?.height) return dims;
  // Fallback: read from char size service
  const charWidth = core?._charSizeService?.width;
  const charHeight = core?._charSizeService?.height;
  if (charWidth && charHeight) return { width: charWidth, height: charHeight };
  return null;
}

function fitTerminal(xterm: Terminal, container: HTMLElement) {
  const cell = getCellDimensions(xterm);
  if (!cell) return;

  const scrollbarWidth = (xterm as any)._core?.viewport?.scrollBarWidth ?? 0;
  const availWidth = container.clientWidth - scrollbarWidth;
  const availHeight = container.clientHeight;

  const cols = Math.max(2, Math.floor(availWidth / cell.width));
  const rows = Math.max(1, Math.floor(availHeight / cell.height));

  if (cols !== xterm.cols || rows !== xterm.rows) {
    xterm.resize(cols, rows);
  }
}

const FONT = { family: 'Menlo, Monaco, "Courier New", monospace', size: 13 };

export function TerminalPane({ terminal, ws }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: FONT.size,
      fontFamily: FONT.family,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    xterm.open(containerRef.current);

    try {
      xterm.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, canvas renderer is fine
    }

    xtermRef.current = xterm;

    const doFit = () => {
      if (containerRef.current) {
        fitTerminal(xterm, containerRef.current);
      }
    };

    // Initial fit + server handshake after layout settles
    setTimeout(() => {
      doFit();
      // Clear the terminal buffer before subscribing so the SIGWINCH
      // redraw from the server renders onto a clean slate
      xterm.reset();
      ws?.send({
        type: 'terminal:resize',
        terminalId: terminal.id,
        cols: xterm.cols,
        rows: xterm.rows,
      });
      ws?.send({
        type: 'terminal:subscribe',
        terminalId: terminal.id,
      });
    }, 100);

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

    const observer = new ResizeObserver(() => doFit());
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
