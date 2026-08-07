# Task 7 Report: Mobile image paste and draft attachments

Date: 2026-08-07

## Status

Implemented direct mobile/body image paste for new and existing notes, in-memory draft preview metadata, encrypted draft uploads, draft cleanup, and atomic note creation plus attachment association.

## Required documentation review

Before modifying Worker, R2, or D1 behavior, retrieved the current official documentation pages required by `AGENTS.md`:

- `https://developers.cloudflare.com/workers/`
- `https://developers.cloudflare.com/r2/`
- `https://developers.cloudflare.com/r2/platform/limits/`
- `https://developers.cloudflare.com/workers/platform/limits/`
- `https://developers.cloudflare.com/d1/worker-api/d1-database/`

The implementation keeps the existing `private-notes-r2` binding, preserves the application-level 10 MiB encrypted upload limit and supported JPEG/PNG/GIF/WebP MIME allowlist, and uses D1 `batch()` for note insertion plus attachment state transition.

## Implementation summary

- Added ordered multi-image clipboard extraction while preserving the single-image compatibility wrapper and drop behavior.
- Added `attachment-draft.js` with draft creation, pending Blob/object URL tracking, exact token replacement, and complete URL revocation.
- Added editor-only `pending://` Markdown preview resolution; reader rendering still accepts only persisted `attachment://` IDs.
- Added paste listeners to both the editor modal and the body textarea, preserving text-only paste fallback and preventing default only when supported images are present.
- New notes receive a client UUID on first image; encrypted uploads use `x-note-draft: 1` until the note exists.
- Save waits for every upload, replaces pending tokens before content encryption, sends the explicit note ID and referenced attachment IDs, and preserves existing-note attachment references.
- Cancel, logout, idle lock, and reauth lock revoke object URLs and delete uploaded pending rows. A reauth-required session may delete only its own vault's `pending` attachment rows; attached rows and all ordinary APIs remain reauth-protected.
- Worker draft uploads require the exact draft header when the note does not exist. POST note creation validates pending IDs for the same note/vault and performs insert plus `pending` to `attached` transition in one D1 batch.

## TDD evidence

### Initial RED

Command:

```text
npx vitest run test/attachment-crypto.spec.ts test/attachment-draft.spec.ts test/index.spec.ts -t "paste|draft|pending attachment"
```

Result: exit 1. Expected feature-missing failures:

- `attachment-draft.js` did not exist.
- `extractPastedImages` was not a function.
- draft uploads against non-existent note IDs returned 404 instead of 201.
- 5 failed tests; 36 skipped.

### Initial GREEN

Same command after the minimal helper and Worker implementation:

```text
Test Files  3 passed (3)
Tests       8 passed | 36 skipped (44)
```

### Reauth cleanup RED/GREEN

Command:

```text
npx vitest run test/index.spec.ts -t "reauth-required sessions to clean up only their pending draft attachment"
```

RED result: exit 1; pending cleanup returned 401 instead of 200.

GREEN result after adding the pending-only cleanup path:

```text
Test Files  1 passed (1)
Tests       1 passed | 36 skipped (37)
```

The test also verifies that an attached attachment remains attached and returns 404 through this restricted cleanup path, while `/api/notes` continues to return `reauth_required`.

## Verification commands and outputs

Required focused RED/GREEN selector:

```text
npx vitest run test/attachment-crypto.spec.ts test/attachment-draft.spec.ts test/index.spec.ts -t "paste|draft|pending attachment"
Test Files  3 passed (3)
Tests       9 passed | 36 skipped (45)
```

Required attachment/share regression selector:

```text
npx vitest run test/attachment-crypto.spec.ts test/attachment-draft.spec.ts test/index.spec.ts -t "attachment|paste|draft|share"
Test Files  3 passed (3)
Tests       17 passed | 28 skipped (45)
```

Full regression suite:

```text
npm run test:ci
Test Files  10 passed (10)
Tests       82 passed (82)
```

Worker type check:

```text
npm run typecheck
exit 0
```

Client type check:

```text
npm run typecheck:client
exit 0
```

Diff whitespace validation:

```text
git diff --check
exit 0
```

An exploratory `npm run typecheck:test` still reports the pre-existing DOM-lib errors in `test/password-fields.spec.ts` and `test/password-ui.spec.ts`; the new attachment tests add no remaining type error. The required Worker and client type checks pass.

## Self-review

- Confirmed all supported image MIME types remain JPEG, PNG, GIF, and WebP only.
- Confirmed the 10 MiB browser and Worker checks are unchanged.
- Confirmed the R2 bucket binding remains `private-notes-r2` and no binding changes require `wrangler types`.
- Confirmed normal uploads still require an existing note; only the exact `x-note-draft: 1` path permits a missing note.
- Confirmed pending ID validation includes vault, note ID, pending status, UUID normalization, and duplicate rejection.
- Confirmed note insert and attachment transition share one D1 batch and conflict leaves pending rows unchanged.
- Confirmed cross-vault association is denied.
- Confirmed reauth cleanup cannot detach attached rows and does not bypass the 30-minute reauth gate for note APIs.
- Confirmed object URLs are revoked once and cancellation waits for in-flight uploads before deleting any resulting pending rows.
- Confirmed PBKDF2, AES-GCM, `enc:v1`, vault isolation, Authenticator behavior, and idle reauth code were not altered.
- Confirmed `.superpowers/brainstorm/` is not part of the change set.

## Concerns

- Vitest emits the existing Node `punycode` deprecation warning; it does not fail tests.
- The unrelated test TypeScript configuration still lacks DOM typings for older password UI tests, as noted above.
