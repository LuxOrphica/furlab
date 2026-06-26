# Oracle Calibration (Python vs JS/Worker)

## Goal
- Keep fast runtime in JS/Worker.
- Use Python solver as oracle for behavior/quality calibration.

## Case format
Each case is a JSON file in `scripts/oracle_cases`:
- `name`
- `seed`
- `zone.points` (mm)
- `pieces[]` with `id` and polygon `points` (mm)
- `params` (solver knobs)

## Commands
- Install oracle deps once:
  - `python -m pip install -r scripts/oracle_requirements.txt`
- Run oracle for one case:
  - `npm run oracle:run`
- Compare oracle vs JS API for all cases:
  - `npm run oracle:compare`
  - optional:
    - `node scripts/compare_oracle_vs_js.js --cases scripts/oracle_cases --api http://127.0.0.1:5600 --python python`

## Output
- Per-case diff is printed to console.
- Full report is saved to:
  - `tmp/oracle_compare_report.json`

## Metrics compared
- `coveragePercent`
- `uncoveredMm2`
- `overlapMm2`
- `placementsCount`

## Next
1. Add 10-20 real cases from FurLab zones.
2. Freeze report snapshot as golden baseline.
3. Tune JS/Worker stages until deltas are acceptable.

## Fast case export from UI
- In Step 2 modal (`Шаг 2. Предпросмотр и доводка подбора`) click `Экспорт case`.
- Browser downloads `oracle_case_zone_<id>_<timestamp>.json`.
- Move exported file to `scripts/oracle_cases/`.
- Run:
  - `npm run oracle:compare`
