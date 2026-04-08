# Look and Feel -- Design Specification

> Created: 2026-04-07 16:46 UTC

## Overview

Polish pass on the Phase 1 UI: introduce a design token system, refine the sidebar into a structured IDE panel, implement hover-reveal pane toolbars, improve empty slot UX, load Inter font, and remove the layout presets bar. No new dependencies beyond a Google Fonts link. All changes are CSS + minor JSX tweaks -- no functionality changes.

## Approach

Design tokens in a single `theme.css` file + targeted CSS rewrites per component. All component CSS files switch from hardcoded hex values to CSS custom properties. No Tailwind, no component library, no build-time additions.

## 1. Design Tokens

New file: `packages/web/src/theme.css`, imported once in `main.tsx`.

```css
/* Background layers */
--color-bg: #0f0f0f;
--color-surface-1: #171717;   /* sidebar, toolbar strips */
--color-surface-2: #1f1f1f;   /* inputs, list items */
--color-surface-3: #2a2a2a;   /* hover states, secondary buttons */

/* Borders */
--color-border: #2e2e2e;
--color-border-focus: #525252;

/* Text */
--color-text-primary: #e5e5e5;
--color-text-secondary: #a3a3a3;
--color-text-muted: #525252;

/* Semantic */
--color-success: #4ade80;
--color-success-bg: rgba(74, 222, 128, 0.1);
--color-error: #f87171;
--color-error-bg: rgba(248, 113, 113, 0.1);

/* Shape */
--radius-sm: 4px;
--radius-md: 6px;

/* Typography */
--font-ui: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

No accent color variable. Interactive states use `--color-surface-3` (hover backgrounds) and `--color-border-focus` (focused inputs) only.

## 2. Sidebar

**Width:** Fixed `240px` (removes layout jitter from current `max-content`).

**Structure (top to bottom):**
1. App header: "CAAM" in small caps, `--color-text-muted`, 11px
2. **Workspace** section label + `WorkspaceSelector` (behavior unchanged)
3. `1px` divider (`--color-border`)
4. **Terminals** section label + spawn controls + terminal list
5. Bottom edge divider

**Section labels:** 11px Inter, `--color-text-muted`, uppercase, letter-spacing `0.08em`, `margin-bottom: 8px`.

**Terminal list items:**
- `36px` tall, `8px` horizontal padding
- `border-radius: var(--radius-sm)` on hover background
- No bottom border per item -- use vertical spacing instead
- Kill button (`×`) right-aligned, `opacity: 0` by default, `opacity: 1` on row hover
- Status indicator: `6px` filled circle (not text pill) -- green (`--color-success`) for running, red (`--color-error`) for exited, left of the name

**Spawn row:** input and button get `--radius-md`, consistent `6px 8px` padding. Button uses neutral style (`--color-surface-3` background, no blue).

**Font:** `var(--font-ui)` throughout. Path display uses `var(--font-mono)`.

## 3. Pane Header and Hover Toolbar

**Pane header:**
- Height: `32px`
- Background: `var(--color-surface-1)`
- Bottom border: `1px solid var(--color-border)`
- Terminal name: 12px Inter, `--color-text-secondary`
- Status dot: `6px` circle, same semantics as sidebar

**Hover toolbar (split/merge buttons):**
- Container `opacity: 0` by default; transitions to `opacity: 1` in `120ms` when mouse enters the pane header
- Buttons: `24×24px`, icon-only (SVG or Unicode), `--radius-sm`, `--color-surface-3` background on hover
- Merge button: icon color shifts to `--color-error` on hover (no background chip)
- Each button has a `title` attribute for native tooltip

**Allotment splitter:**
- Styled to `2px` wide/tall, color `--color-border`
- Hover/drag state: `--color-border-focus`

## 4. Empty Slot

- Full pane area is the click target (no button chrome)
- Background: `--color-surface-1`
- Inset border: `1px dashed --color-border`
- Centered content: `+` icon (`24px`, `--color-text-muted`) above "Spawn terminal" label (`12px`, `--color-text-muted`)
- On hover: border color becomes `--color-border-focus`, icon and label shift to `--color-text-secondary`

## 5. Typography and Global Shell

**Inter font:** One `<link>` in `index.html` for weights 400/500/600, latin subset. Example:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

**App shell** (`App.tsx` root div):
- `background: var(--color-bg)`
- `font-family: var(--font-ui)`
- `color: var(--color-text-primary)`

**Scrollbars** (sidebar list, autocomplete dropdown):
```css
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-surface-3); border-radius: 2px; }
```

## 6. Removals

- `LayoutPresets.tsx` and its import in `App.tsx` -- deleted
- The `<div>` toolbar strip wrapping `<LayoutPresets>` in `App.tsx` -- removed
- `LayoutPresets.css` if it exists -- deleted

## 7. File Changes

### New files
- `packages/web/src/theme.css`

### Modified files
- `packages/web/index.html` -- add Inter `<link>` tags
- `packages/web/src/main.tsx` -- import `theme.css`
- `packages/web/src/App.tsx` -- remove LayoutPresets section, apply token vars to shell div
- `packages/web/src/components/terminal/TerminalPane.css` -- rewrite with tokens, status dot, hover toolbar opacity transition
- `packages/web/src/components/terminal/TerminalPane.tsx` -- add hover state for toolbar visibility
- `packages/web/src/components/grid/SplitLayout.css` -- splitter styling
- `packages/web/src/components/grid/PaneToolbar.css` -- rewrite with tokens, 24px buttons
- `packages/web/src/components/grid/EmptySlot.tsx` -- new layout (icon + label, full surface click target)
- `packages/web/src/components/grid/EmptySlot.css` -- rewrite
- `packages/web/src/components/sidebar/TerminalManager.css` -- rewrite with tokens, fixed width, section labels, row hover
- `packages/web/src/components/sidebar/TerminalManager.tsx` -- add app header, section labels, dividers; status dot instead of pill
- `packages/web/src/components/sidebar/WorkspaceSelector.css` -- rewrite with tokens

### Deleted files
- `packages/web/src/components/grid/LayoutPresets.tsx`
- `packages/web/src/components/grid/LayoutPresets.css` (if present)
