// Calendar-day helpers. Builds run on CI in UTC, but "today" and "this week"
// should mean Madison time, so everything goes through TIMEZONE.
//
// Days are plain "YYYY-MM-DD" strings: they compare/sort as strings and have no
// timezone to accidentally shift (unlike a Date at local midnight).

export const TIMEZONE = 'America/Chicago';
export const WEEK_STARTS_ON = 1; // 0 = Sunday, 1 = Monday

export type Day = string; // "YYYY-MM-DD"

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' });

/** The calendar day an instant falls on, in TIMEZONE. */
export const dayOf = (instant: Date): Day => dayFmt.format(instant); // en-CA formats as YYYY-MM-DD

/** "11:59 pm" in TIMEZONE. */
export const timeOf = (instant: Date) => timeFmt.format(instant).toLowerCase();

// Pure date arithmetic, done in UTC so DST never matters.
const toUtc = (day: Day) => new Date(`${day}T00:00:00Z`);
export const addDays = (day: Day, n: number): Day => new Date(toUtc(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const weekdayOf = (day: Day) => toUtc(day).getUTCDay(); // 0 = Sunday

export function weekOf(day: Day): Day[] {
	const start = addDays(day, -((weekdayOf(day) - WEEK_STARTS_ON + 7) % 7));
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** "mon 11/24" */
export const labelOf = (day: Day) => `${WEEKDAYS[weekdayOf(day)]} ${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export const shortWeekday = (day: Day) => WEEKDAYS[weekdayOf(day)];
