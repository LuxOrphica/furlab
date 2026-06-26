# DESIGN.md — FurLab Access UI System

> Visual language for the FurLab Access programme complex: inventory management, QR scanning, contour analysis, fragment traceability.

---

## 1. Visual Theme

**Character:** Technical, data-dense, professional. The interface serves operators working with physical fabric pieces — clarity and status legibility take priority over decoration.

**Tone:** Clean industrial. No gradients, no illustrations. Information surfaces immediately. Light mode is the primary working environment; dark mode preserves readability in low-light scanning contexts.

**Density:** Medium-high. Cards are compact (36px fields, 8-12px gaps). Whitespace is used purposefully — to group, not to breathe.

---

## 2. Color Palette

### Light Theme (default)
| Token | Value | Role |
|---|---|---|
| `--app-bg` | `#edf3ff` | Page background |
| `--panel-bg` | `#ffffff` | Card / panel surface |
| `--surface-bg` | `#f6f9ff` | Secondary surface, sidebar |
| `--text-color` | `#1f2a44` | Primary text |
| `--muted-color` | `#5f6b85` | Labels, captions, metadata |
| `--border-color` | `#d7e1f2` | Component borders |
| `--soft-border-color` | `#e6edf8` | Dividers, subtle separators |

### Accent (Blue)
| Token | Value | Role |
|---|---|---|
| `--accent-500` | `#2f6df6` | Primary action, active state |
| `--accent-400` | `#5a8cff` | Hover, focus ring |
| `--accent-100` | `#e8f0ff` | Selected row background, tinted surface |

### Status Colors
| State | 500 (text/icon) | 100 (background) |
|---|---|---|
| Success | `#1f8f63` | `#e6f7ef` |
| Warning | `#b8781d` | `#fff3df` |
| Danger | `#c33c3c` | `#fdecec` |

### Dark Theme (`data-theme="dark"`)
| Token | Value |
|---|---|
| `--app-bg` | `#111315` |
| `--panel-bg` | `#171a1f` |
| `--surface-bg` | `#1f232a` |
| `--text-color` | `#e5e7eb` |
| `--muted-color` | `#a3aab6` |
| `--border-color` | `rgba(148,163,184,0.24)` |
| `--soft-border-color` | `rgba(148,163,184,0.16)` |

Canvas (dark): bg `#1f232a`, grid minor `#2d3440`, grid major `#3a4250`.

---

## 3. Typography

**UI Font:** `"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`  
**Mono Font:** `SFMono, Menlo, Consolas, "Liberation Mono", monospace` — used for IDs, codes, numeric labels.

| Role | Size | Weight | Color |
|---|---|---|---|
| Section heading | 14px | 600 | `--text-color` |
| Body / default | 13px | 400 | `--text-color` |
| Label | 12px | 500 | `#4b5563` |
| Caption | 11px | 400 | `--muted-color` |
| Mono ID/code | 11–12px | 400 | inherit or muted |

Letter spacing: `0.04em` on uppercase labels and small caps (`text-transform: uppercase`).

---

## 4. Spacing & Radius

```
--space-1: 4px   (icon gap, tight inline)
--space-2: 8px   (element gap, button padding)
--space-3: 12px  (card inner padding, section gap)
--space-4: 16px  (panel padding, layout gap)
```

```
--radius-sm: 8px   (buttons, inputs, small cards)
--radius-md: 12px  (panels, large cards, modals)
```

---

## 5. Components

### Button
- Height: 32–36px
- Padding: `6px 14px`
- Border-radius: `--radius-sm` (8px)
- Primary: bg `--accent-500`, text white, hover bg `--accent-400`
- Secondary: bg transparent, border `--border-color`, text `--text-color`
- Danger: bg `--danger-100`, border `--danger-500`, text `--danger-500`
- Font: 13px, weight 500

### Input / Field
```css
height: var(--ui-field-height-card); /* 36px in card, 34px in sidebar */
border: 1px solid var(--ui-field-border); /* #d9d9d9 */
border-radius: var(--ui-field-radius); /* 8px */
background: var(--ui-field-bg);
font-size: 13px;
```

### Status Pill
Inline badge for piece/fragment status. Always use color pair (500 + 100), never plain text.

```css
display: inline-flex;
align-items: center;
gap: 4px;
padding: 2px 8px;
border-radius: 20px;
font-size: 12px;
font-weight: 500;
border: 1px solid <status-500>;
background: <status-100>;
color: <status-500>;
```

States: `success` (зеленый), `warning` (янтарный), `danger` (красный), `default` (border `--border-color`, bg `--surface-bg`, text `--muted-color`).

### Card / Panel
```css
background: var(--panel-bg);
border: 1px solid var(--border-color);
border-radius: var(--radius-md); /* 12px */
box-shadow: 0 10px 24px rgba(0,0,0,0.06);
padding: var(--space-3) var(--space-4); /* 12px 16px */
```

### Overlay Panel (canvas context)
Floating info/control panel over a canvas view:
```css
background: rgba(255,255,255,0.94);
border: 1px solid #d7dbe2;
border-radius: 10px;
box-shadow: 0 4px 12px rgba(15,23,42,0.08);
backdrop-filter: blur(2px);
```

### Sidebar
- Width: 240px, fixed
- Background: `--surface-bg`
- Selected item: bg `--accent-100`, color `--accent-500`, border-left 2px `--accent-500`
- Section label: 11px, uppercase, `0.08em` letter-spacing, `--muted-color`

### Data Table Row
- Default: bg transparent
- Hover: bg `--surface-bg`
- Selected: bg `--accent-100`
- Border-bottom: 1px `--soft-border-color`
- Cell padding: `6px 12px`

---

## 6. Layout

**Shell pattern:** Fixed sidebar (240px) + main content area. Header bar optional (40px).

**Card grid:** `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, gap `12px`.

**Detail layout (split view):** `grid-template-columns: minmax(0, 1fr) 360px`, gap `12px`. Right panel = metadata/controls.

**Canvas layout:** Canvas fills available space, overlays positioned absolute inside wrapper with `position: relative`. Canvas wrapper: border `#d9d9d9`, radius `8px`, bg `#f7f8fa` (light) / `#1f232a` (dark).

---

## 7. Depth & Shadow

Three shadow levels:
```
Level 1 (card):    0 2px 6px rgba(0,0,0,0.04)
Level 2 (panel):   0 10px 24px rgba(0,0,0,0.06)
Level 3 (overlay): 0 4px 12px rgba(15,23,42,0.08)
```

No heavy drop shadows. Borders carry the majority of visual separation. Z-index layers: content (0) → sidebar overlay (10) → canvas overlays (20) → modals (100).

---

## 8. Do's and Don'ts

**Do:**
- Use status pills for every piece/fragment state — never plain text
- Use monospace font for QR codes, IDs, barcodes, numeric measurements
- Keep action buttons to the right or bottom of a panel
- Use `--accent-100` as selected state background (not a full blue fill)
- Use `--muted-color` for all metadata, timestamps, secondary counts
- Support dark theme via `data-theme="dark"` on root — use CSS variables only, no hardcoded colors in components

**Don't:**
- Don't use more than 3 accent-blue elements in one panel
- Don't mix status colors for non-status purposes (no green for decorative elements)
- Don't use shadows heavier than Level 2 inside cards
- Don't use `border-radius` above `--radius-md` (12px) — no pill-shaped cards
- Don't use font sizes below 11px
- Don't hardcode colors — always reference a CSS variable or a documented token

---

## 9. Responsive Behavior

The interface is a desktop-first tool, optimized for 1280px+ operator workstations.

- Below 1280px: sidebar collapses to icon-only (40px) or overlays on demand
- Split-view panels stack vertically below 900px (`grid-template-columns: 1fr`)
- Card grids reflow naturally via `auto-fill` / `minmax`
- Canvas views are never smaller than 400×400px — scroll rather than shrink
- Touch targets minimum 36px (already met by field heights)

---

## 10. Agent Prompt Guide

When generating new UI components for this project, Claude should:

1. **Always use CSS variables** from this document — never hardcode color hex values in new components.
2. **Match the existing component patterns** — buttons at 32-36px, cards with `--radius-md`, status always via pills.
3. **Respect dark theme** — every new CSS selector that sets color or background must have a `[data-theme="dark"]` override, or use a variable that already has one.
4. **Use Ant Design** for form controls, tables, and modals — customize via CSS variable overrides, not by reimplementing from scratch.
5. **Density first** — default to compact spacing (`--space-2`/`--space-3`). Only use `--space-4` for outer panel padding.
6. **Status colors are semantic** — use success/warning/danger only for actual operational states (piece status, scan result, validation outcome).
7. **Monospace for data** — QR codes, fragment IDs, measurements, coordinates always use `--font-mono`.
8. **Canvas components** use the canvas-specific palette (`#f7f8fa` / `#1f232a` bg, `#d9d9d9` wrapper border) and overlay panel pattern for controls.

**Quick reference prompt snippet:**
> "Follow DESIGN.md at project root. Use CSS variables, Ant Design base, 8px radius for inputs, 12px for cards. Status pills with (500+100) color pairs. Dark theme via data-theme=dark. No hardcoded hex."
