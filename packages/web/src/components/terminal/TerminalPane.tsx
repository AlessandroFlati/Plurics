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

function measureCellSize(container: HTMLElement, fontFamily: string, fontSize: number): { width: number; height: number } {
  const span = document.createElement('span');
  span.style.fontFamily = fontFamily;
  span.style.fontSize = `${fontSize}px`;
  span.style.visibility = 'hidden';
  span.style.position = 'absolute';
  span.style.whiteSpace = 'pre';
  span.textContent = 'W'.repeat(50);
  container.appendChild(span);
  const width = span.offsetWidth / 50;
  const height = span.offsetHeight || fontSize * 1.2;
  container.removeChild(span);
  return { width, height };
}

function fitTerminal(xterm: Terminal, container: HTMLElement, fontFamily: string, fontSize: number) {
  const cell = measureCellSize(container, fontFamily, fontSize);
  if (cell.width <= 0 || cell.height <= 0) return;

  // Account for scrollbar (14px) and small padding
  const availWidth = container.clientWidth - 14;
  const availHeight = container.clientHeight;

  const cols = Math.max(2, Math.floor(availWidth / cell.width));
  const rows = Math.max(1, Math.floor(availHeight / cell.height));

  if (cols !== xterm.cols || rows !== xterm.rows) {
    xterm.resize(cols, rows);
  }
}

const FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';
const FONT_SIZE = 13;

export function TerminalPane({ terminal, ws }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY,
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
        fitTerminal(xterm, containerRef.current, FONT_FAMILY, FONT_SIZE);
      }
    };

    // Initial fit + server handshake after layout settles
    setTimeout(() => {
      doFit();
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
