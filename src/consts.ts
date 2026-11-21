export const SITE_NAME = 'andrew lou';

// The site lives under a sub-path on GitHub Pages (astro.config `base`),
// so internal links must be prefixed. Always build hrefs with url().
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (path: string) => BASE + path;
/** Strip the base so pathnames can be compared against routes like '/projects'. */
export const stripBase = (pathname: string) => pathname.slice(BASE.length) || '/';

export const NAV_LINKS = [
	{ href: '/projects', label: 'projects' },
	{ href: '/hobbies', label: 'hobbies' },
	{ href: '/week', label: 'week' },
];
