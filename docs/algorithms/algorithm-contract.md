# FurLab Inventory Fill Algorithm Contract

## Scope
This contract defines required behavior for `directInventory` mode (`Из отходов`) in `/api/layout/fill/preview`.

## Mandatory outcome
1. Target is full zone coverage under strict mode.
2. If strict mode is enabled and zone is not fully covered, API must return `resultStatus: "failed"`.
3. Apply action must be blocked in UI for `resultStatus !== "ok"`.

## Pipeline
1. `candidate_pool`
- Build compatible pool from DB candidates.
- If candidate has valid `scrapContour`, derive fallback geometry metrics (`areaMm2`, `bboxWidthMm`, `bboxHeightMm`) when DB fields are missing.
- Record counts in `algorithmTrace.steps.candidate_pool`.

2. `placement_search`
- Iterate placements against residual zone.
- Evaluate candidates with gain, overlap, outside-zone and nap penalties.
- Keep coverage-first behavior for direct inventory scenario.
- Record `iterations`, `evaluated`, `placed` and reject reasons in `algorithmTrace.steps.placement_search`.

3. `repair_repack`
- Reserved step for local re-pack attempts.
- If disabled, still expose step state in trace.

4. `strict_final_check`
- Compute final `coveredRatio`.
- Validate against `coverageEps`.
- Set `fullCoverageOk` and `failedReason` (`time_budget_exceeded` or `zone_not_fully_covered`).
- Record all values in `algorithmTrace.steps.strict_final_check`.

## API contract additions
For `directInventory: true`, response includes:
- `resultStatus`: `"ok"` or `"failed"`
- `failedReason`: nullable string
- `algorithmTrace`: object with step-level counters and final decision

## Non-regression requirements
1. `compatibleCandidates` must not collapse because of missing DB bbox/area if contour exists.
2. Diagnostics in UI must include warnings and trace summary.
3. `full_coverage_required` warning must always appear when strict check fails.
