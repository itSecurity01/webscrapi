# CLI Flag Reference

Every command in this project, and every `--flag`/env var it accepts. Flags
are passed after the script name; through `npm run`, put them after a bare
`--` (npm's separator), e.g.:

```bash
npm run start -- --headed --limit=5
```

Running `node src/...` directly, just pass flags normally (no `--` needed):

```bash
node src/index.js --headed --limit=5
```

---

## `npm start` / `npm run dry-run` — the scraper (`src/index.js`)

| Flag | Type | Default | Description |
|---|---|---|---|
| `--input=<path>` | string | `input/products.xlsx` (or `INPUT_XLSX` env) | Excel file to read product URLs from. |
| `--website=<name>` | string | none | Force every row to use this site's config, instead of auto-detecting per-URL. |
| `--limit=<n>` | number | unlimited | Only process the first `n` not-yet-done rows. |
| `--headed` | boolean | `false` | Launch Playwright with a visible browser window (default is headless). |
| `--dry-run` | boolean | `false` | Just print the URLs that would be scraped; scrapes nothing. (`npm run dry-run` is this flag baked in.) |
| `--force` | boolean | `false` | Re-scrape rows already marked done in `state/run.json`. |
| `--skip-images` | boolean | `false` (or `SKIP_IMAGES` env) | Record every found image URL in `product.json` but don't download any bytes. |

```bash
npm run start -- --limit=10 --skip-images
node src/index.js --website=tatacliq --headed --force
```

### Related environment variables (`.env`)
These aren't CLI flags but control the same run:

| Variable | Default | Description |
|---|---|---|
| `HEADLESS` | `true` | Alternate way to control headed/headless (see `.env.example`). |
| `NAV_TIMEOUT_MS` | `30000` | Per-page navigation timeout (ms), read by `src/scraper.js`. |
| `PRODUCT_CONCURRENCY` | `1` | How many product pages to scrape in parallel. |
| `IMAGE_CONCURRENCY` | `5` | How many images to download in parallel per product. |
| `MAX_IMAGES_PER_PRODUCT` | `10` | Cap on images downloaded per product; `0` = unlimited. `imagesFound` in `product.json` still records the real (uncapped) count. |
| `SKIP_IMAGES` | `false` | Env equivalent of `--skip-images`. |
| `DOMAIN_DELAY_MS` | `800` | Politeness delay between requests to the same domain (ms). |
| `DOMAIN_DELAY_JITTER_MS` | `400` | Random jitter added on top of `DOMAIN_DELAY_MS`. |
| `MAX_RETRIES` | `2` | Retries per product on failure. |

---

## `npm run check-duplicates` (`src/checkDuplicates.js`)

Read-only report of duplicate URL rows in the input Excel.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--input=<path>` | string | `input/products.xlsx` (or `INPUT_XLSX` env) | Excel file to check. |

```bash
node src/checkDuplicates.js --input=input/other.xlsx
```

---

## `npm run transform` (`src/transformCli.js`)

Batch-generates `upload.json` next to every scraped `product.json`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--site=<name>` | string | all sites | Only process products under `output/<name>/`. |
| `--force` | boolean | `false` | Regenerate `upload.json` even if one already exists (otherwise existing drafts — and any review edits already made to them — are left alone). |

```bash
node src/transformCli.js --site=tatacliq --force
```

---

## `npm run review` (`src/reviewServer.js`)

No CLI flags. Controlled entirely by env:

| Variable | Default | Description |
|---|---|---|
| `REVIEW_SERVER_PORT` | `4000` | Port the review UI listens on. |

---

## `npm run combine-uploads` (`src/combineUploads.js`)

Combines every `output/**/upload.json` into one array file.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--site=<name>` | string | all sites | Only combine drafts under `output/<name>/`. |
| `--status=<status>` | string | any status | Only include drafts whose `_meta.status` matches (e.g. `reviewed`, `uploaded`). |
| `--format=<mongo\|raw>` | string | `mongo` | `mongo` adapts each draft to the `campaignSchema` shape (gender/ObjectId normalization, adds `isThirdParty`/`url`/`ThirdPartyCampaignDetails`). `raw` dumps the upload-schema draft as-is, no adaptation. |
| `--strip-meta` | boolean | `false` | `--format=raw` only: drop the `_meta` bookkeeping block from each record. |
| `--campaign-status=<status>` | string | Mongoose default (`public`) | Sets the campaign document's `status` field on every doc (e.g. `draft`, `in review`, `public`). |
| `--out=<path>` | string | `output/combined_uploads.json` | Where to write the combined file. |

```bash
node src/combineUploads.js --site=tatacliq --status=reviewed
node src/combineUploads.js --format=raw --strip-meta --out=output/raw_dump.json
node src/combineUploads.js --campaign-status=draft
```

---

## `npm run upload` (`src/uploader.js`)

Sends "reviewed" drafts to the REST `UPLOAD_API_URL`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | boolean | `false` | Print each payload instead of sending it — works even with no `UPLOAD_API_URL` set. |
| `--site=<name>` | string | all sites | Only send drafts under `output/<name>/`. |
| `--limit=<n>` | number | unlimited | Only send the first `n` eligible drafts. |
| `--force` | boolean | `false` | Also re-send drafts already marked `"uploaded"` (normally only `"reviewed"` drafts are sent). |

```bash
node src/uploader.js --dry-run
node src/uploader.js --site=shopsy --limit=5
node src/uploader.js --force
```

### Related environment variables
| Variable | Default | Description |
|---|---|---|
| `UPLOAD_API_URL` | none (required unless `--dry-run`) | Endpoint that accepts one product payload per POST. |
| `UPLOAD_API_KEY` | none | Sent per `UPLOAD_AUTH_HEADER`/`UPLOAD_AUTH_SCHEME`. |
| `UPLOAD_AUTH_HEADER` | `Authorization` | Header name used to send the API key. |
| `UPLOAD_AUTH_SCHEME` | `Bearer` | Prefix before the key (set to empty string to send the raw key). |

---

## `npm run to-mongo-import` / `npm run import-to-mongo` (`src/toMongoImportJson.js`)

Converts `combined_uploads.json`'s plain-string `program`/`categories`/
`userId`/`selectedAffiliates` into a format a schema-less import actually
recognizes as `ObjectId`. Two output flavors, picked by `--shell`:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--shell` | boolean | `false` | Output `ObjectId("...")` shell-literal syntax (for pasting into mongosh / Atlas's Data Explorer `insertMany([...])`) instead of Extended JSON `{ "$oid": "..." }` (for `mongoimport`/Compass). `npm run import-to-mongo` is this flag baked in; `npm run to-mongo-import` is the default (no `--shell`). |
| `--file=<path>` | string | `output/combined_uploads.json` | Input file to convert. |
| `--out=<path>` | string | `<file>.mongoimport.json` (default mode) or `<file>.atlas.js` (`--shell` mode) | Where to write the converted file. |

```bash
npm run to-mongo-import                                   # -> output/combined_uploads.mongoimport.json ({"$oid": ...})
npm run import-to-mongo                                   # -> output/combined_uploads.atlas.js (ObjectId(...))
node src/toMongoImportJson.js --file=output/other.json --out=output/ready.json
node src/toMongoImportJson.js --shell --out=output/for_mongosh.js
```

---

## `npm run upload-mongo` (`src/uploadToMongo.js`)

Inserts `combined_uploads.json` straight into MongoDB through the real
Mongoose `Campaign` model (schema validation + real ObjectId casting).

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | boolean | `false` | Validate every document against the schema — connects to nothing, inserts nothing. |
| `--file=<path>` | string | `output/combined_uploads.json` | Input file to load documents from. |
| `--limit=<n>` | number | unlimited | Only process the first `n` documents. |

```bash
node src/uploadToMongo.js --dry-run
node src/uploadToMongo.js --file=output/other.json --limit=5
```

### Related environment variables
| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | none (required unless `--dry-run`) | MongoDB connection string. |
| `DEFAULT_CAMPAIGN_USER_ID` | none | Fallback `userId` (ObjectId) for drafts that don't already have one, applied in `toCampaignDocument.js`. |

---

## One-off cleanup scripts (`scripts/`)

Not wired into `package.json` — run directly with `node`.

### `scripts/cleanupColourField.js`
Blanks the `colour` field to `[]` on every existing `output/**/upload.json`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | boolean | `false` | Print what would change without writing any files. |

### `scripts/cleanupUserIdAndSizes.js`
Sets a missing `userId` to the default account id and blanks `productSizes`
to `[]` on every existing `upload.json`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | boolean | `false` | Print what would change without writing any files. |

```bash
node scripts/cleanupColourField.js --dry-run
node scripts/cleanupUserIdAndSizes.js
```

---

## No-flag commands

These have no CLI flags at all:

| Command | File |
|---|---|
| `npm run sample-excel` | `scripts/createSampleExcel.js` |
