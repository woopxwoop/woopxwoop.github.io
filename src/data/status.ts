// Turns raw source data into the short lines shown in the home page status ticker.
// This is the place to decide what you want to brag about and how it reads.
import type { AniList } from './anilist';
import type { Canvas } from './canvas';
import { JLPT, type Renshuu } from './renshuu';

export interface StatusItem {
	label: string; // short prefix, e.g. "anime", "reading"
	text: string;
	href?: string;
}

const fmt = (n: number) => n.toLocaleString('en-US');

type Title = { romaji: string | null; english: string | null };
const titleOf = (t: Title) => t.english ?? t.romaji ?? 'something';

/** "watching X · ep 3/12" / "finished X" / "added X" for the most recent list entry. */
function latestItem(
	entry: { status: string; progress: number | null; media: { title: Title; siteUrl: string } },
	kind: { active: string; unit: string; total: number | null },
): StatusItem {
	const title = titleOf(entry.media.title);
	const href = entry.media.siteUrl;
	if (entry.status === 'CURRENT' || entry.status === 'REPEATING') {
		const progress = `${kind.unit} ${fmt(entry.progress ?? 0)}${kind.total ? `/${fmt(kind.total)}` : ''}`;
		return { label: kind.active, text: `${title} · ${progress}`, href };
	}
	if (entry.status === 'COMPLETED') return { label: 'finished', text: title, href };
	return { label: 'added', text: title, href };
}

export function anilistStatus({ user, recent, manga }: AniList): StatusItem[] {
	const { count, episodesWatched, minutesWatched } = user.statistics.anime;
	const items: StatusItem[] = [
		{
			label: 'anime',
			text: `${fmt(count)} shows · ${fmt(episodesWatched)} episodes · ${Math.round(minutesWatched / 1440)} days`,
			href: user.siteUrl,
		},
	];

	if (recent[0]) {
		items.push(latestItem(recent[0], { active: 'watching', unit: 'ep', total: recent[0].media.episodes }));
	}

	// With a single series the totals line would just repeat the "reading" line.
	if (manga.series > 1) {
		items.push({
			label: 'manga',
			text: `${fmt(manga.series)} series · ${fmt(manga.chaptersRead)} chapters`,
			href: user.siteUrl,
		});
	}

	if (manga.recent[0]) {
		items.push(latestItem(manga.recent[0], { active: 'reading', unit: 'ch', total: manga.recent[0].media.chapters }));
	}

	return items;
}

/** The JLPT level you're currently working through: first one (N5 → N1) not at 100%. */
function currentLevel(percs: Record<(typeof JLPT)[number], number>) {
	const level = JLPT.find((l) => percs[l] < 100);
	return level ? `${level.toUpperCase()} ${percs[level]}%` : 'N1 100%';
}

export function renshuuStatus({ studied, level_progress_percs: p, streaks }: Renshuu): StatusItem[] {
	const items: StatusItem[] = [
		{
			label: 'japanese',
			text: `${fmt(studied.total_vocab)} words · ${fmt(studied.total_kanji)} kanji · ${fmt(studied.total_grammar)} grammar points`,
		},
		{
			label: 'jlpt',
			text: `vocab ${currentLevel(p.vocab)} · kanji ${currentLevel(p.kanji)} · grammar ${currentLevel(p.grammar)}`,
		},
	];

	// Only brag about a streak that's actually running.
	const streak = Math.max(streaks.vocab.days_studied_in_a_row, streaks.kanji.days_studied_in_a_row, streaks.grammar.days_studied_in_a_row);
	if (streak > 1) items.push({ label: 'streak', text: `${streak} days studying japanese` });

	return items;
}

/**
 * Canvas → ticker lines. `events` is sorted by due date (past and future), each
 * `{ title, course, due, allDay, kind }`. `now` is the build time; the site
 * rebuilds every 6h, so anything time-relative is at most that stale.
 */
export function canvasStatus({ events }: Canvas, now = new Date()): StatusItem[] {
	// TODO: decide what the ticker shows from your coursework.
	return [];
}
