# SQL Migrations and Journal

## Source of truth
- Migration files: `sql/*.sql` with numeric prefix (`001_*.sql`, `002_*.sql`, ...)
- Applied journal in DB table: `SchemaMigrations`

## Apply migrations
```powershell
cd F:\FURLAB\dev\furlab-access
cscript //nologo scripts/access_apply_migrations.js "БД\Furlab 1.accdb" "sql"
```

Behavior:
- Creates `SchemaMigrations` if missing.
- Skips already applied files by `fileName`.
- Applies each file in transaction; writes journal record on success.
- Stops on first failed migration.
- Requires maintenance window (stop API task first).

## Baseline existing database
If schema already exists and journal table is empty, mark current files as applied without re-running DDL:

```powershell
cd F:\FURLAB\dev\furlab-access
cscript //nologo scripts/access_apply_migrations.js "БД\Furlab 1.accdb" "sql" baseline
```

## Notes
- Run in maintenance window (no active API writes).
- Prefer absolute DB path if shell encoding is unstable.
