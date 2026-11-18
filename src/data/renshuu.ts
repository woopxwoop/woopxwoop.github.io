// Renshuu: needs a (read-only) API key in RENSHUU_API_KEY.
// Locally: put it in .env. In CI: repo secret, passed via the workflow's env.
import { z } from 'astro/zod';
import { defineSource, fetchJson } from './source';

const JLPT = ['n5', 'n4', 'n3', 'n2', 'n1'] as const; // easiest → hardest

const levels = z.object(Object.fromEntries(JLPT.map((l) => [l, z.number()])) as Record<(typeof JLPT)[number], z.ZodNumber>);
const streak = z.object({ days_studied_in_a_row: z.number(), days_studied_in_a_row_alltime: z.number() });

// Only the fields we use; everything else (name, API usage, ...) is stripped
// before it reaches the snapshot.
const schema = z.object({
	adventure_level: z.number(),
	studied: z.object({
		total_vocab: z.number(),
		total_kanji: z.number(),
		total_grammar: z.number(),
	}),
	level_progress_percs: z.object({ vocab: levels, kanji: levels, grammar: levels }),
	streaks: z.object({ vocab: streak, kanji: streak, grammar: streak }),
});

export type Renshuu = z.infer<typeof schema>;
export type JlptLevel = (typeof JLPT)[number];
export { JLPT };

export const getRenshuu = defineSource('renshuu', schema, async () => {
	const key = import.meta.env.RENSHUU_API_KEY ?? process.env.RENSHUU_API_KEY;
	if (!key) throw new Error('RENSHUU_API_KEY is not set');
	return fetchJson('https://api.renshuu.org/v1/profile', {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
	});
});
