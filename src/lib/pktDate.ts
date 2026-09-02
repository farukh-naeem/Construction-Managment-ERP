/**
 * Pakistan (Asia/Karachi, UTC+5, no DST) date helpers.
 *
 * Date-picker defaults across the app used `new Date().toISOString().slice(0, 10)`,
 * which is the UTC date — ~5 hours behind Pakistan time. Between midnight and 5am PKT
 * that silently defaults fields to yesterday's date. Use `todayPKT()` instead wherever
 * a form needs "today" as its default.
 */

const PKT_TIME_ZONE = "Asia/Karachi";

/** "YYYY-MM-DD" for the given instant (defaults to now) in Pakistan local time. */
export function todayPKT(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PKT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Format a stored ISO/`YYYY-MM-DD` date for display without timezone conversion. */
export function formatDisplayDate(value?: string | null, fallback = "—"): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  // Preserve unexpected legacy values rather than displaying an invalid date or shifting days.
  return raw;
}

/** Format a date-time whose date portion is ISO-like, retaining its existing local time text. */
export function formatDisplayDateTime(value?: string | null, fallback = "—"): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}${match[4]}` : raw;
}

export function formatDisplayDateRange(
  start?: string | null,
  end?: string | null,
  separator = " to "
): string {
  if (!start && !end) return "—";
  if (start && end && start === end) return formatDisplayDate(start);
  return `${formatDisplayDate(start)}${separator}${formatDisplayDate(end)}`;
}
