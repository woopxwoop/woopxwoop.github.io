// Build-time data sources (AniList, GitHub, Monkeytype, ...).
//
// Policy:
//  - Each request retries briefly (1s, 3s, 9s backoff) to ride out network blips.
//  - Responses are validated with a zod schema, so an API shape change fails loudly.
//  - On success, the parsed data is saved to snapshots/<name>.json.
//  - Production builds FAIL if a source fails: GitHub Pages keeps serving the
//    last good deploy, so the live site is never half-filled.
//  - `astro dev` falls back to the last snapshot (with a warning) so you can
//    work offline or without API keys.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'astro/zod';

// Outside src/ on purpose: writing here must not trigger dev-server reloads.
const SNAPSHOT_DIR = path.resolve('snapshots');
const DEV_TTL_MS = 10 * 60 * 1000;

class HttpError extends Error {
	constructor(
		readonly status: number,
		body: string,
	) {
		super(`HTTP ${status}: ${body.slice(0, 300)}`);
	}
	get retryable() {
		return this.status === 429 || this.status >= 500;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch + JSON with timeout and retry/backoff on network errors, 429 and 5xx. */
export async function fetchJson(
	url: string,
	init: RequestInit = {},
	{ retries = 3, timeoutMs = 10_000 } = {},
): Promise<unknown> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await sleep(1000 * 3 ** (attempt - 1));
		try {
			const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
			if (!res.ok) throw new HttpError(res.status, await res.text());
			return await res.json();
		} catch (err) {
			if (err instanceof HttpError && !err.retryable) throw err; // 4xx: retrying won't help
			lastError = err;
		}
	}
	throw lastError;
}

async function readSnapshot(name: string) {
	try {
		const raw = await fs.readFile(path.join(SNAPSHOT_DIR, `${name}.json`), 'utf8');
		return JSON.parse(raw) as { fetchedAt: string; data: unknown };
	} catch {
		return null;
	}
}

async function writeSnapshot(name: string, data: unknown) {
	await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
	const body = JSON.stringify({ fetchedAt: new Date().toISOString(), data }, null, '\t');
	await fs.writeFile(path.join(SNAPSHOT_DIR, `${name}.json`), body + '\n');
}

/**
 * Define a data source. Returns a memoized getter, so many pages can call it
 * during one build while the API is hit only once.
 */
export function defineSource<S extends z.ZodType>(
	name: string,
	schema: S,
	load: () => Promise<unknown>,
): () => Promise<z.infer<S>> {
	let cached: Promise<z.infer<S>> | null = null;
	let cachedAt = 0;

	async function run(): Promise<z.infer<S>> {
		try {
			const data = schema.parse(await load());
			await writeSnapshot(name, data);
			return data;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			if (import.meta.env.DEV) {
				const snap = await readSnapshot(name);
				if (snap) {
					console.warn(`[data:${name}] fetch failed, using snapshot from ${snap.fetchedAt}\n  ${reason}`);
					return schema.parse(snap.data);
				}
			}
			throw new Error(`[data:${name}] ${reason}`, { cause: err });
		}
	}

	return () => {
		// In dev the server is long-lived, so refresh occasionally; builds fetch once.
		if (!cached || (import.meta.env.DEV && Date.now() - cachedAt > DEV_TTL_MS)) {
			cachedAt = Date.now();
			cached = run();
			cached.catch(() => (cached = null)); // don't memoize failures
		}
		return cached;
	};
}
