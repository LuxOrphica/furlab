# Contour Preview Render Contract

## Responsibility split
- `W_ContourPreview.bas`: geometry, coordinates, numeric formatting, text data.
- `vba/templates/*.xml`: visual structure and styling (tokens/classes).
- `vba/templates/contour_preview_shell.html`: outer HTML shell only.

## Style source of truth
- All preview styles live inside SVG templates.
- `bas` no longer injects fallback style blocks.
- Main visual tokens:
  - `t-axis`, `t-axis-tick`, `t-axis-text`
  - `t-grid-major`, `t-grid-minor`
  - `t-contour`
  - `t-panel`, `t-panel-title`, `t-panel-rule`, `t-panel-text`

## Axis rules
- `Piece`:
  - 20 mm major step.
  - Last top/right-end ticks and labels are intentionally skipped to avoid overlap with `X, mm` and `Y, mm`.
- `A3`:
  - 10 mm grid, 50 mm labeled major lines.
  - Right/bottom box lines are light (`t-box-line`), top/left are main axes.
  - End labels near axis captions are intentionally suppressed.

## Modes
- `Piece raw`
- `Piece normalized`
- `Scan A3`

## Smoke-check set
- Open one contour in each mode and validate:
  - axis labels do not overlap captions;
  - contour is fully visible;
  - nap arrow is visible and captioned;
  - summary panel is rendered on the right.
