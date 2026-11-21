// Hardcover (reading tracker): needs an API key in HARDCOVER_API_KEY.
// Get it from hardcover.app → Settings → API. Locally: put it in .env. In CI: repo secret.
// Note: Hardcover keys expire after a year; a 401 at build time usually means "make a new one".
import { z } from 'astro/zod';
import { defineSource, fetchJson } from './source';

// Hardcover's API is Hasura GraphQL. `me` is a list with one user (you).
// status_id: 1 want to read · 2 currently reading · 3 read · 5 did not finish.
const QUERY = /* GraphQL */ `
	query {
		me {
			username
			reading: user_books(where: { status_id: { _eq: 2 } }, order_by: { updated_at: desc }) {
				...entry
				user_book_reads(order_by: { started_at: desc_nulls_last }, limit: 1) {
					started_at
					progress_pages
				}
			}
			finished: user_books(
				where: { status_id: { _eq: 3 } }
				order_by: { last_read_date: desc_nulls_last }
				limit: 5
			) {
				...entry
				last_read_date
			}
			goals(order_by: { end_date: desc }, limit: 1) {
				goal
				metric
				progress
				start_date
				end_date
			}
		}
	}

	fragment entry on user_books {
		rating
		book {
			title
			slug
			pages
			image {
				url
			}
			contributions(limit: 1) {
				author {
					name
				}
			}
		}
	}
`;

const book = z.object({
	title: z.string(),
	slug: z.string(),
	pages: z.number().nullable(),
	image: z.object({ url: z.string().url() }).nullable(),
	contributions: z.array(z.object({ author: z.object({ name: z.string() }) })),
});

const entry = z.object({
	rating: z.coerce.number().nullable(), // 0.5–5 stars, null if unrated
	book,
});

// Only the fields we use; everything else (ids, private notes, ...) is stripped
// before it reaches the snapshot.
const schema = z.object({
	username: z.string(),
	reading: z.array(
		entry.extend({
			user_book_reads: z.array(
				z.object({ started_at: z.string().nullable(), progress_pages: z.number().nullable() }),
			),
		}),
	),
	finished: z.array(entry.extend({ last_read_date: z.string().nullable() })),
	goals: z.array(
		z.object({
			goal: z.coerce.number(),
			metric: z.string(), // "book" or "page"
			progress: z.coerce.number(),
			start_date: z.string(),
			end_date: z.string(),
		}),
	),
});

export type Hardcover = z.infer<typeof schema>;
export type HardcoverBook = z.infer<typeof book>;
export type ReadingEntry = Hardcover['reading'][number];

export const bookUrl = (b: HardcoverBook) => `https://hardcover.app/books/${b.slug}`;
export const authorOf = (b: HardcoverBook) => b.contributions[0]?.author.name ?? null;

export const getHardcover = defineSource('hardcover', schema, async () => {
	const key = import.meta.env.HARDCOVER_API_KEY ?? process.env.HARDCOVER_API_KEY;
	if (!key) throw new Error('HARDCOVER_API_KEY is not set');
	// The key on Hardcover's settings page sometimes already includes "Bearer ".
	const authorization = /^bearer /i.test(key) ? key : `Bearer ${key}`;

	const res = (await fetchJson('https://api.hardcover.app/v1/graphql', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json', authorization },
		body: JSON.stringify({ query: QUERY }),
	})) as { data?: { me: unknown[] }; errors?: { message: string }[] };

	// GraphQL reports errors with HTTP 200, so check explicitly.
	if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
	return res.data?.me[0];
});

/** Pages read so far in a currently-reading book, as 0–1 (null if unknown). */
export function progressOf(e: ReadingEntry): number | null {
	const read = e.user_book_reads[0]?.progress_pages;
	if (read == null || !e.book.pages) return null;
	return Math.min(1, read / e.book.pages);
}

/**
 * Which book the /hobbies tile and the top of /hobbies/reading feature when
 * you're reading several at once. `reading` arrives most-recently-updated first.
 */
export function pickCurrent(reading: ReadingEntry[]): ReadingEntry | null {
	// TODO(you): decide which book represents "what I'm reading right now".
	return reading[0] ?? null;
}
