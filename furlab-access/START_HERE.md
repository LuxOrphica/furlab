# START HERE

This document is a short onboarding path for anyone opening the `furlab-access` repository for the first time.

## What this project is

`FurLab AC` is the working application contour of the FurLab project.
It is used for:
- fur fragment inventory accounting
- scan processing
- contour editing
- QR labeling
- preparation of fur fragments for layout

## Read these files first

1. `README.md`
   - high-level project overview
2. `PROJECT_STRUCTURE.md`
   - where everything is in the repository
3. `docs/FURLAB_AC_FUNCTIONALITY_v2.0.14_2026-03-15.md`
   - what the application currently does
4. `WORKFLOW_REACT_VS_ACCESS.md`
   - how responsibilities are split between UI and backend/database

## Main code areas

### Frontend
- `ui-lab/line-direction-visualizer-react/`
- This is the main React application.

### Backend/API
- `tools/ui_lab_server.js`
- `tools/server/`
- This is the project API and server-side runtime logic.

### Database
- `BD/Furlab 1.accdb`
- Main working Access database.

### Data and annotations
- `data/`
- Contains project data such as training annotations and QR registry artifacts.

## Where to look depending on the task

### If you work on UI
Start with:
- `ui-lab/line-direction-visualizer-react/src/App.tsx`
- `ui-lab/line-direction-visualizer-react/src/`
- `ui-lab/line-direction-visualizer-react/src/styles.css`

### If you work on scan processing or contour logic
Start with:
- `ui-lab/line-direction-visualizer-react/src/legacy/`
- `ui-lab/line-direction-visualizer-react/src/core/`
- `docs/furlab_scan_recognition_contract.md`
- `docs/contract_result_oriented_mezdra_contour.md`

### If you work on backend/API or database integration
Start with:
- `tools/ui_lab_server.js`
- `tools/server/`
- `BD/Furlab 1.accdb`
- `docs/RUNBOOK.md`

### If you work on QR labels or sticker generation
Start with:
- `ui-lab/line-direction-visualizer-react/public/qr-generator/`
- `data/qr-registry/`

## Current project reality

Some parts of the project are stable and operational:
- inventory records
- fragment cards
- geometry storage
- QR generation
- placement history

Some parts are still experimental or require careful review:
- automatic contour quality on difficult scans
- automatic nap-direction detection from the black marker line
- contour extraction quality on hard real-world cases

## Practical rule

If you are unsure where to begin, use this order:
1. understand the feature in `README.md`
2. locate the area in `PROJECT_STRUCTURE.md`
3. confirm the current behavior in `docs/FURLAB_AC_FUNCTIONALITY_v2.0.14_2026-03-15.md`
4. only then go into code changes
