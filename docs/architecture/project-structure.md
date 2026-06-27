# PROJECT STRUCTURE

This document is a quick guide to the repository layout of `furlab-access`.
It is intended to help navigate the working project, separate core product code from supporting assets, and identify experimental areas.

## 1. Core project areas

### `ui-lab/line-direction-visualizer-react/`
Main React application for **FurLab AC**.

Contains:
- current UI and routing
- scan upload and contour workflow
- inventory screens
- QR generator public pages
- frontend logic for geometry, contour editing, and API integration

This is the primary frontend codebase of the project.

### `tools/`
Backend, runtime, packaging, and development utilities.

Important files:
- `tools/ui_lab_server.js` - main API server
- `tools/start_ui_lab_server.ps1` - backend start script
- `tools/start_ldv_docker_stack.ps1` - frontend Docker start/build script
- `tools/start_furlab_local_silent.ps1` - local project start script
- `tools/run_premerge_checks.ps1` - project validation helper
- `tools/tests/` - backend and runtime tests
- `tools/server/` - server-side helpers and runtime modules
- `tools/electron-shell/` - Electron shell integration

### `BD/`
Working database files.

Important file:
- `BD/Furlab 1.accdb` - main Access database used by the project

### `data/`
Project data and machine-readable artifacts.

Contains:
- training annotations
- QR issued-code registry
- other structured data used by tools and experiments

## 2. Documentation and contracts

### `docs/`
Main project documentation.

Contains:
- functionality descriptions
- architecture notes
- operational runbooks
- segmentation contracts and reports
- migration notes
- presentation materials

Recommended entry points:
- `docs/FURLAB_AC_FUNCTIONALITY_v2.0.14_2026-03-15.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNBOOK.md`
- `docs/furlab_scan_recognition_contract.md`

### Root documentation files
- `README.md` - high-level project overview
- `WORKFLOW_REACT_VS_ACCESS.md` - responsibility split between React/UI and Access/backend
- `PROJECT_STRUCTURE.md` - this file

## 3. Other repository areas

### `ui-lab/`
Legacy and auxiliary UI area.

Contains:
- historical prototypes
- standalone tools
- visual experiments
- architecture overview page
- additional utility pages such as `qr-generator/`

Important subfolders:
- `ui-lab/line-direction-visualizer-react/` - current main app
- `ui-lab/qr-generator/` - standalone QR utility assets
- `ui-lab/line-direction-visualizer/` - legacy implementation
- `ui-lab/normal-visualizer/` - older visual tool
- `ui-lab/gui-kb/` - separate local knowledge-base UI

### `access/`
Access-related supporting files and integration material.

### `vba/`
VBA-related project assets and scripts.

### `sql/`
SQL scripts and database-related helpers.

### `spec/`
Specifications and structured project reference material.

### `scripts/`
Small standalone scripts and helpers.

### `notes/`
Working notes and supporting project materials.

## 4. Build, runtime, and environment files

### `docker-compose.yml`
Docker orchestration for the frontend/runtime stack.

### `.env.example`
Example environment configuration for project runtime.

### `.gitignore`
Repository ignore rules, including local-only artifacts and copied databases.

## 5. Experimental and non-core areas

### `backups/`
Repository-side backup or exported backup material.
Not part of the main product runtime.

### `dist/`
Generated output/build artifacts.
Not primary source code.

### `tmp/`
Temporary workspace artifacts.
Not part of the core project.

### `ui-lab/archive/` and `docs/archive/`
Archived materials kept for reference.
Not part of the current main implementation.

## 6. Practical orientation

If you need to understand or modify the current product, start here:
1. `README.md`
2. `docs/FURLAB_AC_FUNCTIONALITY_v2.0.14_2026-03-15.md`
3. `ui-lab/line-direction-visualizer-react/`
4. `tools/ui_lab_server.js`
5. `BD/Furlab 1.accdb`

If you need to work on scan recognition, contouring, or experimental geometry logic, also review:
1. `docs/furlab_scan_recognition_contract.md`
2. `docs/contract_result_oriented_mezdra_contour.md`
3. `data/`
4. related ML/experiment folders inside `ui-lab/line-direction-visualizer-react/`

## 7. Repository intent

This repository contains both:
- the **working FurLab AC product contour**
- and supporting experimental, research, and migration material accumulated during development

When in doubt, treat `ui-lab/line-direction-visualizer-react/`, `tools/`, `BD/`, `data/`, and `docs/` as the main project spine.
