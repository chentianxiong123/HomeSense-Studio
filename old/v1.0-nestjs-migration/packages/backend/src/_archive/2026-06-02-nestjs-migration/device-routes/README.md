# NestJS Migration Archive

Date: 2026-06-02

Archived files in this folder were replaced by NestJS modules during the backend migration.

Archived route replacements:
- `room-routes.ts` -> `src/nest/modules/room/*`
- `context-routes.ts` -> `src/nest/modules/context/*`

Why archived instead of deleted:
- preserve prior Fastify route behavior for reference
- allow parity checks during migration
- avoid losing historical implementation details while reducing active coupling
