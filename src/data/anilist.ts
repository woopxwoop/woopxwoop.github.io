// AniList: public GraphQL API, no key needed for public profiles.
import { z } from 'astro/zod';
import { defineSource, fetchJson } from './source';

const USERNAME = 'GaryFlipsTables';
// AniList media id of the manga shown on the home page (One Piece: anilist.co/manga/30013).
// It must be on your list: AniList errors (and the build fails loudly) if it isn't.
const FEATURED_MANGA_ID = 30013;

const QUERY = /* GraphQL */ `
	query ($name: String, $featuredId: Int) {
		User(name: $name) {
			name
			siteUrl
			statistics {
				anime {
					count
					episodesWatched
					minutesWatched
					meanScore
				}
			}
		}
		recent: Page(perPage: 3) {
			mediaList(userName: $name, type: ANIME, sort: UPDATED_TIME_DESC) {
				status
				progress
				updatedAt
				media {
					title {
						romaji
						english
					}
					episodes
					siteUrl
				}
			}
		}
		# AniList's precomputed manga statistics can be stale (showed 0 for a
		# non-empty list), so totals are computed from the list itself.
		mangaLists: MediaListCollection(userName: $name, type: MANGA) {
			lists {
				entries {
					status
					progress
				}
			}
		}
		# The one series the home page ticker shows (see FEATURED_MANGA_ID).
		featured: MediaList(userName: $name, mediaId: $featuredId) {
			status
			progress
			media {
				title {
					romaji
					english
				}
				chapters
				siteUrl
			}
		}
		recentManga: Page(perPage: 3) {
			mediaList(userName: $name, type: MANGA, sort: UPDATED_TIME_DESC) {
				status
				progress
				updatedAt
				media {
					title {
						romaji
						english
					}
					chapters
					siteUrl
				}
			}
		}
	}
`;

const listStatus = z.enum(['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING']);
const title = z.object({ romaji: z.string().nullable(), english: z.string().nullable() });

const schema = z.object({
	user: z.object({
		name: z.string(),
		siteUrl: z.string().url(),
		statistics: z.object({
			anime: z.object({
				count: z.number(),
				episodesWatched: z.number(),
				minutesWatched: z.number(),
				meanScore: z.number(),
			}),
		}),
	}),
	recent: z.array(
		z.object({
			status: listStatus,
			progress: z.number().nullable(),
			updatedAt: z.number(),
			media: z.object({
				title,
				episodes: z.number().nullable(),
				siteUrl: z.string().url(),
			}),
		}),
	),
	featured: z.object({
		status: listStatus,
		progress: z.number().nullable(),
		media: z.object({
			title,
			chapters: z.number().nullable(), // null while still ongoing
			siteUrl: z.string().url(),
		}),
	}),
	manga: z.object({
		series: z.number(), // entries that aren't just "planning"
		chaptersRead: z.number(),
		recent: z.array(
			z.object({
				status: listStatus,
				progress: z.number().nullable(),
				updatedAt: z.number(),
				media: z.object({
					title,
					chapters: z.number().nullable(),
					siteUrl: z.string().url(),
				}),
			}),
		),
	}),
});

type RawEntry = { status: string; progress: number | null };

export type AniList = z.infer<typeof schema>;

export const getAniList = defineSource('anilist', schema, async () => {
	const res = (await fetchJson('https://graphql.anilist.co', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ query: QUERY, variables: { name: USERNAME, featuredId: FEATURED_MANGA_ID } }),
	})) as {
		data?: {
			User: unknown;
			featured: unknown;
			recent: { mediaList: unknown };
			mangaLists: { lists: { entries: RawEntry[] }[] } | null;
			recentManga: { mediaList: unknown };
		};
		errors?: { message: string }[];
	};

	// GraphQL reports errors with HTTP 200, so check explicitly.
	if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
	const d = res.data;

	const mangaEntries = (d?.mangaLists?.lists ?? []).flatMap((l) => l.entries);
	const started = mangaEntries.filter((e) => e.status !== 'PLANNING');

	return {
		user: d?.User,
		recent: d?.recent.mediaList,
		featured: d?.featured,
		manga: {
			series: started.length,
			chaptersRead: started.reduce((sum, e) => sum + (e.progress ?? 0), 0),
			recent: d?.recentManga.mediaList,
		},
	};
});
