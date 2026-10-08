# Research work revisions validation — 2026-10-08

This sanitized update synchronizes the existing owner/privacy/member-management and pagination changes required by the revision UI, and adds work grouping, historical revision navigation, manual grouping/detachment, explicit upload targeting and OAuth-protected own-work discovery. Production resource identifiers and original development history are not included.

Validation in this public checkout:

- npm test: production build and 53 tests passed (39 unit/source-contract tests, 14 integration tests).
- npx tsc --noEmit and npm run lint: passed.
- Revision integration covers private history isolation, cross-owner rejection, preserving review references, concurrent revision numbering, older-version ordering, detachment, deletion of an original record, upload-token consumption and migration integrity.
- Backup regression covers child-before-parent D1 export ordering and still rejects invalid foreign keys after import.

Production deployment uses the separate operational checkout. This public configuration keeps placeholder D1/KV IDs and opt-in production routes. Existing production manuscripts are not automatically grouped by title similarity. Actual ChatGPT file-upload behavior was not end-to-end tested in this checkout.
