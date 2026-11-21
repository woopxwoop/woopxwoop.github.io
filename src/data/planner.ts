// Canvas Planner status (submitted / missing / marked complete), synced by hand.
//
// UW restricts Canvas API tokens, so CI can't fetch this. Instead `pnpm canvas:sync`
// (scripts/canvas-sync.ts) opens a browser, you sign in, and it reads your planner
// from inside the signed-in page, writing snapshots/canvas-planner.json. Commit
// that file; builds only ever READ it, merging it with the live ICS feed by id.
//
// Imported by both Astro and the plain-Node sync script, so: no astro:* imports.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'astro/zod';

export const PLANNER_FILE = path.resolve('snapshots/canvas-planner.json');

export const plannerItem = z.object({
	// Same id the ICS feed uses as UID, so the two can be joined:
	// "event-assignment-3080261" / "event-calendar-event-123"
	id: z.string(),
	submitted: z.boolean(),
	missing: z.boolean(),
	excused: z.boolean(),
	graded: z.boolean(),
	markedComplete: z.boolean(), // the checkbox you tick in the Canvas planner
	// How it's turned in: "online_upload", "online_quiz", "external_tool", "on_paper", "none", ...
	// Empty for calendar events, and for snapshots synced before this field existed.
	submissionTypes: z.array(z.string()).default([]),
});

export const plannerSchema = z.object({
	syncedAt: z.string(),
	range: z.object({ start: z.string(), end: z.string() }), // which due dates the sync covered
	items: z.array(plannerItem),
});

export type PlannerItem = z.infer<typeof plannerItem>;
export type Planner = z.infer<typeof plannerSchema>;

/** The last sync, or null if you've never run `pnpm canvas:sync`. Invalid file = loud failure. */
export function readPlanner(): Planner | null {
	let raw: string;
	try {
		raw = fs.readFileSync(PLANNER_FILE, 'utf8');
	} catch {
		return null;
	}
	return plannerSchema.parse(JSON.parse(raw));
}
