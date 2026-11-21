// Canvas: the calendar feed URL (Canvas → Calendar → "Calendar Feed") in CANVAS_FEED_URL.
// The URL itself is the credential (anyone with it can read your calendar), so
// treat it like an API key: .env locally, repo secret in CI. Never commit it.
import { z } from 'astro/zod';
import { defineSource, fetchText } from './source';

const event = z.object({
	id: z.string(), // iCal UID, stable across builds ("event-assignment-3080261")
	title: z.string(), // "A2"
	course: z.string().nullable(), // "ECE 353"
	due: z.string(), // ISO instant, or "YYYY-MM-DD" when allDay
	allDay: z.boolean(),
	kind: z.enum(['assignment', 'event']),
	url: z.string().nullable(), // needs a Canvas login to open
});

const schema = z.object({ events: z.array(event) });

export type CanvasEvent = z.infer<typeof event>;
export type Canvas = z.infer<typeof schema>;

/** Minimal iCalendar (RFC 5545) reader: enough for Canvas feeds, no dependency. */
function parseIcs(ics: string): Record<string, { params: string; value: string }>[] {
	// Long lines are "folded": CRLF + one space/tab continues the previous line.
	const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
	const events: Record<string, { params: string; value: string }>[] = [];
	let current: (typeof events)[number] | null = null;

	for (const line of lines) {
		if (line === 'BEGIN:VEVENT') current = {};
		else if (line === 'END:VEVENT') {
			if (current) events.push(current);
			current = null;
		} else if (current) {
			// NAME;PARAM=x;PARAM=y:value  (value may itself contain ':')
			const colon = line.indexOf(':');
			if (colon < 0) continue;
			const [name, ...params] = line.slice(0, colon).split(';');
			const value = line
				.slice(colon + 1)
				.replace(/\\n/gi, '\n')
				.replace(/\\([,;\\])/g, '$1');
			current[name.toUpperCase()] = { params: params.join(';'), value };
		}
	}
	return events;
}

/** DTSTART → { due, allDay }. Canvas emits UTC instants or bare dates. */
function parseDate({ params, value }: { params: string; value: string }) {
	if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(value)) {
		return { due: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, allDay: true };
	}
	const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	// Floating / TZID times would need a timezone table; fail loudly rather than guess.
	if (!m) throw new Error(`unsupported DTSTART: ${params} ${value}`);
	const [, y, mo, d, h, mi, s] = m;
	return { due: `${y}-${mo}-${d}T${h}:${mi}:${s}Z`, allDay: false };
}

/**
 * "A2 [FA26 ECE 353 001]" → { title: "A2", course: "ECE 353" }
 * Term and section are optional ("[FA26 ECE 203]"); plain calendar events have no brackets.
 */
function splitSummary(summary: string) {
	const m = summary.match(/^(.*?)\s*\[(?:[A-Z]{2}\d{2}\s+)?([A-Z][A-Z ]*\d{3}[A-Z]?)(?:\s+\d{3})?\]$/);
	return m ? { title: cleanTitle(m[1]), course: m[2] } : { title: cleanTitle(summary), course: null };
}

/** "🔥 Lab Activity 6  " → "Lab Activity 6". Drops emoji (incl. variation selectors / ZWJ sequences). */
function cleanTitle(title: string) {
	return title
		.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The feed links to the calendar view:
 *   https://canvas.wisc.edu/calendar?include_contexts=course_516350&...#assignment_3080261
 * For assignments, link straight to the assignment page instead:
 *   https://canvas.wisc.edu/courses/516350/assignments/3080261
 */
function linkOf(raw: string | undefined): string | null {
	if (!raw) return null;
	try {
		const u = new URL(raw);
		const course = u.searchParams.get('include_contexts')?.match(/^course_(\d+)$/)?.[1];
		const assignment = u.hash.match(/^#assignment_(\d+)$/)?.[1];
		return course && assignment ? `${u.origin}/courses/${course}/assignments/${assignment}` : raw;
	} catch {
		return null;
	}
}

/**
 * Stable id, matching the planner sync's ids (src/data/planner.ts).
 * Section-specific due dates come through as "event-assignment-override-616754";
 * the URL's #assignment_3112938 still names the real assignment, so prefer that.
 */
function idOf(uid: string, rawUrl: string | undefined): string {
	const assignment = rawUrl?.match(/#assignment_(\d+)$/)?.[1];
	return uid.startsWith('event-assignment-') && assignment ? `event-assignment-${assignment}` : uid;
}

export const getCanvas = defineSource('canvas', schema, async () => {
	const url = import.meta.env.CANVAS_FEED_URL ?? process.env.CANVAS_FEED_URL;
	if (!url) throw new Error('CANVAS_FEED_URL is not set');

	const events = parseIcs(await fetchText(url))
		.filter((e) => e.UID && e.DTSTART && e.SUMMARY)
		.map((e) => ({
			id: idOf(e.UID.value, e.URL?.value),
			...splitSummary(e.SUMMARY.value),
			...parseDate(e.DTSTART),
			kind: e.UID?.value.startsWith('event-assignment-') ? ('assignment' as const) : ('event' as const),
			url: linkOf(e.URL?.value),
		}))
		.sort((a, b) => a.due.localeCompare(b.due));

	return { events };
});
