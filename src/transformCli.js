/**
 * Batch-runs the product.json -> upload.json transform over everything in
 * output/, writing an upload.json draft next to each product.json.
 *
 * Usage:
 *   node src/transformCli.js
 *   node src/transformCli.js --site=shopsy
 *   node src/transformCli.js --force   (re-generate even if upload.json already exists)
 *
 * Safe to re-run: existing upload.json files are left alone unless --force is
 * passed, so edits made later in the review UI (program/gender/categories,
 * vendorComment, etc.) are never clobbered by a re-scrape/re-transform.
 */
const fs = require("fs");
const path = require("path");
const { transformProduct } = require("./transform/toUploadSchema");

const OUTPUT_DIR = path.join(process.cwd(), "output");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { site: null, force: false };
    for (const arg of argv) {
        if (arg.startsWith("--site=")) args.site = arg.split("=")[1];
        else if (arg === "--force") args.force = true;
    }
    return args;
}

/** Yields { site, slug, productJsonPath, uploadJsonPath } for every scraped product folder. */
function* findProductFolders(siteFilter) {
    if (!fs.existsSync(OUTPUT_DIR)) return;

    const siteDirs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(site => !siteFilter || site === siteFilter);

    for (const site of siteDirs) {
        const siteDir = path.join(OUTPUT_DIR, site);
        const slugDirs = fs.readdirSync(siteDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const slug of slugDirs) {
            const folder = path.join(siteDir, slug);
            const productJsonPath = path.join(folder, "product.json");
            if (!fs.existsSync(productJsonPath)) continue;

            yield {
                site,
                slug,
                folder,
                productJsonPath,
                uploadJsonPath: path.join(folder, "upload.json"),
            };
        }
    }
}

/**
 * Core of this script, factored out so the review server can auto-run it
 * right after a browser-triggered scrape finishes (Feature 5), instead of
 * requiring a separate `npm run transform` in a terminal. No console
 * output here — callers that want progress pass `onProduct(site, slug,
 * outcome)`, called once per product folder with outcome
 * `"created" | "skipped" | "failed"`.
 *
 * @returns {{ created:number, skipped:number, failed:number, errors: {site:string, slug:string, error:string}[] }}
 */
function runTransform(args = {}, { onProduct } = {}) {
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    for (const { site, slug, folder, productJsonPath, uploadJsonPath } of findProductFolders(args.site)) {
        if (!args.force && fs.existsSync(uploadJsonPath)) {
            skipped++;
            if (onProduct) onProduct(site, slug, "skipped");
            continue;
        }

        try {
            const productJson = JSON.parse(fs.readFileSync(productJsonPath, "utf8"));
            const upload = transformProduct(productJson);
            const now = new Date().toISOString();

            const draft = {
                ...upload,
                _meta: {
                    site,
                    slug,
                    sourceUrl: productJson.source && productJson.source.url || null,
                    sourceFolder: folder,
                    status: "draft",
                    createdAt: now,
                    updatedAt: now,
                },
            };

            fs.writeFileSync(uploadJsonPath, JSON.stringify(draft, null, 2), "utf8");
            created++;
            if (onProduct) onProduct(site, slug, "created");
        } catch (error) {
            failed++;
            errors.push({ site, slug, error: error.message });
            if (onProduct) onProduct(site, slug, "failed");
        }
    }

    return { created, skipped, failed, errors };
}

function main() {
    const args = parseArgs();
    const result = runTransform(args, {
        onProduct: (site, slug, outcome) => {
            if (outcome === "created") console.log(`✓ ${site}/${slug}`);
        },
    });

    result.errors.forEach(({ site, slug, error }) => console.error(`✗ ${site}/${slug}: ${error}`));

    console.log(`\nDone. created=${result.created} skipped=${result.skipped} failed=${result.failed}`);
    if (result.skipped > 0) console.log(`(${result.skipped} already had an upload.json — pass --force to regenerate)`);
}

if (require.main === module) main();

module.exports = { runTransform };
