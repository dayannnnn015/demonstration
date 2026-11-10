/**
 * Plain calendar dates, handled as the strings they are.
 *
 * The API's dates are `YYYY-MM-DD` in the school's own Asia/Manila context,
 * not instants. Passing one through `new Date('2026-06-01')` and reading
 * `getDay()` applies the browser's offset and can land on the day before, so
 * nothing here converts a date to a local time: comparisons are string
 * comparisons, which sort correctly in this format, and the one place a
 * weekday is needed reads UTC parts of a UTC-pinned value.
 */

export const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Month = { y: number; m: number };

const two = (n: number) => String(n).padStart(2, '0');

/** One calendar date, built from its parts rather than from a timestamp. */
export const at = (y: number, m: number, d: number) => `${y}-${two(m)}-${two(d)}`;

export const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const weekday = (date: string) => weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

export const monthName = (month: Month) => `${months[month.m - 1]} ${month.y}`;

/** "12 October": a date within a month already named, as the forms write one. */
export const dayAndMonth = (date: string) => `${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1]}`;

/** A date held inside a range, both ends included. String order is date order here. */
export const clamp = (date: string, low: string, high: string) => (date < low ? low : date > high ? high : date);

export const monthOf = (date: string): Month => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) });

export const firstOf = (month: Month) => at(month.y, month.m, 1);
export const lastOf = (month: Month) => at(month.y, month.m, lastDay(month.y, month.m));

export const step = (month: Month, by: 1 | -1): Month =>
  by === 1
    ? (month.m === 12 ? { y: month.y + 1, m: 1 } : { y: month.y, m: month.m + 1 })
    : (month.m === 1 ? { y: month.y - 1, m: 12 } : { y: month.y, m: month.m - 1 });

/**
 * A date moved by whole days, pinned to UTC at both ends so it never touches
 * the browser's offset. `Date.setUTCDate` carries month and year boundaries,
 * including leap days, which is why this is arithmetic rather than string work.
 */
export const shift = (date: string, by: number) => {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + by);
  return base.toISOString().slice(0, 10);
};

/** How many dates an inclusive range covers. `2026-06-01`–`2026-06-01` is one. */
export const span = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
