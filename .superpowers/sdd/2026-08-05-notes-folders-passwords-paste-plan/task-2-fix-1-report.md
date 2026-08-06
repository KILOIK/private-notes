# Task 2 Fix Round 1 Report

## Status

DONE

## Fixed contract mismatches

- Limited password field types to `text`, `secret`, and `multiline`; normalized fixed `url` as `text`.
- Changed fixed labels to `名称`, `用户名`, `密码`, `网址`, and `备注`.
- Removed `title` from password record encoding and decoding.
- Rejected parsed structured objects with missing or unsupported versions.
- Froze legacy Markdown decode results.
- Removed HTML tags before snippet construction.
- Switched snippet length and truncation to Unicode code points so surrogate pairs are not split.

## TDD evidence

- Updated contract tests first.
- Red run: 5 of 6 focused codec tests failed against the prior implementation for legacy immutability, fixed schema/defaults, forbidden `url` type, duplicate password title, and HTML stripping.
- Green run: all 6 focused codec tests passed after the minimal implementation changes.

## Verification

- `npx vitest run --config vitest.codec.config.mts test/note-records.spec.ts` — 6 passed.
- `npm run typecheck:client` — passed.
- `git diff --check` — passed.

## Concerns

- The repository-wide Vitest config starts the Cloudflare worker pool, which cannot bind `127.0.0.1` or write Wrangler logs in this restricted sandbox. The focused codec suite was therefore run with a temporary minimal Vitest config and no setup/plugin changes.
