export const SITE_NAME = 'andrew lou';

// The site is at the root today, but build internal hrefs with url() anyway: it
// prefixes astro.config `base` if one is ever set (e.g. moving to a project site).
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (path: string) => BASE + path;
/** Strip the base so pathnames can be compared against routes like '/projects'. */
export const stripBase = (pathname: string) => pathname.slice(BASE.length) || '/';

// Header links; add e.g. { href: '/projects', label: 'projects' } when the page exists.
// (Hobbies is parked in src/pages/_hobbies — the "_" keeps Astro from building it.
// Rename the folder back to "hobbies" and re-add the link to bring it back.)
export const NAV_LINKS: { href: string; label: string }[] = [{ href: '/courses', label: 'courses' }];
