// The /hobbies index: cover tiles grouped under category headings, built from the data
// sources. Adding a hobby = one more tile in hobbySections() (and, if it gets its own
// page, a file in src/pages/hobbies/).
import type { AniList } from './anilist';
import { pickCurrent, progressOf, type Hardcover } from './hardcover';
import type { Renshuu } from './renshuu';
import { url } from '../consts';

export interface HobbyTile {
	label: string; // "reading"
	status: string; // one short line under the cover, e.g. "Piranesi · 62%"
	href?: string; // own page (/hobbies/x) or an external profile
	cover?: string; // image URL; tiles without one show `glyph` instead
	glyph?: string; // big character for hobbies with no cover art
}

type Title = { romaji: string | null; english: string | null };
const titleOf = (t: Title) => t.english ?? t.romaji ?? 'something';
const fmt = (n: number) => n.toLocaleString('en-US');

function booksTile(hc: Hardcover): HobbyTile {
	const tile = { label: 'books', href: url('/hobbies/reading') };
	const current = pickCurrent(hc.reading);
	if (current) {
		const p = progressOf(current);
		return {
			...tile,
			status: p == null ? current.book.title : `${current.book.title} · ${Math.round(p * 100)}%`,
			cover: current.book.image?.url,
		};
	}
	// Between books: show the last one finished.
	const last = hc.finished[0];
	return last
		? { ...tile, status: `finished ${last.book.title}`, cover: last.book.image?.url }
		: { ...tile, status: 'between books', glyph: '本' };
}

function mangaTile({ featured }: AniList): HobbyTile {
	return {
		label: 'manga',
		status: `${titleOf(featured.media.title)} · ch ${fmt(featured.progress ?? 0)}`,
		href: featured.media.siteUrl,
		cover: featured.media.coverImage.large ?? undefined,
	};
}

function japaneseTile({ streaks }: Renshuu): HobbyTile {
	const streak = Math.max(...Object.values(streaks).map((s) => s.days_studied_in_a_row));
	return { label: 'japanese', status: streak > 0 ? `${streak} day streak` : 'on a break', glyph: '語' };
}

export interface HobbySection {
	heading: string; // "reading"
	tiles: HobbyTile[];
}

export function hobbySections(src: { hardcover: Hardcover; anilist: AniList; renshuu: Renshuu }): HobbySection[] {
	return [
		{ heading: 'reading', tiles: [booksTile(src.hardcover), mangaTile(src.anilist)] },
		{ heading: 'learning', tiles: [japaneseTile(src.renshuu)] },
	];
}
