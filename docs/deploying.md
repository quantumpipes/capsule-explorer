# Deploying

Capsule Explorer builds to a static site. The default mode is fully air-gapped: it ships the exported chain bundle and does all verification in the browser. You can host it anywhere that serves static files.

## Build to static

```bash
npm install
npm run export      # write public/data/chains from ~/.agent-capsule/chains
npm run build       # build:og + astro build -> dist/
```

`npm run build` runs the Open Graph image step (`build:og`) then `astro build`, writing the site to `dist/`. The contents of `dist/` are the deployable artifact, including the chain bundle that was in `public/data/chains/` at build time.

## Deploy to Cloudflare Pages

The repo ships a `deploy` script that builds and pushes with Wrangler:

```bash
npm run deploy      # npm run build && wrangler deploy
```

You need the Cloudflare CLI authenticated (`wrangler login`) and a project configured. The site config (`astro.config.mjs`) sets `site: "https://capsules.quantumpipes.com"` and `output: "static"`; change `site` to your own domain so the sitemap and canonical URLs are correct.

## Deploy to any static host

`dist/` is plain static files. Upload it to any host:

| Host | How |
|------|-----|
| Netlify | drag `dist/` into the dashboard, or set build command `npm run build` and publish dir `dist`. |
| GitHub Pages | push `dist/` to your Pages branch, or build in CI and publish the artifact. |
| S3 / CDN | sync `dist/` to the bucket, serve `index.html` at the root. |
| Self-hosted | serve `dist/` with any web server (nginx, Caddy, `python3 -m http.server`). |

No server-side runtime is required. There is no API to stand up for the default static mode.

## Refresh the bundle

The exported chains are a point-in-time snapshot. To publish new or updated sessions, re-export and rebuild:

```bash
npm run export                                  # from this repo
# or, from the agent-capsule package:
agent-capsule export --out public/data/chains

npm run build                                   # then rebuild and redeploy
```

Both commands write `public/data/chains/{index.json, <chain-id>.json, meta.json}`. The exporter discovers `~/.agent-capsule/chains/*/*.db` by default; pass `--db PATH` or `--glob PATTERN` to export a subset.

## Bundle size

A full export of an active machine is large: one JSON file per conversation, carrying every capsule's exact canonical bytes. A few months of daily use is easily hundreds of megabytes, and `astro build` copies all of it into `dist/`. That is fine for **local** browsing (chains load lazily, one at a time), but it is the wrong thing to push to a public host.

For a public deploy, export a small, curated set rather than your whole history:

```bash
agent-capsule export --out public/data/chains \
  --db ~/.agent-capsule/chains/claude-code/<a-session>.db \
  --db ~/.agent-capsule/chains/claude-code/<another>.db
```

`public/data/` is gitignored, so nothing is committed by default; what you deploy is whatever you exported at build time. Cloudflare and most static hosts gzip JSON automatically, and the per-file limit (25 MB on Cloudflare Pages) is rarely hit by a single conversation, but total transfer still grows with the bundle.

## Static vs live mode

| Mode | Trigger | Behavior |
|------|---------|----------|
| **static** (default) | `PUBLIC_CAPSULE_API` unset | Serves the exported JSON and verifies in the browser. This is what you deploy for a self-contained, no-backend verifier. |
| **live** | `PUBLIC_CAPSULE_API` set at build time | Reads chains from that server base URL and delegates verification to its `/v1/capsules/verify-chain` endpoint. Use only when a capsule API is reachable from the deployed site. |

For a public, shareable verifier, deploy static. The point of the explorer is that the recipient needs nothing but a browser.

## Privacy note

Treat the exported bundle with the same care as the sessions it came from. **A full export is your entire coding history** (every prompt, response, file diff, and command). Do not publish it. For anything public, export a curated subset (see [Bundle size](#bundle-size)) or host behind access controls.

- The bundle in `public/data/chains/` contains your **capsule contents** (prompts, responses, tool calls, outcomes) and the **public** signing key. It never contains the private key (`~/.agent-capsule/key` stays on your machine, `0600`).
- The public key is safe to publish: it lets anyone verify and lets no one forge.
- The capsule contents are as sensitive as your transcripts. Anything you would not paste into a public site, do not export and deploy publicly. Export a subset with `--db` / `--glob`, or host the static site behind access controls.
