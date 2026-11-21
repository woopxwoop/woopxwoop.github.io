// Combines Canvas + Renshuu into the weekly list on the home page (components/WeekList.astro).
import type { Canvas, CanvasEvent } from './canvas';
import type { Planner, PlannerItem } from './planner';
import { heatmapByDay, type HeatValue, type RenshuuHeatmap } from './renshuu';
import { addDays, clockOf, dateOf, dayOf, shortWeekday, timeOf, weekOf, type Day } from './time';

export const STUDY_GOAL = 5; // days per week
const LOOKAHEAD_DAYS = 7; // show assignments due up to a week from today

export interface Task {
	id: string;
	title: string;
	course: string | null;
	url: string | null;
	day: Day;
	dayLabel: string; // "11/24"
	isToday: boolean;
	time: string | null; // "7:00 pm"; null only if unknown
	past: boolean; // due time already passed at build time
	status: TaskStatus;
}

/**
 * done     – submitted, graded, excused, or ticked in the Canvas planner
 * missing  – Canvas flags it missing
 * overdue  – past due and Canvas *would* know if you'd turned it in, but you haven't
 * external – past due and turned in somewhere Canvas can't see, so: unknown
 * todo     – not due yet
 * unsynced – no status: never synced, or the assignment appeared after the last sync
 */
export type TaskStatus = 'done' | 'missing' | 'overdue' | 'external' | 'todo' | 'unsynced';

/**
 * Courses whose external tool syncs *submissions* back to Canvas (learned from the sync:
 * any of the course's tool assignments came back submitted). For those, "past due and no
 * submission" really means overdue; for other tools (WeBWorK-style grade-only, or none)
 * it just means Canvas can't see it.
 */
function coursesWithSubmittingTools(events: CanvasEvent[], synced: Map<string, PlannerItem>) {
	const courses = new Set<string>();
	for (const e of events) {
		const item = synced.get(e.id);
		if (e.course && item?.submitted && item.submissionTypes.includes('external_tool')) courses.add(e.course);
	}
	return courses;
}

/** Would Canvas have a submission record if this were turned in? */
function canvasSeesSubmissions(item: PlannerItem, course: string | null, submittingTools: Set<string>): boolean {
	const types = item.submissionTypes;
	if (types.length === 0) return true; // unknown type: assume a normal Canvas assignment
	if (types.some((t) => !['none', 'on_paper', 'not_graded', 'external_tool'].includes(t))) return true; // uploads, quizzes, ...
	return types.includes('external_tool') && course !== null && submittingTools.has(course);
}

function statusOf(event: CanvasEvent, item: PlannerItem | undefined, past: boolean, submittingTools: Set<string>): TaskStatus {
	if (event.kind === 'event') return past ? 'done' : 'todo'; // lectures/exams: nothing to submit, just over or not
	if (!item) return 'unsynced';
	// A grade means it was handled however it was turned in: paper graded into Gradescope,
	// WeBWorK passing back a score, a TA entering it by hand, ...
	if (item.submitted || item.graded || item.excused || item.markedComplete) return 'done';
	if (item.missing) return 'missing';
	if (!past) return 'todo';
	return canvasSeesSubmissions(item, event.course, submittingTools) ? 'overdue' : 'external';
}

export interface Week {
	today: Day;
	syncedAt: string | null; // last `pnpm canvas:sync`
	tasks: Task[]; // unfinished first, then by due date
	study: { days: { day: Day; label: string; isToday: boolean; future: boolean; practiced: boolean }[]; count: number; goal: number };
}

/**
 * Does a Renshuu heatmap value count as "practiced that day"?
 * Number = % of that day's scheduled reviews done; undefined = no data for that day.
 */
function countsAsPracticed(value: HeatValue | undefined): boolean {
	return typeof value === 'number' && value > 0;
}

export function buildWeek(canvas: Canvas, heatmap: RenshuuHeatmap, planner: Planner | null, now = new Date()): Week {
	const today = dayOf(now);
	const week = weekOf(today);
	const last = addDays(today, LOOKAHEAD_DAYS);
	const synced = new Map(planner?.items.map((i) => [i.id, i]));
	const submittingTools = coursesWithSubmittingTools(canvas.events, synced);

	// From the start of this week (so finished items stay visible) to a week out.
	const tasks: (Task & { sortKey: string })[] = [];
	for (const e of canvas.events) {
		const instant = e.allDay ? null : new Date(e.due);
		const day = instant ? dayOf(instant) : e.due;
		if (day < week[0] || day > last) continue;
		const past = instant ? instant < now : day < today;
		tasks.push({
			id: e.id,
			title: e.title,
			course: e.course,
			url: e.url,
			day,
			dayLabel: dateOf(day),
			isToday: day === today,
			// Canvas exports assignments due at 11:59 pm as all-day events (date only, no time).
			// "past" for those is day < today, i.e. after 11:59 pm, so it already agrees.
			time: instant ? timeOf(instant) : e.kind === 'assignment' ? '11:59 pm' : null,
			past,
			status: statusOf(e, synced.get(e.id), past, submittingTools),
			sortKey: `${day} ${instant ? clockOf(instant) : '23:59'}`, // local day + 24h clock: sorts as a string
		});
	}
	// Unfinished first (anything not "done", including unknown), then by due date within each group.
	const unfinished = (t: Task) => (t.status === 'done' ? 1 : 0);
	tasks.sort((a, b) => unfinished(a) - unfinished(b) || a.sortKey.localeCompare(b.sortKey));

	const heat = heatmapByDay(heatmap);
	const days = week.map((day) => ({
		day,
		label: shortWeekday(day),
		isToday: day === today,
		future: day > today,
		practiced: countsAsPracticed(heat[day]),
	}));

	return { today, syncedAt: planner?.syncedAt ?? null, tasks: tasks.map(({ sortKey, ...t }) => t), study: { days, count: days.filter((d) => d.practiced).length, goal: STUDY_GOAL } };
}
