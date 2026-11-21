// The /courses page: every Canvas course I've taken, grouped by term, newest first.
// Source: snapshots/canvas-courses.json from `pnpm canvas:sync` (src/data/canvas-courses.ts).
// The live Canvas feed marks which term is in progress right now.
import type { Canvas } from './canvas';
import type { CanvasCourse, CanvasCourses } from './canvas-courses';

export interface Course {
	code: string; // "COMPSCI 537"
	name: string; // "Introduction to Operating Systems"
	// "002", only when the term has two courses with the same code (topics courses like
	// COMPSCI 639, where each section is a different class).
	section?: string;
}

export interface Term {
	label: string; // "spring 2026"
	current: boolean; // has courses in the live Canvas feed
	courses: Course[];
}

/**
 * Hand edits on top of Canvas, keyed by cleaned code ("PHILOS 104"), or by code plus
 * section for one section of a topics course ("COMPSCI 639 002").
 * `name` replaces a vague Canvas title; `hidden` drops the course from the page.
 */
const OVERRIDES: Record<string, { name?: string; hidden?: boolean }> = {};

/** "FA26 COMPSCI 639 002" → "COMPSCI 639"; "SP25 MATH and CS 240 001 002" → "MATH and CS 240". */
function cleanCode(code: string): string {
	return code.replace(/^(FA|SP|SU)\d{2}\s+/, '').match(/^.*?\d{3}[A-Z]?/)?.[0] ?? code;
}

/** "FA26 COMPSCI 639 002" → "002"; "SP26 ECE 210" → null. */
function sectionOf(code: string): string | null {
	return code.match(/\d{3}[A-Z]?\s+(\d{3})\b/)?.[1] ?? null;
}

/** "COMPSCI577: Introduction to Algorithms (001) ZHH SU25" → "Introduction to Algorithms". */
function cleanName(name: string): string {
	return name
		.replace(/^[^:]*:\s*/, '') // "COMPSCI577: "
		.replace(/\s+(FA|SP|SU)\d{2}$/, '') // " SU25"
		.replace(/\s+[A-Z]{3}$/, '') // " ZHH" (instructor initials, summer sections)
		.replace(/\s*\([^)]*\)$/, '') // " (001)", " (All Sections)"
		.replace(/--/g, '–') // "Calculus--Functions" → "Calculus–Functions"
		.trim();
}

/**
 * Canvas terms are named by academic year: "Fall 2025-2026", "Spring 2025-2026",
 * "Summer 2025". Spring is in the year's second calendar year, so "spring 2026".
 */
function termLabel(term: string): string {
	const [season, years] = term.toLowerCase().split(/\s+/);
	const [first, second] = years.split('-');
	return `${season} ${season === 'spring' && second ? second : first}`;
}

const isClass = (c: CanvasCourse) => c.term !== null && c.termStart !== null; // drops orientation/training sites

export function courseTerms(snapshot: CanvasCourses | null, canvas: Canvas): Term[] {
	if (!snapshot) return [];
	const live = new Set(canvas.events.map((e) => e.course));

	// One row per Canvas course: two sections of a topics course are two different classes.
	const byTerm = new Map<string, { start: string; rows: (CanvasCourse & { clean: string })[] }>();
	for (const c of snapshot.courses.filter(isClass)) {
		const label = termLabel(c.term!);
		const term = byTerm.get(label) ?? { start: c.termStart!, rows: [] };
		byTerm.set(label, term);
		term.rows.push({ ...c, clean: cleanCode(c.code) });
	}

	return [...byTerm]
		.sort(([, a], [, b]) => b.start.localeCompare(a.start))
		.map(([label, { rows }]) => {
			const courses = rows
				.map((c): Course | null => {
					// Same code twice this term → the section tells them apart.
					const shared = rows.filter((r) => r.clean === c.clean).length > 1;
					const section = shared ? (sectionOf(c.code) ?? undefined) : undefined;
					const override = (section && OVERRIDES[`${c.clean} ${section}`]) || OVERRIDES[c.clean];
					if (override?.hidden) return null;
					return { code: c.clean, section, name: override?.name ?? cleanName(c.name) };
				})
				.filter((c): c is Course => c !== null)
				.sort((a, b) => a.code.localeCompare(b.code) || (a.section ?? '').localeCompare(b.section ?? ''));
			return { label, current: courses.some((c) => live.has(c.code)), courses };
		});
}
