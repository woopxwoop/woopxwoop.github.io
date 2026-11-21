// @ts-check

import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// GitHub Pages *user* site, served at the root: https://woopxwoop.github.io/
	// (repo must be named woopxwoop.github.io). No `base`, so BASE_URL is '/'.
	site: 'https://woopxwoop.github.io',
	integrations: [sitemap()],
	// Cover art on /hobbies is downloaded and resized at build time from these hosts.
	image: {
		domains: ['assets.hardcover.app', 's4.anilist.co'],
	},
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
