# ERIS Backend conventions

## Module structure

Use `src/modules/departments` as the reference for new modules and module refactors.
The module root contains these six files (plus `.gitkeep`):

- `<module>.routes.js`: register paths, HTTP methods, authentication and controllers.
- `<module>.controller.js`: parse/validate HTTP input, call services, serialize responses, forward errors to `next`.
- `<module>.service.js`: authorization, business rules, lifecycle and transaction orchestration through repositories.
- `<module>.repository.js`: SQL, database locking, transaction clients, persistence and audit writes.
- `<module>.validation.js`: input validation and normalization; no database access.
- `<module>.swagger.js`: API contracts and schemas.

Construct repository → service → controller → router in `src/app.js`. Keep one active router per module; remove obsolete parallel implementations when replacing them. Never put SQL in controllers, routes or services.

Use `data/` only for genuinely code-owned static data and `helpers/` for pure calculations/formatting when needed. Database-owned catalogs must be read exclusively from the database at runtime; never add a source-code fallback that silently replaces missing database rows. Keep reviewed, manually executed catalog seed and SQL maintenance files under `scripts/sql/`; do not execute them as part of module loading. Do not create migrations, change schema or seed business data without the user's request or approval.

Keep endpoint paths, response shapes, authorization, transaction boundaries and audit behavior stable during structural refactors. Add relevant tests. Run database-writing tests only when authorized; prefer mocked tests and read-only regression checks otherwise. Preserve unrelated local changes and deletions.
