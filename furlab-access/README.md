# FurLab AC

`FurLab AC` is the working interface of the FurLab project for fur inventory accounting, scan processing, contour editing, QR labeling, and preparation of fur fragments for layout.

## Repository contents

- `ui-lab/line-direction-visualizer-react` - main React UI
- `tools/ui_lab_server.js` - API server for working with data and uploads
- `BD/Furlab 1.accdb` - working Access database
- `ui-lab/line-direction-visualizer-react/public/qr-generator` - QR generator served from the same application bundle
- `docs/` - project documentation

## Main application sections

- `/scan` - scan upload, contour processing, and fragment parameter capture
- `/inventory` - fur fragment inventory and card view
- `/placements` - placement history
- `/reports` - reporting section
- `/qr-generator/index.html?mode=single` - QR generator in single-sticker mode

## Key workflows

### Scan processing

- load a scan
- detect or edit the contour
- calculate area and bounding metrics
- capture fragment parameters
- save the record to the database

### Inventory management

- maintain fragment cards
- store material, quality, location, and status
- review normalized contour geometry for layout
- inspect placement history

### QR generation

- single sticker mode
- A4 sheet mode
- issued-code registry
- photo composition mode for placing a QR label onto a fur photo

### Training and experiments

The repository also contains dataset and annotation artifacts used for contour-related experiments and training preparation.

## Important project paths

- Access DB: `BD/Furlab 1.accdb`
- QR issued registry: `data/qr-registry/issued_codes.ndjson`
- Training annotations: `data/training/annotations.ndjson`

## Notes

- Some project areas are still experimental, especially automatic contour quality and automatic nap-direction detection from the black marker line.
- Manual contour correction remains part of the normal workflow.
