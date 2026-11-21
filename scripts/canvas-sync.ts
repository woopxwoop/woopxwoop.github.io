// pnpm canvas:sync — snapshot your Canvas Planner status (see src/data/planner.ts)
// and your course history (src/data/canvas-courses.ts).
//
// Opens Edge (or Chrome), waits for you to sign in with NetID + Duo, then calls the
// same /api/v1/planner/items endpoint the Canvas dashboard uses, *from inside the
// signed-in page*. No token or cookie is ever extracted or stored by this script.
//
// .canvas-profile/ keeps the browser profile so Duo's "remember me" can skip
// re-prompting. It holds a live Canvas session: it's gitignored; delete it to sign out.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { PLANNER_FILE, plannerSchema, type PlannerItem } from '../src/data/planner.ts';
import { COURSES_FILE, coursesSchema, type CanvasCourse } from '../src/data/canvas-courses.ts';

const CANVAS = 'https://canvas.wisc.edu';
const PROFILE_DIR = path.resolve('.canvas-profile');
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const DAY = 86_400_000;
// Cover more than /week needs, so one sync stays useful for a while.
const RANGE = { start: new Date(Date.now() - 21 * DAY), end: new Date(Date.now() + 8 * 7 * DAY) };

async function launch(): Promise<BrowserContext> {
	for (const channel of ['msedge', 'chrome']) {
		try {
			return await chromium.launchPersistentContext(PROFILE_DIR, { channel, headless: false, viewport: null });
		} catch {}
	}
	throw new Error('Could not launch Microsoft Edge or Google Chrome.');
}

/** Raw planner items, all pages. Runs in the browser, so it uses the page's own session. */
function fetchPlannerInPage({ origin, start, end }: { origin: string; start: string; end: string }) {
	return (async () => {
		const items: unknown[] = [];
		let next: string | null = `${origin}/api/v1/planner/items?${new URLSearchParams({ start_date: start, end_date: end, per_page: '100' })}`;
		while (next) {
			const res: Response = await fetch(next, { headers: { Accept: 'application/json' } });
			if (!res.ok) throw new Error(`planner HTTP ${res.status}`);
			// Canvas may prefix session-authenticated JSON with "while(1);" (JSON-hijacking guard).
			items.push(...JSON.parse((await res.text()).replace(/^while\(1\);/, '')));
			next = res.headers.get('Link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
		}
		return items;
	})();
}

/** { assignmentId: submission_types } for the given courses. Also runs in the page. */
function fetchSubmissionTypesInPage({ origin, courseIds }: { origin: string; courseIds: string[] }) {
	return (async () => {
		const types: Record<string, string[]> = {};
		for (const course of courseIds) {
			let next: string | null = `${origin}/api/v1/courses/${course}/assignments?per_page=100`;
			while (next) {
				const res: Response = await fetch(next, { headers: { Accept: 'application/json' } });
				if (!res.ok) break; // e.g. a course you can see in the planner but not list; just no types
				const page = JSON.parse((await res.text()).replace(/^while\(1\);/, '')) as { id: number; submission_types: string[] }[];
				for (const a of page) types[String(a.id)] = a.submission_types;
				next = res.headers.get('Link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
			}
		}
		return types;
	})();
}

/**
 * Every course you're (or were) a student in. Asked for per enrollment state because
 * Canvas's default listing leaves out concluded courses. Also runs in the page.
 */
function fetchCoursesInPage({ origin }: { origin: string }) {
	return (async () => {
		const byId = new Map<number, unknown>();
		for (const state of ['active', 'completed']) {
			const params = new URLSearchParams({ enrollment_type: 'student', enrollment_state: state, per_page: '100' });
			params.append('include[]', 'term');
			let next: string | null = `${origin}/api/v1/courses?${params}`;
			while (next) {
				const res: Response = await fetch(next, { headers: { Accept: 'application/json' } });
				if (!res.ok) throw new Error(`courses HTTP ${res.status}`);
				for (const c of JSON.parse((await res.text()).replace(/^while\(1\);/, '')) as { id: number }[]) byId.set(c.id, c);
				next = res.headers.get('Link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
			}
		}
		return [...byId.values()];
	})();
}

type RawCourse = {
	id: number;
	course_code?: string;
	name?: string;
	access_restricted_by_date?: boolean; // concluded courses you can no longer open: only an id
	term?: { name?: string; start_at?: string | null } | null;
};

function toCourse(raw: RawCourse): CanvasCourse | null {
	if (raw.access_restricted_by_date || !raw.course_code || !raw.name) return null;
	return {
		id: String(raw.id),
		code: raw.course_code,
		name: raw.name,
		term: raw.term?.name ?? null,
		termStart: raw.term?.start_at ?? null,
	};
}

type RawItem = {
	course_id?: number | string;
	plannable_type: string;
	plannable_id: number | string;
	plannable?: { assignment_id?: number | string | null };
	submissions?: false | { submitted?: boolean; missing?: boolean; excused?: boolean; graded?: boolean };
	planner_override?: { marked_complete?: boolean } | null;
};

/** Quizzes/graded discussions have their own plannable id but belong to an assignment. */
function assignmentIdOf(raw: RawItem): string | null {
	const id = raw.plannable?.assignment_id ?? (raw.plannable_type === 'assignment' ? raw.plannable_id : null);
	return id != null ? String(id) : null;
}

/** Map to the ICS feed's UID scheme. */
function feedId(raw: RawItem): string | null {
	if (raw.plannable_type === 'calendar_event') return `event-calendar-event-${raw.plannable_id}`;
	const assignment = assignmentIdOf(raw);
	return assignment ? `event-assignment-${assignment}` : null; // planner notes, pages, ... aren't in the feed
}

function toItem(raw: RawItem, types: Record<string, string[]>): PlannerItem | null {
	const id = feedId(raw);
	if (!id) return null;
	const s = raw.submissions || {};
	const assignment = assignmentIdOf(raw);
	return {
		id,
		submissionTypes: (assignment && types[assignment]) || [],
		submitted: Boolean(s.submitted),
		missing: Boolean(s.missing),
		excused: Boolean(s.excused),
		graded: Boolean(s.graded),
		markedComplete: Boolean(raw.planner_override?.marked_complete),
	};
}

async function waitForSignIn(context: BrowserContext) {
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(CANVAS);
	console.log('Sign in to Canvas in the browser window (NetID + Duo), then leave it open. Waiting...');

	// Poll rather than waitForFunction: SSO bounces through several origins, and each
	// navigation would tear down a page-side wait.
	const deadline = Date.now() + LOGIN_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (new URL(page.url()).origin === CANVAS) {
			const signedIn = await page.evaluate(() => Boolean((window as any).ENV?.current_user_id)).catch(() => false);
			if (signedIn) return page;
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error('Timed out waiting for Canvas sign-in.');
}

const context = await launch();
let finished = false;
context.on('close', () => {
	if (!finished) console.error('\nThe browser window was closed before the sync finished — nothing was written. Run it again and leave the window open; it closes itself.');
});
try {
	const page = await waitForSignIn(context);
	console.log('Signed in. Fetching planner, assignments + courses — keep the window open, it closes itself when done...');
	const raw = (await page.evaluate(fetchPlannerInPage, {
		origin: CANVAS,
		start: RANGE.start.toISOString(),
		end: RANGE.end.toISOString(),
	})) as RawItem[];

	const courseIds = [...new Set(raw.filter(assignmentIdOf).map((r) => r.course_id).filter((c) => c != null).map(String))];
	const types = await page.evaluate(fetchSubmissionTypesInPage, { origin: CANVAS, courseIds });

	const items = raw.map((r) => toItem(r, types)).filter((i): i is PlannerItem => i !== null);
	const planner = plannerSchema.parse({
		syncedAt: new Date().toISOString(),
		range: { start: RANGE.start.toISOString(), end: RANGE.end.toISOString() },
		items,
	});

	await fs.mkdir(path.dirname(PLANNER_FILE), { recursive: true });
	await fs.writeFile(PLANNER_FILE, JSON.stringify(planner, null, '\t') + '\n');

	const count = (f: (i: PlannerItem) => boolean) => items.filter(f).length;
	console.log(
		`Synced ${items.length} items (${raw.length - items.length} skipped): ` +
			`${count((i) => i.submitted)} submitted, ${count((i) => i.markedComplete)} marked complete, ${count((i) => i.missing)} missing.`,
	);
	const byType: Record<string, number> = {};
	for (const i of items) for (const t of i.submissionTypes.length ? i.submissionTypes : ['(none listed)']) byType[t] = (byType[t] ?? 0) + 1;
	console.log('Submission types:', byType);
	console.log(`Wrote ${path.relative(process.cwd(), PLANNER_FILE)} — commit it so the deployed site sees it.`);

	const rawCourses = (await page.evaluate(fetchCoursesInPage, { origin: CANVAS })) as RawCourse[];
	const courses = coursesSchema.parse({
		syncedAt: new Date().toISOString(),
		courses: rawCourses.map(toCourse).filter((c): c is CanvasCourse => c !== null),
	});
	await fs.writeFile(COURSES_FILE, JSON.stringify(courses, null, '\t') + '\n');
	console.log(`Synced ${courses.courses.length} courses (${rawCourses.length - courses.courses.length} restricted/skipped).`);
	console.log(`Wrote ${path.relative(process.cwd(), COURSES_FILE)} — commit it too.`);
	finished = true;
} finally {
	await context.close();
}
