# Ecommerce Product Web Scraper — Implementation Plan (v2)

Changes from v1 are marked **[NEW]**. Original structure is preserved where it was already solid (fallback selectors, trace/lineage, phased build-up).

## 1. Goal

Build a JavaScript + Playwright scraper that:

1. Reads product URLs from an Excel file.
2. Detects which website/domain each URL belongs to (with manual override).
3. Uses website-specific selector/configuration files, registered declaratively.
4. Opens the product page with Playwright.
5. Extracts product information (JSON-LD → API → DOM, with per-field parsing).
6. Extracts product image URLs (including lazy-loaded content).
7. Downloads images in parallel with a controlled concurrency limit **and validates them**.
8. Creates a folder for every product using a slugified, collision-safe, Windows-path-safe name.
9. Saves a `product.json` file inside each product folder, **validated against a schema**.
10. Stores both the original image URL and the local full system path.
11. Keeps a trace of where every field was extracted from.
12. Saves screenshots/traces when scraping fails.
13. Supports adding new websites without rewriting the scraper engine — **registering one file**.
14. **[NEW]** Is resumable: re-running after a crash or interruption skips completed products and retries only failures.
15. **[NEW]** Is polite: per-domain request pacing, not just concurrency caps.

---

## 2. Recommended Architecture

```text
                         products.xlsx
                              |
                              v
                      +---------------+
                      | Excel Reader  |
                      +-------+-------+
                              |
                              v
                      +---------------+
                      | URL Validator |
                      +-------+-------+
                              |
                              v
                      +---------------+
                      | Domain Router |  <-- reads config registry (declarative list),
                      +-------+-------+      explicit "website" column overrides detection
                              |
            +-----------------+-----------------+
            |                 |                 |
            v                 v                 v
        BOAT CONFIG       LEVIS CONFIG       HM CONFIG
     (selectors +       (selectors +       (selectors +
      parsers +          parsers +          parsers +
      beforeExtract)     beforeExtract)     beforeExtract)
            |                 |                 |
            +-----------------+-----------------+
                              |
                              v
                      +---------------+
                      |  Run State /  |  <-- [NEW] skip if already done,
                      |  Resume Check |      per-domain rate limiter
                      +-------+-------+
                              |
                              v
                      +---------------+
                      |  Playwright   |
                      |    Engine     |
                      +-------+-------+
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
           JSON-LD           API             DOM
        (@graph/array         |          (after beforeExtract:
         aware)                |           dismiss cookie banner,
              |               |           scroll for lazy images)
              +---------------+---------------+
                              |
                              v
                        Normalize Data
                    (currency/price parsing,
                     per-field custom parsers)
                              |
                  +-----------+-----------+
                  |                       |
                  v                       v
            Product JSON            Image URLs
          (schema-validated)              |
                                          v
                                  Parallel Downloads
                                (validated: content-type,
                                 non-empty, dedup by hash)
                                          |
                                          v
                                  Product Folder
                              (collision-safe slug,
                               path-length safe)
                                          |
                                          v
                              Write run state + log
                              (so a retry knows what's done)
```

---

## 3. Project Structure

```text
product-scraper/
│
├── input/
│   └── products.xlsx
│
├── src/
│   ├── index.js
│   ├── cli.js                  # [NEW] --limit, --website, --headed, --dry-run, --force
│   ├── scraper.js
│   ├── excelReader.js
│   ├── excelWriter.js          # [NEW] writes status/scrapedAt back into the sheet
│   ├── imageDownloader.js
│   ├── storage.js
│   ├── domainRouter.js
│   ├── configRegistry.js       # [NEW] declarative {test, config} list — the only file touched to add a site
│   ├── runState.js             # [NEW] resumability: what's done, what failed
│   ├── rateLimiter.js          # [NEW] per-domain pacing (delay + jitter), on top of p-limit concurrency
│   ├── validators.js           # [NEW] zod/ajv schema for product.json before writing
│   │
│   ├── configs/
│   │   ├── boat.js
│   │   ├── levis.js
│   │   └── hm.js
│   │
│   └── utils/
│       ├── slugify.js          # collision-safe (-2, -3…), Windows path-length aware
│       ├── logger.js
│       ├── url.js
│       └── price.js            # [NEW] currency/locale-aware price parsing
│
├── output/
├── logs/
├── traces/
├── screenshots/
├── state/                       # [NEW] state/run.json — resumability checkpoint
├── package.json
├── .env
└── PLAN.md
```

---

## 4. Excel Input

| url | website | status |
|---|---|---|
| URL | boat (optional) | pending |

- `website` column is **optional**. If present and non-empty, it **overrides** hostname auto-detection — useful for regional domains or testing a config against a different site.
- **[NEW]** `status` (and a `scrapedAt` timestamp column) get written back by `excelWriter.js` after each row completes, so the source file itself shows progress and a re-run can skip rows already marked `done` unless `--force` is passed.

---

## 5. Technology Stack

```bash
npm init -y
npm install playwright exceljs axios dotenv p-limit zod
npx playwright install chromium
```

`zod` **[NEW]** — validates the shape of extracted product data before it's written to disk, so a broken selector produces a loud validation error instead of a silently malformed `product.json`.

---

## 6. Domain Router + Config Registry **[REWORKED]**

Do not grow an `if/else` chain in `domainRouter.js` forever — every new site would require editing the core router, which defeats the "add a site without touching the engine" goal.

`src/configRegistry.js`:

```js
const boat = require("./configs/boat");
const levis = require("./configs/levis");
const hm = require("./configs/hm");

// Adding a new site = one new entry here + one new config file. Nothing else changes.
module.exports = [
    { test: hostname => hostname.includes("boat"), config: boat },
    { test: hostname => hostname.includes("levi"),  config: levis },
    { test: hostname => hostname.includes("hm.com"), config: hm },
];
```

`src/domainRouter.js`:

```js
const registry = require("./configRegistry");

function getConfig(url, explicitWebsite) {
    if (explicitWebsite) {
        const match = registry.find(r => r.config.name === explicitWebsite);
        if (match) return match.config;
    }

    const hostname = new URL(url).hostname.toLowerCase();
    const match = registry.find(r => r.test(hostname));
    return match ? match.config : null;
}

module.exports = { getConfig };
```

---

## 7. Website Configuration **[EXPANDED]**

Selectors alone aren't enough for real sites. Each config can optionally provide a `parse` function per field and a `beforeExtract` hook:

```js
module.exports = {
    name: "boat",

    // Runs before any extraction — dismiss cookie/consent banners,
    // scroll to trigger lazy-loaded gallery images, click "select variant" if needed.
    beforeExtract: async (page) => {
        const consent = page.locator('#consent-accept');
        if (await consent.count() > 0) await consent.click().catch(() => {});
        await page.mouse.wheel(0, 2000); // trigger lazy-loaded images
    },

    selectors: {
        title: ['[data-testid="product-title"]', 'h1.product-title', 'h1'],
        price: ['[data-testid="price"]', '.product-price'],
        description: ['.product-description', '[data-testid="description"]'],
        images: ['.product-gallery img', '.product-image img'],
    },

    // Optional per-field normalization — e.g. "₹1,499.00" -> { value: 1499, currency: "INR" }
    parse: {
        price: (raw) => require("../utils/price").parse(raw),
    },
};
```

The core engine calls `config.beforeExtract?.(page)` once, then runs fallback-selector extraction, then applies `config.parse?.[field]?.(rawValue)` if defined. Sites without special needs simply omit `beforeExtract`/`parse` — behavior is identical to v1.

---

## 8. Selector Fallback System

Unchanged from v1 — try selectors in order, record which one worked.

```js
async function extractText(page, selectors) {
    for (const selector of selectors) {
        const element = page.locator(selector).first();
        if (await element.count() > 0) {
            const text = await element.textContent();
            if (text && text.trim()) {
                return { value: text.trim(), selector };
            }
        }
    }
    return { value: null, selector: null };
}
```

---

## 9. Selector Trace / Data Lineage

Unchanged from v1 — every field records `{ field, source, selector/path, value }`. This is one of the strongest parts of the original plan; keep it as-is.

---

## 10. Product Data Extraction Priority

```text
1. JSON-LD (graph/array aware — see §11)
2. Public browser-loaded product API
3. DOM selectors (after beforeExtract hook runs)
4. Fallback selectors
5. Mark field as missing
```

---

## 11. JSON-LD Extraction **[HARDENED]**

Real-world JSON-LD is often wrapped in `@graph` or is an array of typed nodes — a flat "assume it's a Product object" read will silently miss data on many sites.

```js
function findProductNodes(data) {
    const nodes = [];
    const candidates = Array.isArray(data) ? data
        : Array.isArray(data["@graph"]) ? data["@graph"]
        : [data];

    for (const node of candidates) {
        const type = node["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (isProduct) nodes.push(node);
    }
    return nodes;
}

const jsonLdBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();

for (const block of jsonLdBlocks) {
    try {
        const data = JSON.parse(block);
        for (const product of findProductNodes(data)) {
            // extract name / brand / image / sku / offers.price / offers.priceCurrency / aggregateRating
        }
    } catch {
        // ignore invalid JSON-LD for this block, keep checking others
    }
}
```

---

## 12. API / Network Inspection

Unchanged from v1 — monitor `page.on("response", ...)` for `/api/` calls, prefer structured API data over DOM scraping when found.

Reaffirming rule 36.12: do not attempt to bypass authentication, access controls, CAPTCHAs, robots restrictions, or other anti-bot/security controls.

---

## 13. Image Extraction

Unchanged extraction approach (`src`, `data-src`, `srcset`), but now runs **after** `config.beforeExtract` has scrolled/triggered lazy loading, so images that only populate on scroll are actually present in the DOM when captured.

---

## 14. Image Deduplication & Filtering **[HARDENED]**

```js
const uniqueImages = [...new Set(imageUrls)];
```

URL-based dedup misses CDN-resized duplicates (same photo, different query params for size). **[NEW]** After download, also dedup by content hash (e.g. sha1 of the file bytes) so `image.jpg?w=200` and `image.jpg?w=1200` served as the same picture don't both get kept as "different" images unless you specifically want multiple resolutions.

Still filter icons/logos/tracking pixels/placeholders/very small images — prefer website-specific image selectors over scraping every `<img>` on the page.

---

## 15. Product Folder **[HARDENED FOR WINDOWS]**

```js
function slugify(name, maxLength = 80) {
    let slug = name
        .trim()
        .normalize("NFKD").replace(/[\u0300-\u036f]/g, "") // strip accents
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")             // strip Windows-illegal chars
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .toLowerCase();

    if (slug.length > maxLength) slug = slug.slice(0, maxLength);
    return slug;
}
```

**[NEW]** Windows paths can hit the ~260-char limit once you nest `output/<website>/<product-slug>/<image>.jpg`. Cap the slug length and account for the folder nesting depth when choosing `maxLength`.

**[NEW]** Collision handling must be real code, not just an example — check if the target folder already exists (for a *different* source URL) and increment a numeric suffix:

```js
function resolveUniqueFolder(basePath) {
    let candidate = basePath;
    let n = 2;
    while (fs.existsSync(candidate)) {
        candidate = `${basePath}-${n}`;
        n++;
    }
    return candidate;
}
```

---

## 16. Duplicate Product Names Across Websites

Unchanged — use the website-based folder structure (`output/<website>/<product-slug>/`) as the default; it sidesteps most collisions before the numeric-suffix logic in §15 is even needed.

---

## 17. Image Downloading **[HARDENED]**

Still use `p-limit` for bounded concurrency (max ~5 concurrent), but add:

- **[NEW] Per-domain rate limiting**, separate from concurrency — a delay + jitter between requests to the *same* host, so downloads stay polite even if concurrency allows bursts.
- **[NEW] Validation after download** — check `Content-Type` starts with `image/`, check the file isn't 0 bytes, and treat a non-2xx or HTML-error-page response as a failure to retry, not a false success.

```js
const limit = pLimit(5);
const domainLimiter = require("./utils/rateLimiter"); // per-host delay/jitter

const results = await Promise.all(
    imageUrls.map((url, index) =>
        limit(() => domainLimiter.schedule(url, () => downloadImage(url, index)))
    )
);
```

---

## 18. Image JSON Structure

Unchanged — keep both `url` and local `path` per image (see §19 for full shape).

---

## 19. Final Product JSON **[VALIDATED]**

Same shape as v1, but now passed through a schema (`zod`) before being written, and includes explicit success flags per field:

```json
{
    "source": { "website": "boat", "url": "https://example.com/product" },
    "product": {
        "name": "boAt Rockerz 450",
        "brand": "boAt",
        "price": 1499,
        "currency": "INR",
        "sku": "123456",
        "description": "Product description..."
    },
    "variants": {
        "sizes": [],
        "colors": ["Black", "Blue"]
    },
    "additionalInfo": {
        "warranty": "1 year",
        "batteryLife": "70 hours"
    },
    "images": [
        { "url": "https://example.com/image1.jpg", "path": "C:\\product-scraper\\output\\boat\\boAt-Rockerz-450\\01.jpg" }
    ],
    "trace": {
        "title": { "source": "dom", "selector": "h1.product-title", "success": true },
        "price": { "source": "json-ld", "path": "offers.price", "success": true },
        "images": { "source": "dom", "selector": ".product-gallery img", "success": true },
        "colors": { "source": "dom", "selector": ".variant-color-swatch", "success": true },
        "additionalInfo.warranty": { "source": "dom", "selector": "[data-testid=\"warranty\"]", "success": true }
    },
    "scrapedAt": "2026-09-10T15:30:00Z"
}
```

**[NEW]** `variants` (`sizes`/`colors`, multi-value) and `additionalInfo`
(arbitrary site-specific fields, single- or multi-value) are optional per
config — a config that doesn't define them simply produces empty
arrays/no keys, with a `"missing"` trace entry. See `USAGE_GUIDE.md` §2.3
for how to declare them in a config.

If schema validation fails, the product is logged as `status: "failed"` with the validation error rather than written as a half-formed file.

---

## 20. Playwright Tracing

Unchanged — enable tracing for failed/suspicious pages only, not for every successful product, to avoid huge trace volume.

---

## 21. Failure Screenshots

Unchanged — `screenshots/<website>/failed-<slug>.png` on extraction failure.

---

## 22. Logging **[EXTENDED]**

Daily per-record logs as in v1, plus **[NEW] a run summary** written once at the end of each run:

```json
{
    "runId": "2026-09-10T15-00-00",
    "total": 120,
    "succeeded": 112,
    "failed": 8,
    "skippedAlreadyDone": 30,
    "failedUrls": ["https://...", "https://..."],
    "durationMs": 934210
}
```

This makes batch runs auditable without grepping through per-record logs.

---

## 23. Resumability & State **[NEW SECTION]**

`state/run.json` (or the Excel `status` column, kept in sync) tracks, per URL: `pending | done | failed`, `scrapedAt`, and last error.

- On startup, load state; skip URLs marked `done` unless `--force`.
- Retry `failed` URLs by default; a `--retry-count` env/flag caps how many times a URL is retried across runs before being left as permanently failed.
- On graceful shutdown (SIGINT/SIGTERM), flush current state and close the browser cleanly rather than leaving a half-written state file or orphaned Chromium process.

---

## 24. Main Scraper Flow **[UPDATED]**

```js
async function main() {
    const args = parseCliArgs();               // --limit, --website, --headed, --dry-run, --force
    const rows = await readExcel();
    const state = await loadRunState();

    const browser = await chromium.launch({ headless: !args.headed });
    const context = await browser.newContext();

    let processed = 0;

    for (const row of rows) {
        if (args.limit && processed >= args.limit) break;
        if (!args.force && state.isDone(row.url)) continue;

        const config = getConfig(row.url, row.website);
        if (!config) { logUnknownWebsite(row.url); continue; }

        await domainLimiter.wait(row.url); // [NEW] per-domain pacing

        const page = await context.newPage();
        try {
            const product = await withRetry(() => scrapeProduct(page, row.url, config), { retries: 2 });
            const imageResults = await downloadImages(product.images);
            product.images = imageResults;

            validateProductSchema(product); // throws on bad shape
            await saveProduct(product);
            await state.markDone(row.url);
        } catch (error) {
            await saveScreenshot(page, row.url);
            logError(row.url, error);
            await state.markFailed(row.url, error);
        } finally {
            await page.close();
            processed++;
        }
    }

    await writeRunSummary(state);
    await browser.close();
}

process.on("SIGINT", async () => { await flushStateAndExit(); }); // [NEW] graceful shutdown
```

Keep each responsibility in its own module — do not collapse this back into one file.

---

## 25. Execution Plan — Phase 1: Project Setup

Unchanged from v1, plus create the `state/` folder:

```bash
mkdir input src src/configs src/utils output logs traces screenshots state
npm init -y
npm install playwright exceljs axios dotenv p-limit zod
npx playwright install chromium
```

---

## 26. Phase 2 — Excel Reader

Unchanged. **[NEW]** Build the `--dry-run` CLI flag here rather than as throwaway `console.log` — you'll reuse it for every later phase.

---

## 27. Phase 3 — One Website

Unchanged (start with BOAT only). **[NEW]** Include the `beforeExtract` hook and per-field `parse` function from day one for this first site, even if trivial — it's much cheaper to establish the pattern on site #1 than to retrofit it onto three configs later.

---

## 28. Phase 4 — Product Folder

Unchanged, plus: implement the real collision-safe `resolveUniqueFolder` (§15) now, not as a "later" item — it's cheap and avoids silent overwrites during early testing with repeated runs.

---

## 29. Phase 5 — Trace System

Unchanged.

---

## 30. Phase 6 — Failure Handling **[EXPANDED]**

```text
1. Log error
2. Save screenshot
3. Save failed URL to run state (not just the log)
4. Retry up to N times across runs
5. Continue with next URL
```

---

## 31. Phase 7 — Add More Websites

Unchanged — BOAT → Levi's → H&M, each via the config registry (§6), engine untouched.

---

## 32. Phase 8 — Concurrency & Resumability **[MERGED]**

Only after sequential scraping is reliable:

```text
Product concurrency = 3
Image concurrency   = 5
Per-domain request delay = configurable, e.g. 500ms–1500ms + jitter
```

Bring in resumability (§23) at this phase too, since concurrent runs make "what's already done" bookkeeping more important, not less.

---

## 33. Definition of Done **[EXTENDED]**

Everything from v1, plus:

```text
[✓] Reads URLs from Excel, with optional website-column override
[✓] Adding a site = one config file + one registry entry, zero engine edits
[✓] Re-running after a crash skips completed products
[✓] Failed products are retried with backoff, not just logged
[✓] Per-domain request pacing exists, separate from concurrency limits
[✓] Downloaded images are validated (content-type, non-empty)
[✓] product.json is schema-validated before being written
[✓] Folder names are collision-safe and Windows-path-length safe
[✓] A run produces a summary (succeeded/failed/skipped counts)
[✓] Ctrl+C shuts down cleanly without orphaned browser processes
```

(Original v1 checklist items — Excel reading, domain detection, JSON-LD priority, image downloads, trace, screenshots, logs, continuing after failures — all still apply.)

---

## 34. Practical Rules

Same as v1 (stable selectors over XPath, fallbacks, prefer JSON-LD, keep site logic out of the core engine, limit concurrency, screenshot failures, trace everything, never stop the whole run for one failure), plus:

13. **[NEW]** Rate-limit per domain, not just concurrency — politeness is a request-pacing property, not just a "how many at once" property.
14. **[NEW]** Treat the config registry as the only file that changes when adding a site — if you find yourself editing `domainRouter.js` or `scraper.js` for a new site, the abstraction has leaked.
15. Respect the target websites' terms, robots rules, rate limits, and applicable laws. Do not bypass CAPTCHAs, authentication, or anti-bot protections.

---

## 35. First Milestone

Same target as v1 — one real BOAT product producing `output/boat/Product-Name/{01.jpg, 02.jpg, product.json}` — but now built on top of: config registry, `beforeExtract` hook, collision-safe folder naming, and schema-validated JSON from the start, so later sites and later phases don't require revisiting site #1's foundations.
