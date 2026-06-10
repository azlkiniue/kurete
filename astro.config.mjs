// @ts-check
import { defineConfig } from 'astro/config';

// Host-agnostic config.
//
// GitHub Pages (project site -> https://<user>.github.io/<repo>/):
//   set SITE=https://<user>.github.io and BASE_PATH=/<repo>
// GitHub Pages (user/org site) or Cloudflare Pages (served at root):
//   leave BASE_PATH unset (defaults to "/"); set SITE to your domain.
//
// These are read from the environment so the same code deploys anywhere.
const SITE = process.env.SITE ?? 'https://example.github.io';
const BASE_PATH = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site: SITE,
  base: BASE_PATH,
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    // Emit /path/index.html so it works on any static host without rewrites.
    format: 'directory',
  },
});
