# Usage Guide — Running & Extending the Scraper

Companion to `PRODUCT_SCRAPER_PLAN.md` (the design) and `README.md` (quick
start). This file covers three things in depth: **day-to-day scraper
operation**, **how to add/fix a website config**, and **the upload pipeline**
that turns scraped `product.json` files into campaign-ready payloads.

---

## Part 1 — Running the project

### 1.1 One-time setup

```bash
npm install
npx playwright install chromium
cp .env.example .env        # already done if you followed the initial setup
```

### 1.2 Everyday commands

```bash
npm run sample-excel        # (re)writes input/products.xlsx with 3 demo URLs
npm run dry-run              # lists URLs that WOULD be scraped — no browser opens
npm start                    # full run over input/products.xlsx
```

### 1.3 Filling in the input Excel file

`input/products.xlsx` (or whatever you point `--input=` at) needs one header
row on the **first sheet**, matched case-insensitively:

| url (required) | website (optional) | status (leave blank / ignore) |
|---|---|---|
| https://www.boat-lifestyle.com/products/some-product | | |
| https://www.levi.com/US/en_US/some-product/p/123456 | | |
| https://www2.hm.com/en_us/productpage.0123456.html | | |
| https://weird-regional-domain.example/p/9 | boat | |

Rules:

- **`url`** — the only required column. One product URL per row, full
  `https://...` link (not a search page, not a category listing).
- **`website`** — leave it blank in almost all cases; the scraper detects the
  site from the URL's hostname automatically (via
  `src/configRegistry.js`). Only fill this in when the hostname itself is
  misleading (a regional/whitelabel domain, a shortlink, an A/B test domain)
  and you need to force a specific config. The value must exactly match a
  config's `name` — currently one of `boat`, `levis`, `hm`, or `books-demo`
  (the demo/test config) — otherwise it's ignored and auto-detection runs
  instead.
- **`status`** / **`scrapedAt`** / **`error`** — don't fill these in
  yourself; they get **written by the scraper** after each run (see §1.7)
  and are how you can see progress at a glance by opening the sheet. It's
  fine if these columns don't exist yet — `npm start` creates them
  automatically on first run.
- **Don't hand-edit `status` to `done`** to try to skip a row — resumability
  is actually tracked in `state/run.json`, not in the Excel file itself; the
  Excel columns are a mirror for your convenience, not the source of truth.
  To force a re-scrape of specific rows, use `--force` (which reprocesses
  everything in the sheet) rather than editing the sheet's status.
- Rows with an empty/missing `url` cell are silently skipped.
- A URL whose hostname doesn't match any registered site (and has no
  `website` override) is skipped and logged as `"status": "skipped"` in
  `logs/YYYY-MM-DD.json` — not treated as a failure, just unhandled.

Quick way to regenerate a throwaway test sheet instead of hand-editing:

```bash
npm run sample-excel   # overwrites input/products.xlsx with 3 demo URLs
```

For a real batch, just open `input/products.xlsx` in Excel and paste your
own URLs into the `url` column, or build the file programmatically the same
way `scripts/createSampleExcel.js` does.

Before a real run, it's worth checking the sheet for duplicate/junk rows —
nothing validates the sheet's contents automatically, and a large pasted
batch commonly has both:

```bash
npm run check-duplicates                    # checks input/products.xlsx
node src/checkDuplicates.js --input=input/other.xlsx
```

Read-only — it changes nothing, just reports. Two things to look for in its
output:
- **A URL repeated across multiple rows** — each duplicate row gets scraped
  independently within the same run (resumability in `state/run.json` only
  prevents re-scraping a URL across *separate* runs, not duplicate rows
  within one run), wasting time re-fetching a product you already have —
  harmless (the extra scrapes just overwrite the same output folder, per
  `resolveUniqueFolder`'s source-url marker match), but pure waste.
- **A placeholder character instead of a real URL** (e.g. a cell containing
  just `—`) — `excelReader.js` auto-prefixes anything without `http(s)://`
  with `https://`, so a stray `—` becomes `"https://—"`, which then
  correctly fails to match any site config and shows up as
  `skippedUnknownWebsite` in the run summary. Harmless, just noisy — worth
  clearing those cells out so the summary's numbers are meaningful.

### 1.4 CLI flags (all optional, combine freely)

| Flag | Effect |
|---|---|
| `--limit=N` | Only process the first N not-yet-done rows this run |
| `--headed` | Show the actual Chromium window (essential for debugging) |
| `--force` | Re-scrape URLs even if `state/run.json` already marks them `done` |
| `--website=<name>` | Force a specific config (matches a config's `name` field) instead of auto-detecting from the hostname |
| `--input=path/to/file.xlsx` | Use a different Excel file than `input/products.xlsx` |
| `--dry-run` | Just print the URL list, do nothing else |
| `--skip-images` | Don't download image files — product.json still lists every URL found, marked `success: false, error: "skipped"` (also settable via `SKIP_IMAGES=true` in `.env`) |

Examples:

```bash
# See exactly what will run, without touching the browser
node src/index.js --dry-run

# Debug one row visually
node src/index.js --headed --limit=1 --force

# Force the boat config against a URL whose hostname doesn't obviously say "boat"
node src/index.js --website=boat --limit=1 --force

# Point at a different sheet entirely
node src/index.js --input=input/batch2.xlsx
```

### 1.5 Where everything lands

```text
output/<website>/<product-slug>/
    01.jpg, 02.jpg, ...
    product.json
    .source-url          <- internal marker, ignore; keeps folder reuse stable across re-runs

state/run.json            <- resumability checkpoint: which URLs are done/failed
logs/YYYY-MM-DD.json      <- one record per URL processed today
logs/runs/<runId>.json    <- one summary per `npm start` invocation
screenshots/<website>/    <- full-page screenshot for every failed URL
input/products.xlsx       <- gets status/scrapedAt/error columns written back after each run
```

### 1.6 Reading `product.json` — the part that matters most

Every field carries a `trace` entry telling you **where it came from**:

```json
"trace": {
  "price": { "source": "dom", "selector": ".price_color", "success": true }
}
```

- `source: "json-ld"` — came from the page's structured data (most reliable, survives redesigns).
- `source: "dom"` — came from a CSS selector fallback.
- `source: "missing"` — nothing worked; the field is `null` in `product`.

**Rule of thumb:** whenever you're not sure why a run "half-worked," open the
`product.json` and read `trace` before looking at anything else — it tells
you exactly which selector to fix.

### 1.7 Resumability — how re-running behaves

- Re-running `npm start` skips any URL already marked `done` in `state/run.json`.
- Failed URLs are **not** auto-skipped — they're retried on the next run by default.
- `--force` ignores `state/run.json` entirely and re-scrapes everything in the sheet.
- Deleting `state/run.json` (or just `rm -rf state`) resets all resumability tracking — do this if you want a truly clean run.
- Ctrl+C mid-run closes the browser cleanly and saves whatever state was recorded up to that point; nothing is lost, but the row in progress when you hit Ctrl+C is not marked done.

### 1.8 Tuning politeness / speed (`.env`)

```env
PRODUCT_CONCURRENCY=1        # how many product pages open at once
IMAGE_CONCURRENCY=5          # how many images download at once, per product
DOMAIN_DELAY_MS=800          # minimum gap between requests to the SAME host
DOMAIN_DELAY_JITTER_MS=400   # random extra delay on top, so requests don't look robotically even
MAX_RETRIES=2                # retries per URL within a single run, with backoff
```

Raise `PRODUCT_CONCURRENCY` only after a site is scraping reliably at
concurrency 1 — see §32 of the plan. Never set the domain delay to 0 for a
real run against a live store.

### 1.9 Common problems

| Symptom | Likely cause / fix |
|---|---|
| `Found 0 URL(s)` | Check the Excel header row literally says `url` (case-insensitive is fine, spelling isn't) |
| A row is silently skipped, no error | Hostname didn't match any entry in `src/configRegistry.js` — check `logs/YYYY-MM-DD.json` for a `"status": "skipped"` record, or set the `website` column explicitly |
| Every field's trace says `"success": false` | Selectors in that site's config don't match the real page — run with `--headed` and inspect, see Part 2 |
| `product.json` never gets written, error mentions Zod/schema | `product.name` came back empty — usually means the *title* selector is wrong, not a code bug |
| A URL fails every time with `Navigation failed: HTTP 404/403/999` | Real dead link, or the site is blocking the request (see §1.9) — this is not silently swallowed; check `screenshots/<website>/` for what the page actually showed |
| Windows path errors creating folders | Product name is extremely long — `slugify()` already caps at 80 chars; if you still hit issues, lower `maxLength` in `src/utils/slugify.js` |
| Run summary's `succeeded` count is higher than the number of folders under `output/<website>/` | Almost always duplicate URL rows in the input sheet — each duplicate is scraped and logged as its own success, then correctly reuses the same output folder instead of making a new one. Run `npm run check-duplicates` to see exactly which URLs are repeated (see §1.3) |

### 1.10 If a site blocks you outright

Do not try to defeat CAPTCHAs, rotate IPs to dodge blocks, spoof headers to
impersonate a real browser beyond a normal `User-Agent`, or bypass any login
wall. That's outside what this project is for. If a site consistently blocks
automated access, that site is not a valid target for this scraper.

---

## Part 2 — Making it work on a new / different website

The engine (`src/index.js`, `src/scraper.js`, `src/domainRouter.js`) is
**site-agnostic and should never need editing** for a new website. Everything
site-specific lives in one config file + one registry line.

### 2.1 The checklist

1. **Check robots.txt and ToS first.** `https://<site>/robots.txt` — if product
   pages are disallowed for crawlers, or the ToS forbids scraping, stop here.
2. **Open one real product page and view source** (not dev-tools-rendered DOM —
   actual "View Page Source"). Search for:
   ```text
   <script type="application/ld+json">
   ```
   If present and it contains `"@type": "Product"` (or a `@graph` array
   containing one), you're in good shape — JSON-LD covers name/brand/price/
   currency/sku/images automatically, and DOM selectors become a thin
   fallback that rarely gets used.
3. **Identify the real DOM selectors anyway** (for the fallback path and for
   sites with no/partial JSON-LD) using browser dev tools:
   - Title: look for `data-testid`, a stable `id`, or a semantic class before
     falling back to a bare `h1`.
   - Price: same priority — avoid a class name that looks auto-generated
     (e.g. `css-1a2b3c4`) or a numbered utility class.
   - Description.
   - Image gallery container (prefer a specific gallery selector over `img`
     globally — the DOM `<img>` list on a real page includes logos, icons,
     and recommendation-carousel thumbnails you don't want).
4. **Check for a cookie/consent banner.** If one blocks the page on first
   load, note its dismiss button's selector — you'll need it in
   `beforeExtract`.
5. **Check if images lazy-load on scroll.** If the gallery is empty until you
   scroll, you need the scroll step in `beforeExtract` (already the default
   pattern in the existing configs).
6. **Check the price format.** Note the currency symbol/code and separator
   style (`₹1,499.00` vs `$24.99` vs `1 499,00 €`) — `src/utils/price.js`
   handles `₹ $ £ € ¥` and 3-letter codes already; extend its
   `SYMBOL_TO_CURRENCY` map if the new site uses something else.

### 2.2 Write the config

Create `src/configs/<yoursite>.js`:

```js
module.exports = {
    name: "yoursite",   // used by --website=yoursite and by the registry

    // Optional. Runs once per page, before any extraction.
    beforeExtract: async (page) => {
        const consent = page.locator("#cookie-accept-button-selector");
        if (await consent.count().catch(() => 0) > 0) {
            await consent.click({ timeout: 2000 }).catch(() => {});
        }
        await page.mouse.wheel(0, 2000).catch(() => {}); // trigger lazy-loaded images
        await page.waitForTimeout(300);
    },

    // Required. Ordered fallback lists — most specific/stable selector first.
    selectors: {
        title: ['[data-testid="product-title"]', "h1"],
        price: ['[data-testid="price"]'],
        description: ['[data-testid="description"]'],
        images: [".product-gallery img"],
    },

    // Optional. Normalizes a raw DOM/JSON-LD string into { value, currency }.
    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
```

### 2.3 Sizes, colors, and other extra fields

Beyond the fixed `name`/`brand`/`price`/`currency`/`sku`/`description`
shape, a config can declare:

- **`selectors.sizes` / `selectors.colors`** — reserved, multi-value fields.
  Unlike `title`/`price` (which stop at the first matching *element*), these
  collect the text of **every** matching element under the first selector
  that returns anything — e.g. every `<li>` in a size picker becomes one
  entry in the array.
- **`additionalFields`** — any other field a product page shows, keyed by
  whatever name you want (`material`, `availability`, `weight`, `fit`, ...).
  Each entry is either:
  - an array of selectors → single value, same fallback rule as `title`;
  - `{ selectors: [...], multiple: true }` → collects every match, same
    rule as `sizes`/`colors`.

```js
selectors: {
    // ...title/price/description/images...
    sizes: [".size-selector li"],
    colors: [".color-swatch-list li"],
},

additionalFields: {
    material: ['[data-testid="fabric"]'],                              // single value
    careInstructions: { selectors: [".care-list li"], multiple: true }, // multiple values
},
```

JSON-LD is still checked first automatically for `sizes`/`colors` — schema.org's
`Product.size`/`Product.color` (direct, or per-entry across a `hasVariant`
array) — so on a well-structured site the DOM selectors above may rarely
even get used. `additionalFields` has no JSON-LD equivalent; it's DOM-only.

The result lands in `product.json` as:

```json
"variants": { "sizes": ["S", "M", "L"], "colors": ["Black", "Navy"] },
"additionalInfo": { "material": "100% Cotton", "careInstructions": ["Machine wash cold", "Do not bleach"] }
```

with a matching trace entry per field (`trace.sizes`, `trace.colors`,
`trace["additionalInfo.material"]`, ...) — same rule as everything else:
check `trace` first when a field comes back empty. A site with no variants
at all doesn't need `sizes`/`colors`/`additionalFields` defined — they just
show up as empty arrays with a `"missing"` trace, same as any other omitted
selector.

### 2.4 Register it

In `src/configRegistry.js`:

```js
const yoursite = require("./configs/yoursite");
// ...
module.exports = [
    // ...existing entries...
    { test: (hostname) => hostname.includes("yoursite"), config: yoursite },
];
```

That's the only other file that changes. `domainRouter.js` and `scraper.js`
stay untouched — if you find yourself editing either of those for a new site,
something about the site's needs doesn't fit the existing hooks, and that's
worth a design conversation rather than a special case.

### 2.5 Test it in isolation

```bash
node src/index.js --headed --website=yoursite --limit=1 --force --input=input/yoursite-test.xlsx
```

(Make a tiny one-row test Excel first — don't run your new config against
the full sheet.)

Then open the resulting `output/yoursite/.../product.json` and check `trace`:

- Every `"success": true`? Good, move to a second and third product to make
  sure it's not a fluke of that one page's layout.
- Something `"success": false`? That field's selectors didn't match — go
  back to dev tools on that exact page, find the right selector, add it to
  the **front** of that field's array (don't just replace — keep the old one
  as a fallback in case a different page variant needs it).

### 2.6 Known-shaky spots specific to boat / levis / hm

The configs already in `src/configs/{boat,levis,hm}.js` are **best-effort
placeholders**, not verified against live pages. Before trusting them:

- Boat and Levi's are commonly Shopify-based — check for JSON-LD first, it
  likely does most of the work.
- H&M (and many EU retailers) show a mandatory cookie banner on first load —
  confirm the real button selector, the placeholder guess may be wrong.
- All three may show different markup by region/locale — if you're scraping
  a specific country's storefront, verify against that exact domain/locale,
  not a generic `.com` guess.

### 2.7 If a site needs its own request pacing

`DOMAIN_DELAY_MS`/`DOMAIN_DELAY_JITTER_MS` in `.env` currently apply
globally, to every host. If one site needs to be paced more conservatively
than the rest, the straightforward extension is:

1. Add an optional `rateLimit: { delayMs, jitterMs }` field to that site's config.
2. In `src/index.js`, when calling `rateLimiter.schedule(...)`, pass the
   config's override (falling back to the `.env` defaults when absent) —
   requires a small change to `DomainRateLimiter.schedule` in
   `src/utils/rateLimiter.js` to accept a per-call override instead of only
   constructor-level settings.

Not built yet since no site has needed it — mentioned here so it's a known,
localized extension point rather than something to work around by hand.

---

## Part 3 — Upload pipeline

Turns each scraped `product.json` into a campaign-ready payload, lets you
review/edit the fields the scraper can't know (program, gender, categories),
then sends the finished products to the real upload API. Four stages, each
its own command, each safe to stop and resume:

```text
scrape (Part 1)                already covered above
   │  output/<site>/<slug>/product.json
   ▼
1. transform   npm run transform        → upload.json draft next to each product.json
   ▼
2. review      npm run review           → http://localhost:4000, edit fields in a browser
   ▼
3. combine     npm run combine-uploads  → output/combined_uploads.json (optional — one file for everything)
   ▼
4. upload      npm run upload           → POSTs "reviewed" drafts to UPLOAD_API_URL
```

### 3.1 Step 1 — transform (`npm run transform`)

Reads every `output/<site>/<slug>/product.json` and writes an `upload.json`
draft next to it, mapping scraped fields into the upload schema. See
`src/transform/toUploadSchema.js` for the exact rules; the short version:

| upload.json field | Comes from | Notes |
|---|---|---|
| `name` | `product.name` | |
| `mrp` | `additionalInfo.mrp` | parsed to a number |
| `productPrice` | `product.price` | |
| `discount` | `additionalInfo.discountPercent` | parsed to a number, e.g. `"60% off"` → `60` |
| `rating` | — | random 4.0–5.0, generated once and kept (no real per-product rating is scraped) |
| `productDescription` / `additionalInformation` | `product.description` | same text in both |
| `vendorSku` | `product.sku` | |
| `productSizes` / `colour` | `variants.sizes` / `variants.colors` | |
| `image` / `subImages` | `images[]` URLs | first successfully-downloaded image is `image`, the rest are `subImages`; falls back to all found URLs if `--skip-images` was used during scraping |
| `program` / `gender` / `categories` / `vendorComment` | — | left blank — fill in during Step 2 |
| `toolType` / `campaignType` | — | fixed constants: `"storeIntegration"` / `"storeCampaign"` |

```bash
npm run transform                    # every site, every product
node src/transformCli.js --site=shopsy
node src/transformCli.js --force     # regenerate even where upload.json already exists
```

**Important:** without `--force`, an existing `upload.json` is left alone —
this is what makes it safe to re-run after a fresh scrape without wiping out
edits you already made in the review UI. Only use `--force` when you actually
want to discard those edits (e.g. a throwaway test).

### 3.2 Step 2 — review server (`npm run review`)

Starts a small Express app at `http://localhost:4000` (change the port with
`REVIEW_SERVER_PORT` in `.env`).

- **Dashboard (`/`)** — every product with an `upload.json`, thumbnail,
  price, current program/gender/categories, and status badge
  (`draft` / `reviewed` / `uploaded`).
- **Bulk-apply panel** — set `program` / `gender` / `categories` on many
  products at once:
  1. Tick the checkbox next to each product you want to change, in the
     table below the panel.
  2. Fill in whichever field(s) you want to set (leave the rest blank to
     not touch them).
  3. Click **Apply to selected**.
  - Nothing happens (and you'll see a red banner) if you click Apply with
    zero rows ticked — the fields only affect products you've selected.
- **Per-product page (`/product/<site>/<slug>`)** — click a product's name
  to open a full edit form (every field, including the preview gallery,
  price/MRP/discount, description) and save it individually.
- Both the per-product form and bulk-apply have a **"mark as reviewed"**
  checkbox — this flips `_meta.status` to `"reviewed"`, which is what makes
  a product eligible for Step 4 (upload). A product left at `"draft"` never
  gets uploaded, even if you've edited its fields.

Nothing here is a database — every save writes straight back to that
product's `upload.json` file on disk.

### 3.3 Step 3 — combine (optional, `npm run combine-uploads`)

Walks every `upload.json` and writes them all into one array file,
`output/combined_uploads.json` — the same idea as `output/combine.py`
(which does this for raw `product.json` files), just for the upload schema.
Useful for a manual handoff, a spot-check, or a direct bulk-insert into a
MongoDB `campaign` collection.

**By default the output is adapted to match the Mongoose `campaignSchema`**
(`src/transform/toCampaignDocument.js`) so the file can be fed straight to
something like `Campaign.insertMany(JSON.parse(fs.readFileSync("combined_uploads.json")))`:

- `gender` is lowercased and mapped to the schema's enum (`men`/`women`/`kids`)
  — a value that doesn't map to one of those (e.g. "Unisex", which the schema
  has no slot for) is **dropped**, not sent, so it can't fail insertion with
  an invalid-enum error. A warning is printed either way.
- `mrp`/`productPrice` are clamped to ≥ 0, `discount` to 0–100, `rating` to 0–5.
- `program` and each `categories` entry are checked against the
  24-hex-character ObjectId shape and a warning is printed if one doesn't
  look right (the file is still written — insertion just won't succeed for
  that document until it's fixed). `program` is required by the schema, so
  an empty one always warns.
- `url` is filled from the product's original source URL, and
  `isThirdParty: true` + `ThirdPartyCampaignDetails: { website, slug, sourceUrl }`
  are set — the schema has dedicated fields for exactly this (data pulled
  from a marketplace rather than entered by the vendor directly), which also
  keeps a trace back to the original scrape.
- `status` (schema enum `"in review" | "draft" | "public"`) is **left unset
  by default**, so Mongoose's own schema default (`"public"`) applies on
  insert. Since these are imported/scraped products, you may want them to
  land as drafts pending a manual publish instead — pass
  `--campaign-status=draft` (or `"in review"`) to set it explicitly on every
  document in this combine run.

```bash
npm run combine-uploads                            # Mongo-compatible (default)
node src/combineUploads.js --site=shopsy
node src/combineUploads.js --status=reviewed        # only products marked "reviewed" (or "uploaded")
node src/combineUploads.js --campaign-status=draft   # set campaignSchema status on every doc
node src/combineUploads.js --format=raw              # plain upload-schema dump instead (no Mongo adaptation)
node src/combineUploads.js --format=raw --strip-meta # raw mode only: drop internal _meta bookkeeping
node src/combineUploads.js --out=output/ready.json
```

This step is a convenience — Step 4 (the real uploader) reads `upload.json`
files directly and does **not** depend on `combined_uploads.json` existing;
it also does not go through the Mongo adaptation (it POSTs the plain
upload-schema payload to `UPLOAD_API_URL`, e.g. for a REST API rather than a
direct database insert).

### 3.4 Step 4 — uploader (`npm run upload`)

Sends every `"reviewed"` product's payload (the upload-schema fields, with
`_meta` stripped) to `UPLOAD_API_URL` as a POST request.

```env
# .env
UPLOAD_API_URL=https://your-api.example.com/products
UPLOAD_API_KEY=xxxxx
UPLOAD_AUTH_HEADER=Authorization   # default
UPLOAD_AUTH_SCHEME=Bearer          # default — produces "Authorization: Bearer xxxxx"
```

```bash
node src/uploader.js --dry-run              # print payloads, send nothing — use this until UPLOAD_API_URL is set
node src/uploader.js                        # send every "reviewed" product
node src/uploader.js --site=shopsy --limit=5
node src/uploader.js --force                # also re-send products already marked "uploaded"
```

On success a product's `upload.json` gets `_meta.status = "uploaded"` plus
`uploadedAt`/`lastResponse`. On failure the status is left as `"reviewed"`
(so the next run retries it) and `_meta.lastError`/`lastAttemptAt` record
what happened. Every attempt is also appended to `logs/YYYY-MM-DD.json`
alongside the scraper's own log entries (`stage: "upload"`).

Without `UPLOAD_API_URL` set, the uploader refuses to run at all (except
`--dry-run`) rather than failing confusingly partway through.

### 3.3b Alternative to Step 3's plain output — a file ready for direct MongoDB import (`npm run to-mongo-import` / `npm run import-to-mongo`)

`combined_uploads.json`'s `program`/`categories` are plain hex strings —
correct for `npm run upload-mongo` below (Mongoose casts them), but a plain
string imported via `mongoimport` or Compass's "Import Data" **stays a
string** in the database, because those tools don't know those fields are
supposed to be ObjectId — there's no schema in the loop to cast anything.
This step produces a second file with those fields rewritten into MongoDB
[Extended JSON](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/)'s
`{ "$oid": "..." }` form, which `mongoimport`/Compass *do* recognize and
import as a real `ObjectId`.

```bash
npm run to-mongo-import                                      # output/combined_uploads.json -> output/combined_uploads.mongoimport.json
node src/toMongoImportJson.js --file=output/other.json
node src/toMongoImportJson.js --out=output/ready-for-mongo.json
```

```json
// before (combined_uploads.json)
"program": "6a71cbd8a2689c1c3b57b74d"
// after (combined_uploads.mongoimport.json)
"program": { "$oid": "6a71cbd8a2689c1c3b57b74d" }
```

Any `program`/`categories` value that isn't a valid 24-hex-character id is
left as a plain string (not wrapped) and printed as a warning — importing it
as-is would just store the wrong type, so this makes that visible instead of
silently producing bad data. Then:

```bash
mongoimport --uri="<connection string>" --collection=campaigns --jsonArray --file=output/combined_uploads.mongoimport.json
```

**Copy-pasting into Atlas's Data Explorer / mongosh instead of `mongoimport`?**
Use `npm run import-to-mongo` instead — same conversion, but `program`/
`categories`/`userId`/`selectedAffiliates` come out as `ObjectId("...")`
shell-literal syntax (not `{ "$oid": "..." }`), because that's what a
mongosh `insertMany([...])` paste needs to actually evaluate as JS:

```bash
npm run import-to-mongo                                      # output/combined_uploads.json -> output/combined_uploads.atlas.js
```

```json
// program/categories/userId in output/combined_uploads.atlas.js
"userId": ObjectId("69171c93bcfa5a8226ceb284"),
"program": ObjectId("6a701e1762cb7e5da9887788"),
"categories": [ObjectId("68be966d8bb9294fe8f2cea5"), ObjectId("68be96578bb9294fe8f2ce9f")]
```

Paste the resulting array into Atlas's `>_MONGOSH` shell (or a local
`mongosh`) as `db.campaigns.insertMany(<paste the array>)`. This is
literally `node src/toMongoImportJson.js --shell` under the hood — `npm run
to-mongo-import` is the same script's Extended-JSON default, for
`mongoimport`/Compass instead.

Note `mongoimport` talks straight to the database — it does **not** run
your Mongoose schema's `required`/`enum`/`min`/`max` checks (there's no
Mongoose in that path at all). If you want those checks enforced before
anything is written, use `npm run upload-mongo` (§3.4b) instead, which goes
through the real model.

### 3.4b Alternative to Step 4 — insert straight into MongoDB (`npm run upload-mongo`)

If there's no REST API and products go directly into a MongoDB `campaign`
collection instead, use this in place of `npm run upload`. It reads
`output/combined_uploads.json` (Step 3's Mongo-format output — run
`npm run combine-uploads` first) and inserts through the **real Mongoose
model** (`src/models/Campaign.js`, copied verbatim from the backend's
`campaignSchema`), not a raw driver insert or `mongoimport`. That distinction
matters: going through the model is what turns a 24-hex-character string
like `"6a71cbd8a2689c1c3b57b74d"` into an actual BSON `ObjectId` for
`program`/`categories` before it's written — a plain JSON insert that
bypasses Mongoose leaves those fields as plain strings in the database,
which silently breaks `ref` population and any later "find by ObjectId"
query.

```env
# .env
MONGODB_URI=mongodb+srv://user:pass@cluster/dbname
```

```bash
node src/uploadToMongo.js --dry-run              # validate every document against the schema — connects to nothing
node src/uploadToMongo.js                        # validate + insert (needs MONGODB_URI)
node src/uploadToMongo.js --file=output/other.json
node src/uploadToMongo.js --limit=5
```

`--dry-run` is genuinely useful on its own, separate from actually
inserting: it runs full Mongoose schema validation (required fields, enum
values, the `program`/`categories` ObjectId cast) with **no database
connection at all**, so you can sanity-check `combined_uploads.json` before
you even have Mongo credentials. A document that fails prints the exact
Mongoose error, e.g.:

```text
✗ Cute Fellow ...: Cast to ObjectId failed for value "not-an-object-id" (type string) at path "program" ...
✗ Cute Fellow ...: `unisex` is not a valid enum value for path `gender`.
```

On a real (non-dry-run) insert, each successfully-inserted document's
source `upload.json` is updated the same way `npm run upload` does it —
`_meta.status = "uploaded"`, plus `uploadedAt` and `mongoId` — so the two
upload paths (REST API vs. direct-to-Mongo) never conflict or double-upload
the same product. Failures are logged to `logs/YYYY-MM-DD.json`
(`stage: "upload"`) and left safe to retry.

### 3.5 Common problems

| Symptom | Likely cause / fix |
|---|---|
| Dashboard says "No drafts found" | Run `npm run transform` first — the review server only reads `upload.json`, it never looks at `product.json` |
| Bulk-apply "refreshes and nothing happens" | No row checkboxes were ticked — the fields only apply to selected rows (see §3.2). A banner now says so either way |
| Edited a product but it still won't upload | Its status is still `"draft"` — tick "mark as reviewed" (per-product form or bulk-apply) and save |
| `node src/uploader.js` exits immediately with an error about `UPLOAD_API_URL` | Expected until you have the real endpoint — use `--dry-run` in the meantime |
| `node src/uploadToMongo.js` exits immediately with an error about `MONGODB_URI` | Same idea — set it in `.env`, or use `--dry-run`, which validates without connecting at all |
| Imported via `mongoimport`/Compass and `program`/`categories` show up as strings in the database, not ObjectId | You imported `combined_uploads.json` directly — run `npm run to-mongo-import` first (§3.3b) and import the `.mongoimport.json` file it produces instead |
| Pasted into Atlas's Data Explorer / mongosh and `program`/`categories`/`userId` show up as strings, not ObjectId | You pasted `combined_uploads.json` directly — run `npm run import-to-mongo` first (§3.3b) and paste the `.atlas.js` array it produces instead |
| `Cast to ObjectId failed ... at path "program"` (or `categories`) | That field isn't a real 24-hex-character Mongo ObjectId — `combine-uploads` already warns about this at combine time (§3.3), but `uploadToMongo.js --dry-run` is the authoritative check since it runs the actual schema |
| `` `unisex` is not a valid enum value for path `gender` `` (or similar) | The schema's `gender` enum is only `men`/`women`/`kids` — `combine-uploads` already drops unmapped values rather than sending them (§3.3), so seeing this means a document didn't go through that step, e.g. `combined_uploads.json` was hand-edited or built with `--format=raw` |
| Re-ran `npm run transform` and lost edits | You (or a script) passed `--force` — it intentionally overwrites existing `upload.json` files; omit `--force` for normal re-runs |
| `EADDRINUSE` starting the review server | A previous `npm run review` is still running in another terminal/background job — find and stop it (`tasklist` / `netstat -ano \| findstr :4000` on Windows) before starting a new one |
| Mongo `insertMany` rejects a document ("program" required, or a cast error on categories) | `combine-uploads` prints a `!` warning for exactly this at combine time — go back to the review UI and fill in a real ObjectId for `program`/`categories` on the products it flagged, then re-run combine |
| A product's `gender` is missing from `combined_uploads.json` even though you set it in the review UI | The value didn't map to the schema's enum (`men`/`women`/`kids` only — e.g. "Unisex" has no equivalent) — `combine-uploads` drops it rather than sending an invalid enum value, and prints a warning naming the product |
