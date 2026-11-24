// pnpm canvas:commit (or `node path/to/scripts/canvas-commit.ts` from anywhere) — run canvas:sync, then commit its snapshots, and nothing else.
//
// Guard rails, so the commit is only ever the sync:
//   1. Before: the working tree must be clean (no staged, unstaged or untracked changes).
//   2. After:  every changed path must be one of the Canvas snapshot files.
// If either check fails nothing is committed. On success it pushes, which deploys.
//
// Works from any directory: it moves to the project root first.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// The snapshot paths (and canvas-sync's .canvas-profile) are path.resolve()d against the
// cwd at import time, so chdir *before* importing them — static imports would run first.
process.chdir(path.resolve(import.meta.dirname, '..'));
const { PLANNER_FILE } = await import('../src/data/planner.ts');
const { COURSES_FILE } = await import('../src/data/canvas-courses.ts');

function git(...args: string[]): string {
	const res = spawnSync('git', args, { encoding: 'utf8' });
	if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${res.stderr}`);
	return res.stdout;
}

/** Every path git considers changed, relative to the repo root, with forward slashes. */
function changedPaths(): string[] {
	// -z: NUL-separated, no quoting of odd filenames. Renames emit "XY new\0old\0".
	const fields = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
	const paths: string[] = [];
	for (let i = 0; i < fields.length; i++) {
		const entry = fields[i];
		paths.push(entry.slice(3));
		if (entry[0] === 'R' || entry[0] === 'C') paths.push(fields[++i]); // the rename's source
	}
	return paths;
}

function fail(message: string, paths: string[] = []): never {
	console.error(`\n✗ ${message}`);
	for (const p of paths) console.error(`    ${p}`);
	process.exit(1);
}

const root = git('rev-parse', '--show-toplevel').trim();
const allowed = new Set([PLANNER_FILE, COURSES_FILE].map((f) => path.relative(root, f).split(path.sep).join('/')));

const dirty = changedPaths();
if (dirty.length) fail('Working tree is not clean — commit or stash these first, so the sync commit is only the sync:', dirty);

const sync = spawnSync(process.execPath, ['scripts/canvas-sync.ts'], { stdio: 'inherit', cwd: root });
if (sync.status !== 0) {
	// The sync writes the planner before fetching courses, so a failure can leave a partial update.
	fail(`canvas:sync failed (exit ${sync.status ?? sync.signal}). Nothing committed. To discard any partial write:\n    git checkout -- ${[...allowed].join(' ')}`);
}

const changed = changedPaths();
const unexpected = changed.filter((p) => !allowed.has(p));
if (unexpected.length) fail('Sync changed files outside the Canvas snapshots — not committing. Check these:', unexpected);
if (!changed.length) {
	console.log('\nNo snapshot changes — nothing to commit.');
	process.exit(0);
}

const message = `canvas sync ${new Date().toISOString().slice(0, 10)}`;
// Pathspec form commits exactly these files, whatever else might be in the index.
git('commit', '-m', message, '--', ...changed);
console.log(`\n✓ Committed ${changed.join(', ')} as "${message}". Pushing...`);

// Inherit stdio so git's own progress and any auth prompt show through.
const push = spawnSync('git', ['push'], { stdio: 'inherit', cwd: root });
if (push.status !== 0) fail('Push failed — the commit is still there locally. Fix the issue above, then run `git push`.');
console.log('✓ Pushed — the deploy workflow will pick it up.');
