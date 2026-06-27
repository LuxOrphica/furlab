# Operation Contract (v0.1)

## Canon
- `transType`: `Reserve | Release | Use | Discard`
- `sourceRef`: `F2_ScrapPieceCard | React_ScrapPieceCard | Import`
- React write source: `React_ScrapPieceCard` (not `react-ui`)
- Access/F2 should not filter history only by `F2_*`

## History API Output
`/api/piece/:id/history` must return:
- `transType`
- `transAt`
- `statusBefore`
- `statusAfter`
- `sourceRef`
- `note`

## Status Transitions
- `reserve`: `Available -> Reserved`
- `release`: `Reserved -> Available`
- `use`: `Available | Reserved -> Used`
- `discard` (if enabled): `Available | Reserved | Used -> Discarded`

Invalid:
- reserve from `Used/Discarded`
- release from `Available/Used/Discarded`
- use from `Used/Discarded`
- any transition from `Discarded` to active states

## Legacy Compatibility
- Read legacy `sourceRef='react-ui'`
- Optional migration: `react-ui -> React_ScrapPieceCard`
