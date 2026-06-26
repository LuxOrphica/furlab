# FurLab Solver Contract (Grid/Quality/Determinism)

## Coordinates and quantization
- Units: millimeters everywhere.
- Grid origin:
  - `ox = floor(minX_zone / r) * r`
  - `oy = floor(minY_zone / r) * r`
- Grid padding: 1-2 cells around zone bbox.
- Cell sample point: center of the cell
  - `(ox + (i + 0.5) * r, oy + (j + 0.5) * r)`
- Boundary policy: boundary-inclusive.
- Transforms `(x, y, theta)` stay float; indexing/rounding formulas must be consistent everywhere.

## Quality modes
- Draft:
  - `r = 5..10 mm`
  - stop criterion: `UncoveredCount == 0` on draft grid
  - no final Clipper residual step
- Strict:
  - `r = 2 mm` (default)
  - after `UncoveredCount == 0`, run one final residual check:
    - `residual = Zone - Union(clippedPlacements)`
    - success if `Area(residual) <= epsMm2`

## Time budget and progress
- Solver must run in chunks (10-20 ms) and report progress each chunk:
  - coverage%
  - uncoveredMm2
  - overlapMm2
  - placementsCount
  - phase

## Determinism
- All randomness uses seeded RNG only.
- `seed` is persisted in `paramsSnapshot`.
- Same inputs + same seed => same placements order and geometry.

