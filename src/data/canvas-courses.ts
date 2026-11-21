// Canvas course history (every course you've been a student in, past and present),
// synced by hand alongside the planner: `pnpm canvas:sync` writes
// snapshots/canvas-courses.json. Commit it; builds only READ it. Shown on /courses
// (src/data/courses.ts). The ICS feed can't do this: it only has current courses.
//
// Stored close to raw so name cleanup can change without re-syncing.
// Imported by both Astro and the plain-Node sync script, so: no astro:* imports.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'astro/zod';

export const COURSES_FILE = path.resolve('snapshots/canvas-courses.json');

export const canvasCourse = z.object({
	id: z.string(),
	code: z.string(), // Canvas course_code, e.g. "ECE 353"
	name: z.string(), // Canvas name, often with section/term noise
	term: z.string().nullable(), // "Fall 2026"; null for non-term sites
	termStart: z.string().nullable(), // ISO, for ordering terms
});

export const coursesSchema = z.object({
	syncedAt: z.string(),
	courses: z.array(canvasCourse),
});

export type CanvasCourse = z.infer<typeof canvasCourse>;
export type CanvasCourses = z.infer<typeof coursesSchema>;

/** The last sync, or null if it has never run. Invalid file = loud failure. */
export function readCanvasCourses(): CanvasCourses | null {
	let raw: string;
	try {
		raw = fs.readFileSync(COURSES_FILE, 'utf8');
	} catch {
		return null;
	}
	return coursesSchema.parse(JSON.parse(raw));
}
