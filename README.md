# Ecommerce Product Scraper

Implements `PRODUCT_SCRAPER_PLAN.md`. Reads product URLs from Excel, scrapes each
with Playwright using per-site config files, downloads images, and writes a
`product.json` per product with a full extraction trace.

## Setup

```bash
npm install
npx playwright install chromium   # already done if you ran this via Claude Code
npm run sample-excel               # writes input/products.xlsx with 3 demo URLs
```

`.env` (copied from `.env.example`) controls concurrency, retries, and the
per-domain politeness delay — adjust before a real run.

## Usage

```bash
npm run dry-run          # just lists the URLs that would be scraped
npm start                 # full run
node src/index.js --limit=1          # only process the first (not-yet-done) URL
node src/index.js --headed           # show the browser window
node src/index.js --force            # re-scrape URLs already marked done
node src/index.js --website=boat     # force a specific config regardless of hostname
node src/index.js --input=input/other.xlsx
```

Output lands in `output/<website>/<product-slug>/{01.jpg, 02.jpg, ..., product.json}`.
Progress is tracked in `state/run.json` (resumable — re-running skips completed
products) and mirrored back into the input Excel's `status`/`scrapedAt`/`error`
columns after each run. Daily logs go to `logs/YYYY-MM-DD.json`, run summaries to
`logs/runs/<runId>.json`, and failure screenshots to `screenshots/<website>/`.

## Verifying the pipeline (demo config)

`npm run sample-excel` points at `books.toscrape.com`, a public sandbox site
built for practicing scrapers ("We love being scraped!"). Run `npm start` after
that to confirm the whole pipeline — extraction, trace, image download,
folder creation, schema validation — works end-to-end before pointing real
configs at real store pages.

## Adding a new website

1. Create `src/configs/<site>.js` with `selectors` (and optionally
   `beforeExtract` / `parse`) — see existing configs for the shape.
2. Add one entry to `src/configRegistry.js`.

Nothing else changes — `domainRouter.js` and `scraper.js` are site-agnostic.

## Notes on the boat / levis / hm configs

These three configs are **best-effort placeholders** built from typical
Shopify/ecommerce markup patterns, not verified against the live sites from
this environment. Before relying on them:

1. Run with `--headed --limit=1` against one real URL per site.
2. Check the `trace` section of the resulting `product.json` — any field
   with `"success": false` means every selector for that field missed, and
   the real selector needs to be added to that site's config.
3. JSON-LD is tried first automatically, so if a site exposes proper Product
   JSON-LD, DOM selectors mostly become the fallback and matter less.

## Upload pipeline

The easiest way to run scrape → review → Mongo export end to end is the
browser UI: `npm run review`, then open http://localhost:4000 and use the
**Batch** page — upload your Excel file, start the scrape, and it'll auto-
transform and take you to review when it's done. See **Part 0** of
`USAGE_GUIDE.md` for a full walkthrough.

The same pipeline is also scriptable at the CLI: `npm run transform` →
`npm run review` → `npm run export-mongo` → `npm run mark-uploaded` (once
you've confirmed the paste into Mongo succeeded) → `npm run archive-batch`
(to reset for the next batch). Full details, field mapping, and
troubleshooting: see **Part 3** of `USAGE_GUIDE.md`.

## Practical/ethical rules (carried over from the plan)

Respect target sites' terms, robots rules, and rate limits. Do not bypass
CAPTCHAs, authentication, or anti-bot protections. The per-domain rate
limiter (`DOMAIN_DELAY_MS`/`DOMAIN_DELAY_JITTER_MS` in `.env`) exists to keep
request pacing polite — don't set it to 0 for production scraping.
