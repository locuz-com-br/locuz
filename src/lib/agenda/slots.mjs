// locuz /agendar — bookable slots from working hours minus busy time.
// Runs server-side in the n8n Code node (paste without the `export`s) and in
// node:test here. No dependencies: ranges are { start, end } in epoch ms.
//
// Ported from Cal.com (MIT, Copyright (c) 2020-present Cal.com, Inc.) at
// calcom/cal.com@2eb48eccd8aca8a0c0ffabf28cf92e298b33ecee:
//   packages/features/schedules/lib/date-ranges.ts   processWorkingHours, subtract
//   packages/features/availability/lib/getAggregatedAvailability/
//     date-range-utils/mergeOverlappingDateRanges.ts mergeOverlappingDateRanges
//   packages/features/schedules/lib/slots.ts          buildSlotsWithDateRanges
// Changes: dayjs → epoch ms + Intl; one host; no travel schedules, date
// overrides, out-of-office, optimized slots or seats. See docs/cal-com-map.md.

const MINUTE = 60_000;

/** Offset of `timeZone` from UTC at instant `ms`, in minutes (São Paulo: -180). */
export function tzOffsetMinutes(timeZone, ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/** Wall-clock time in `timeZone` → epoch ms. Re-checks the offset once, so a DST edge lands right. */
export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let utc = guess - tzOffsetMinutes(timeZone, guess) * MINUTE;
  const second = guess - tzOffsetMinutes(timeZone, utc) * MINUTE;
  if (second !== utc) utc = second;
  return utc;
}

function localDate(ms, timeZone) {
  const local = new Date(ms + tzOffsetMinutes(timeZone, ms) * MINUTE);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

const hm = (s) => s.split(":").map(Number);

/**
 * Working hours → open ranges between `from` and `to` (Cal.com processWorkingHours).
 * window = { days: [1..7] (ISO, 1 = Monday), start: "09:00", end: "18:00" }.
 */
export function workingRanges({ from, to, timeZone, window }) {
  const [sh, sm] = hm(window.start);
  const [eh, em] = hm(window.end);
  const out = [];
  let { y, m, d } = localDate(from, timeZone);
  for (;;) {
    const dayStart = zonedToUtc(y, m, d, 0, 0, timeZone);
    if (dayStart >= to) break;
    const isoDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
    if (window.days.includes(isoDay)) {
      const start = Math.max(zonedToUtc(y, m, d, sh, sm, timeZone), from);
      const end = Math.min(zonedToUtc(y, m, d, eh, em, timeZone), to);
      if (end > start) out.push({ start, end });
    }
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate();
  }
  return out;
}

/** Cal.com mergeOverlappingDateRanges: overlapping or touching-inside ranges become one. */
export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  let current = sorted[0];
  if (!current) return [];
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (current.start <= next.start && current.end > next.start) {
      current = { start: current.start, end: Math.max(current.end, next.end) };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

/** Cal.com subtract: what is left of each source range after removing every excluded range. */
export function subtract(sourceRanges, excludedRanges) {
  const result = [];
  const excluded = [...excludedRanges].sort((a, b) => a.start - b.start);
  for (const { start: sourceStart, end: sourceEnd } of sourceRanges) {
    let currentStart = sourceStart;
    for (const ex of excluded) {
      if (ex.start >= sourceEnd) break;
      if (ex.end <= currentStart) continue;
      if (ex.start > currentStart) result.push({ start: currentStart, end: ex.start });
      if (ex.end > currentStart) currentStart = ex.end;
    }
    if (sourceEnd > currentStart) result.push({ start: currentStart, end: sourceEnd });
  }
  return result;
}

/**
 * Cal.com buildSlotsWithDateRanges, one host: every `frequency` minutes from the
 * first grid point at or after max(range start, now + notice), while a slot of
 * `eventLength` minutes still fits in the range. The grid is the largest of
 * 60/30/20/15/10/5 that divides `frequency`, on the hour in `timeZone`.
 * Change: the notice is rounded UP to the minute (Cal.com drops the seconds).
 */
export function buildSlots({ ranges, frequency, eventLength, minimumNoticeMinutes, now, timeZone }) {
  frequency = Math.max(1, frequency);
  eventLength = Math.max(1, eventLength);
  const interval = [60, 30, 20, 15, 10, 5].find((i) => frequency % i === 0) ?? 1;
  const earliest = Math.ceil((now + minimumNoticeMinutes * MINUTE) / MINUTE) * MINUTE;
  const slots = new Set();
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    let t = Math.ceil(Math.max(range.start, earliest) / MINUTE) * MINUTE;
    const localMinute = ((t / MINUTE + tzOffsetMinutes(timeZone, t)) % 60 + 60) % 60;
    if (localMinute % interval !== 0) t += (interval - (localMinute % interval)) * MINUTE;
    for (; t + eventLength * MINUTE <= range.end; t += frequency * MINUTE) slots.add(t);
  }
  return [...slots].sort((a, b) => a - b);
}

/**
 * The /agendar answer: working hours over the horizon, minus every busy range
 * (Google free/busy of each calendar in `busy_calendars` + agenda.busy()),
 * cut into slots. `settings` are the agenda.settings values.
 */
export function availableSlots({ now, settings, busy }) {
  const from = now;
  const to = now + settings.horizon_days * 24 * 60 * MINUTE;
  const open = workingRanges({ from, to, timeZone: settings.timezone, window: settings.window });
  const free = subtract(open, mergeRanges(busy));
  return buildSlots({
    ranges: free,
    frequency: settings.slot_step_minutes,
    eventLength: settings.meeting_minutes,
    minimumNoticeMinutes: settings.min_notice_hours * 60,
    now,
    timeZone: settings.timezone,
  });
}
