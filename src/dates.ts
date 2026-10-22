/**
 * Calendar dates without a time or a time zone, as YYYY-MM-DD text.
 *
 * Nothing here uses JavaScript's Date, so there's no UTC shift (new
 * Date("2026-03-01") is midnight UTC, which is still February in Phoenix)
 * and no lenient parsing ("2026-02-30" is not quietly March 2). Days are
 * counted with the proleptic Gregorian calendar, years 1 to 9999.
 * localToday() is the one place a Date is read: the local calendar day.
 */

export interface CivilDate {
  y: number;
  /** 1 to 12. */
  m: number;
  /** 1 to the month's length. */
  d: number;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** A real calendar date from YYYY-MM-DD text, or null for anything else (2026-02-30, 2026-2-3, numbers). */
export function parseDate(v: unknown): CivilDate | null {
  if (typeof v !== "string") return null;
  const m = ISO.exec(v);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

export function formatDate(c: CivilDate): string {
  return `${pad(c.y, 4)}-${pad(c.m, 2)}-${pad(c.d, 2)}`;
}

/** Days since 1970-01-01 (negative before). Howard Hinnant's days_from_civil. */
export function toDays(c: CivilDate): number {
  const y = c.m <= 2 ? c.y - 1 : c.y;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (c.m + (c.m > 2 ? -3 : 9)) + 2) / 5) + c.d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date a day count stands for: the inverse of toDays. */
export function fromDays(n: number): CivilDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** 0 for Sunday through 6 for Saturday. 1970-01-01 was a Thursday. */
export const weekday = (c: CivilDate) => (((toDays(c) + 4) % 7) + 7) % 7;

export const addDays = (c: CivilDate, n: number) => fromDays(toDays(c) + n);

/** The same day n months on, or the month's last day when it's shorter (Jan 31 + 1 month = Feb 28). */
export function addMonths(c: CivilDate, n: number): CivilDate {
  const idx = c.y * 12 + (c.m - 1) + n;
  const y = Math.floor(idx / 12), m = (idx % 12) + 1;
  return { y, m, d: Math.min(c.d, daysInMonth(y, m)) };
}

export const compareDates = (a: CivilDate, b: CivilDate) => toDays(a) - toDays(b);

/** The earliest and latest dates the calendar can reach. */
export const FIRST_DATE: CivilDate = { y: 1, m: 1, d: 1 };
export const LAST_DATE: CivilDate = { y: 9999, m: 12, d: 31 };

/** Keep a date within inclusive bounds. */
export function clampDate(c: CivilDate, min: CivilDate | null, max: CivilDate | null): CivilDate {
  if (min && compareDates(c, min) < 0) return min;
  if (max && compareDates(c, max) > 0) return max;
  return c;
}

/** Names in US English: the only locale so far. Weeks start on Sunday. */
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Tue, Mar 3, 2026 */
export function displayDate(c: CivilDate): string {
  return `${WEEKDAYS[weekday(c)]!.slice(0, 3)}, ${MONTHS[c.m - 1]!.slice(0, 3)} ${c.d}, ${c.y}`;
}

/** The calendar day on this device's clock, read as local year, month and day (never UTC). */
export function localToday(): string {
  const now = new Date();
  return formatDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}
