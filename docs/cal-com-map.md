# Cal.com → locuz `/agendar`: what we copy

Sprint 1 F1 (plan: `ai-synthesizer/workspace/locuz/plans/sprint-1-contact-page-project-requests.md`, D1-c).

**Source:** `calcom/cal.com@2eb48eccd8aca8a0c0ffabf28cf92e298b33ecee` (2026-11-04), sparse checkout at `~/GitHub-Projects/cal.com-ref` (read-only, never run).
**Licence:** **MIT** (root `LICENSE`; the only other LICENSE files are in `apps/api/v2/src/platform`, `app-store/{hitpay,stripepayment}`, `embeds/*`, none of which we touch; no `ee/` folder). Every copied file gets a header naming the source path + commit, and `THIRD_PARTY_NOTICES.md` carries the MIT text + "Copyright (c) 2020-present Cal.com, Inc.".

## Where the code runs

The site is static Astro on cPanel FTP; there is no server here. The booking logic runs **server-side in n8n** (as PsiAtiva's S11 does), and the page only renders the slots and posts the choice. So "copy" means **port to plain JS**: Cal.com is TypeScript on `dayjs` + Prisma; n8n Code nodes have **Luxon**, not dayjs, and no Prisma. Expect adaptation, not drop-in files.

## Feature map

| # | We need | Cal.com file (lines) | Verdict |
|---|---|---|---|
| 1 | Weekly hours → open ranges per day, in `America/Sao_Paulo` | `packages/features/schedules/lib/date-ranges.ts` → `processWorkingHours`, `buildDateRanges` (472) | **Port** the working-hours part only; drop travel schedules, date overrides, OOO |
| 2 | Open ranges − busy (both `contato@` calendars) | same file → `subtract`, `mergeOverlappingRanges` (~50) | **Port**: this is the cross-brand guard's core |
| 3 | Merge busy from 2 calendars | `availability/.../mergeOverlappingDateRanges.ts` (36) | **Port** (tiny; or reuse #2's `mergeOverlappingRanges`) |
| 4 | Ranges → bookable slots (15 min length, 30 min step, min notice) | `packages/features/schedules/lib/slots.ts` → `buildSlotsWithDateRanges` (264) | **Port** core loop; drop `showOptimizedSlots`, OOO, multi-user `userIds`, Sentry wrapper |
| 5 | Horizon (10 days) / out-of-bounds check at booking time | `bookings/lib/handleNewBooking/validateBookingTimeIsNotOutOfBounds.ts` (63) + `@calcom/lib/isOutOfBounds` | **Rewrite**: 5 lines of our own; theirs is generic over period types |
| 6 | Booking limits (per day/week) | `packages/lib/intervalLimits/*` (`limitManager.ts` 111, `utils.ts` 74) | **Skip v1**: S11's per-IP limit + one-upcoming-per-phone is enough for a 15-min call |
| 7 | Private link per lead (expiry, single use) | `packages/lib/hashedLinksUtils.ts` → `isTimeBasedExpired`, `isUsageBasedExpired`, `isLinkExpired` (145) | **Port the rules only**; storage = our own `db_locuz` table (sha256 token, `expires_at`, `used_at`), same shape as S11's `booking_links` |
| 8 | Race safety (two people, one slot) | Cal.com re-checks in app code: `handleNewBooking/ensureAvailableUsers.ts` → `checkForConflicts` (a DB-level constraint was not checked) | **Keep ours**: S11's `EXCLUDE USING gist` overlap lock in `db_locuz` + Google free/busy re-check right before insert |

Not copied: Prisma models, tRPC routers (`viewer/slots/*`), seats, round-robin/teams, reschedule/cancel (v2), embeds, payments.

## Size estimate

~300 lines of ported JS (items 1–4, 7) + our own ~100 (5, glue), split across n8n Code nodes or one shared module the n8n Code node loads. Tests: Cal.com's own `*.test.ts` for `mergeOverlappingDateRanges`/`filterRedundantDateRanges` are MIT too; port their cases as fixtures.

## Where it lives (owner, 2026-11-08)

`src/lib/agenda/slots.mjs` (no dependencies; ranges in epoch ms; timezones via `Intl`) + `slots.test.mjs` (`npm run test:agenda`, 12 tests, 7/7 mutants red). For n8n, paste the module body into the Code node without the `export`s. The private-link rules (#7) live in SQL (`db/migrations/0001_agenda.sql`), not in JS.
