// GitHub: contribution calendar (the profile's green squares) via the GraphQL API.
//
// GraphQL always needs a token, even for public data:
//  - CI: the workflow's automatic GITHUB_TOKEN (no secret to create; see deploy.yml).
//  - Locally: GITHUB_TOKEN in .env — a fine-grained personal token with *no* extra
//    permissions is enough to read public contributions.
// Private-repo work is only counted if "Include private contributions" is on in your
// GitHub profile settings (it then shows up as restrictedContributionsCount, count only).
import { z } from 'astro/zod';
import { defineSource, fetchJson } from './source';

const USERNAME = 'woopxwoop';

const QUERY = /* GraphQL */ `
	query ($login: String!) {
		user(login: $login) {
			url
			contributionsCollection {
				totalCommitContributions
				restrictedContributionsCount
				contributionCalendar {
					totalContributions
					weeks {
						contributionDays {
							date
							contributionCount
						}
					}
				}
			}
		}
	}
`;

const schema = z.object({
	url: z.string().url(),
	totalContributions: z.number(), // last ~year, everything (commits, PRs, issues, reviews)
	commits: z.number(),
	privateContributions: z.number(),
	days: z.array(z.object({ date: z.string(), count: z.number() })), // "YYYY-MM-DD", oldest first
});

export type GitHub = z.infer<typeof schema>;

type Raw = {
	data?: {
		user: {
			url: string;
			contributionsCollection: {
				totalCommitContributions: number;
				restrictedContributionsCount: number;
				contributionCalendar: {
					totalContributions: number;
					weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
				};
			};
		} | null;
	};
	errors?: { message: string }[];
};

export const getGitHub = defineSource('github', schema, async () => {
	const token = import.meta.env.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
	if (!token) throw new Error('GITHUB_TOKEN is not set');

	const res = (await fetchJson('https://api.github.com/graphql', {
		method: 'POST',
		headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
	})) as Raw;

	// GraphQL reports errors with HTTP 200, so check explicitly.
	if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
	const user = res.data?.user;
	if (!user) throw new Error(`GitHub user ${USERNAME} not found`);

	const c = user.contributionsCollection;
	return {
		url: user.url,
		totalContributions: c.contributionCalendar.totalContributions,
		commits: c.totalCommitContributions,
		privateContributions: c.restrictedContributionsCount,
		days: c.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
	};
});
