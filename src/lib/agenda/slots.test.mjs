// npm run test:agenda
// The three mergeRanges cases are ported from Cal.com (MIT) at 2eb48ec:
// packages/features/availability/lib/getAggregatedAvailability/date-range-utils/mergeOverlappingDateRanges.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableSlots, buildSlots, mergeRanges, subtract, tzOffsetMinutes, workingRanges, zonedToUtc,
} from "./slots.mjs";

const r = (start, end) => ({ start: Date.parse(start), end: Date.parse(end) });
const iso = (ms) => new Date(ms).toISOString();
const SP = "America/Sao_Paulo";

test("Cal.com: one range that includes all others merges into one", () => {
  const ranges = [
    r("2023-11-02T23:00:00Z", "2023-11-03T07:00:00Z"),
    r("2023-11-02T23:15:00Z", "2023-11-03T00:00:00Z"),
    r("2023-11-03T00:15:00Z", "2023-11-03T01:00:00Z"),
    r("2023-11-03T01:15:00Z", "2023-11-03T02:00:00Z"),
  ];
  assert.deepEqual(mergeRanges(ranges), [ranges[0]]);
});

test("Cal.com: only overlapping ranges over 2 days merge", () => {
  const ranges = [
    r("2023-11-02T23:00:00Z", "2023-11-03T07:00:00Z"),
    r("2023-11-03T05:00:00Z", "2023-11-03T06:00:00Z"),
    r("2023-11-03T08:00:00Z", "2023-11-03T10:00:00Z"),
  ];
  assert.deepEqual(mergeRanges(ranges), [ranges[0], ranges[2]]);
});

test("Cal.com: ranges overlapping on the same day merge", () => {
  const ranges = [
    r("2023-11-02T01:00:00Z", "2023-11-02T04:00:00Z"),
    r("2023-11-02T02:00:00Z", "2023-11-02T03:00:00Z"),
    r("2023-11-02T05:00:00Z", "2023-11-02T06:00:00Z"),
  ];
  assert.deepEqual(mergeRanges(ranges), [ranges[0], ranges[2]]);
});

test("busy from two calendars that overlap merge, and the input is not mutated", () => {
  const locuz = r("2026-11-10T13:00:00Z", "2026-11-10T13:30:00Z");
  const psiativa = r("2026-11-10T13:20:00Z", "2026-11-10T14:00:00Z");
  const input = [psiativa, locuz];
  assert.deepEqual(mergeRanges(input), [r("2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z")]);
  assert.equal(input[0], psiativa);
});

test("subtract cuts holes, drops covered ranges and keeps untouched ones", () => {
  const open = [r("2026-11-10T12:00:00Z", "2026-11-10T21:00:00Z"), r("2026-11-11T12:00:00Z", "2026-11-11T21:00:00Z")];
  const busy = [r("2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z"), r("2026-11-10T20:00:00Z", "2026-11-10T22:00:00Z")];
  assert.deepEqual(subtract(open, busy), [
    r("2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z"),
    r("2026-11-10T14:00:00Z", "2026-11-10T20:00:00Z"),
    open[1],
  ]);
  assert.deepEqual(subtract([open[0]], [r("2026-11-10T11:00:00Z", "2026-11-10T22:00:00Z")]), []);
});

test("São Paulo is UTC-3 and a wall-clock time converts both ways", () => {
  assert.equal(tzOffsetMinutes(SP, Date.parse("2026-11-10T12:00:00Z")), -180);
  assert.equal(iso(zonedToUtc(2026, 11, 10, 9, 0, SP)), "2026-11-10T12:00:00.000Z");
});

test("a DST zone keeps local wall-clock hours across the change", () => {
  // New York leaves DST on 2026-11-01: 09:00 local is 13:00Z before, 14:00Z after.
  const ranges = workingRanges({
    from: Date.parse("2026-10-30T00:00:00Z"), to: Date.parse("2026-11-03T00:00:00Z"),
    timeZone: "America/New_York", window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "10:00" },
  });
  assert.deepEqual(ranges.map((x) => iso(x.start)), ["2026-10-30T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
});

test("working hours skip the weekend and clip to from/to", () => {
  // Fri 2026-11-13 10:30 local → Mon 2026-11-16 12:00 local
  const ranges = workingRanges({
    from: zonedToUtc(2026, 11, 13, 10, 30, SP), to: zonedToUtc(2026, 11, 16, 12, 0, SP),
    timeZone: SP, window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
  });
  assert.deepEqual(ranges.map((x) => [iso(x.start), iso(x.end)]), [
    ["2026-11-13T13:30:00.000Z", "2026-11-13T21:00:00.000Z"],
    ["2026-11-16T12:00:00.000Z", "2026-11-16T15:00:00.000Z"],
  ]);
});

test("slots: 15-min call every 30 min, aligned to the half hour, the last one must fit", () => {
  const slots = buildSlots({
    ranges: [r("2026-11-10T13:05:00Z", "2026-11-10T14:45:00Z")],
    frequency: 30, eventLength: 15, minimumNoticeMinutes: 0, now: 0, timeZone: SP,
  });
  assert.deepEqual(slots.map(iso), ["2026-11-10T13:30:00.000Z", "2026-11-10T14:00:00.000Z", "2026-11-10T14:30:00.000Z"]);
});

test("slots respect the minimum notice, rounded up to the minute", () => {
  const now = Date.parse("2026-11-10T12:00:30Z");
  const slots = buildSlots({
    ranges: [r("2026-11-10T12:00:00Z", "2026-11-10T15:00:00Z")],
    frequency: 30, eventLength: 15, minimumNoticeMinutes: 120, now, timeZone: SP,
  });
  assert.deepEqual(slots.map(iso), ["2026-11-10T14:30:00.000Z"]);
});

test("availableSlots: a meeting on the PsiAtiva calendar removes the locuz slot", () => {
  const settings = {
    timezone: SP, window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "11:00" },
    horizon_days: 1, slot_step_minutes: 30, meeting_minutes: 15, min_notice_hours: 0,
  };
  const now = zonedToUtc(2026, 11, 10, 8, 0, SP);
  const all = availableSlots({ now, settings, busy: [] });
  assert.deepEqual(all.map(iso), ["2026-11-10T12:00:00.000Z", "2026-11-10T12:30:00.000Z",
    "2026-11-10T13:00:00.000Z", "2026-11-10T13:30:00.000Z"]);
  const psiativaMeeting = r("2026-11-10T12:10:00Z", "2026-11-10T12:40:00Z");
  const some = availableSlots({ now, settings, busy: [psiativaMeeting] });
  assert.deepEqual(some.map(iso), ["2026-11-10T13:00:00.000Z", "2026-11-10T13:30:00.000Z"]);
});

test("a wall-clock time just after a spring-forward gap converts right", () => {
  // New York jumps 02:00 → 03:00 on 2026-03-08 (07:00Z). A one-pass offset guess lands on 04:00.
  assert.equal(iso(zonedToUtc(2026, 3, 8, 3, 0, "America/New_York")), "2026-03-08T07:00:00.000Z");
});
