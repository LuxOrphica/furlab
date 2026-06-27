# Workspace Hygiene

Quick cleanup command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/housekeeping_workspace.ps1
```

What it does:
- moves root `_tmp_*` files into `tmp/session-archive/<timestamp>/`

Archive generated docs artifacts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/housekeeping_workspace.ps1 -ArchiveGeneratedDocs
```

Archive heavy generated UI-lab artifacts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/housekeeping_workspace.ps1 -ArchiveUiLabArtifacts
```

Run full cleanup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/housekeeping_workspace.ps1 -ArchiveGeneratedDocs -ArchiveUiLabArtifacts
```

Safe preview mode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/housekeeping_workspace.ps1 -DryRun -ArchiveGeneratedDocs -ArchiveUiLabArtifacts
```

Each run writes manifest into `tmp/session-archive/<timestamp>-manifest.txt`.
