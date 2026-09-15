require("dotenv").config();
const path = require("path");
const { chromium } = require("playwright");
const pLimit = require("p-limit");

const { parseCliArgs } = require("./cli");
const { readExcel } = require("./excelReader");
const { writeResultsBack } = require("./excelWriter");
const { getConfig } = require("./domainRouter");
const { scrapeProduct } = require("./scraper");
const { downloadImages } = require("./imageDownloader");
const { ensureProductFolder, saveProduct, saveScreenshot } = require("./storage");
const { RunState } = require("./runState");
const { DomainRateLimiter } = require("./utils/rateLimiter");
const logger = require("./utils/logger");

const PRODUCT_CONCURRENCY = parseInt(process.env.PRODUCT_CONCURRENCY || "2", 10);
const IMAGE_CONCURRENCY = parseInt(process.env.IMAGE_CONCURRENCY || "5", 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "2", 10);
const DOMAIN_DELAY_MS = parseInt(process.env.DOMAIN_DELAY_MS || "800", 10);
const DOMAIN_DELAY_JITTER_MS = parseInt(process.env.DOMAIN_DELAY_JITTER_MS || "400", 10);
// 0 (or unset) means unlimited. Some sites (boat's galleries showed 30 images
// on one product — every color variant's shots, all on one page) can return
// far more images than you actually want downloaded per product.
const MAX_IMAGES_PER_PRODUCT = parseInt(process.env.MAX_IMAGES_PER_PRODUCT || "0", 10);

// How long to hold a domain after it answers 429/503 with no Retry-After
// header. Doubles on each repeat hit for the same URL, capped at the max
// (0 = no cap; not recommended, a site can ask for a very long wait).
const THROTTLE_BACKOFF_MS = parseInt(process.env.THROTTLE_BACKOFF_MS || "60000", 10);
const THROTTLE_BACKOFF_MAX_MS = parseInt(process.env.THROTTLE_BACKOFF_MAX_MS || "300000", 10);
const THROTTLE_STATUSES = new Set([429, 503]);

function isThrottled(error) {
    return THROTTLE_STATUSES.has(error && error.status);
}

async function withRetry(fn, retries, { url, rateLimiter } = {}) {
    let lastError;
    let throttleHits = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt >= retries) break;

            if (isThrottled(error) && rateLimiter && url) {
                // The site said "too many requests". Retrying in 500ms is
                // what turns one blocked page into a blocked run, so pause the
                // whole domain: Retry-After if the site gave one, otherwise a
                // doubling backoff. The retry below re-enters
                // rateLimiter.schedule(), which honours the pause.
                throttleHits++;
                let waitMs = error.retryAfterMs || THROTTLE_BACKOFF_MS * 2 ** (throttleHits - 1);
                if (THROTTLE_BACKOFF_MAX_MS > 0) waitMs = Math.min(waitMs, THROTTLE_BACKOFF_MAX_MS);
                rateLimiter.pauseDomain(url, waitMs);
                console.log(`[throttle] HTTP ${error.status} from ${new URL(url).hostname} — pausing that domain for ${Math.round(waitMs / 1000)}s (retry ${attempt + 1}/${retries})`);
                continue;
            }

            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
    }
    throw lastError;
}

async function processRow(row, { context, config, rateLimiter, state, excelResults, args }) {
    const startedAt = Date.now();
    const page = await context.newPage();

    try {
        const raw = await withRetry(
            () => rateLimiter.schedule(row.url, () => scrapeProduct(page, row.url, config)),
            MAX_RETRIES,
            { url: row.url, rateLimiter }
        );

        const imagesFound = raw.imageUrls.length;
        const imageUrlsToDownload = MAX_IMAGES_PER_PRODUCT > 0
            ? raw.imageUrls.slice(0, MAX_IMAGES_PER_PRODUCT)
            : raw.imageUrls;

        const folder = ensureProductFolder(config.name, raw.product.name || row.url, row.url);

        // --skip-images / SKIP_IMAGES=true: keep every found URL on record (no
        // MAX_IMAGES_PER_PRODUCT cap — that cap only exists to bound download
        // cost) but never fetch the bytes or write files. Downstream (the
        // upload transform) reads image URLs straight from product.json, so
        // a local copy isn't required just to build an upload payload.
        const imageResults = args.skipImages
            ? raw.imageUrls.map(url => ({ url, path: null, success: false, hash: null, error: "skipped" }))
            : await downloadImages(imageUrlsToDownload, folder, {
                concurrency: IMAGE_CONCURRENCY,
                rateLimiter,
            });

        const product = {
            source: raw.source,
            product: raw.product,
            variants: raw.variants,
            additionalInfo: raw.additionalInfo,
            imagesFound,
            images: imageResults.map(img => ({
                url: img.url,
                path: img.path,
                success: img.success,
                hash: img.hash || null,
                error: img.error || null,
            })),
            trace: raw.trace,
            scrapedAt: raw.scrapedAt,
        };

        saveProduct(folder, product);

        logger.logSuccess({
            url: row.url,
            website: config.name,
            product: product.product.name,
            imageCount: imageResults.filter(i => i.success).length,
            imagesFound,
            durationMs: Date.now() - startedAt,
        });

        state.markDone(row.url);
        excelResults.set(row.url, { status: "done" });
        return true;
    } catch (error) {
        await saveScreenshot(page, config.name, row.url);
        logger.logFailure({ url: row.url, website: config.name, error });
        state.markFailed(row.url, error);
        excelResults.set(row.url, { status: "failed", error: error.message || String(error) });
        return false;
    } finally {
        await page.close().catch(() => {});
    }
}

async function main() {
    const args = parseCliArgs();
    const inputPath = path.resolve(process.cwd(), args.input);

    console.log(`Reading URLs from ${inputPath} ...`);
    const rows = await readExcel(inputPath);
    console.log(`Found ${rows.length} URL(s).`);

    if (args.dryRun) {
        rows.forEach((row, i) => console.log(`${i + 1}. ${row.url}${row.website ? ` (website: ${row.website})` : ""}`));
        return;
    }

    const state = new RunState();
    const rateLimiter = new DomainRateLimiter({ delayMs: DOMAIN_DELAY_MS, jitterMs: DOMAIN_DELAY_JITTER_MS });
    const excelResults = new Map();

    const browser = await chromium.launch({ channel: "chrome",
    headless: true, });
    const context = await browser.newContext();

    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log("\nShutting down gracefully...");
        state.save();
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        process.exit(1);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    const limit = pLimit(PRODUCT_CONCURRENCY);
    let processed = 0;
    let skippedAlreadyDone = 0;
    let skippedUnknown = 0;
    let succeeded = 0;
    let failed = 0;
    const runStart = Date.now();

    const tasks = rows.map(row => limit(async () => {
        if (shuttingDown) return;
        if (args.limit && processed >= args.limit) return;

        if (!args.force && state.isDone(row.url)) {
            skippedAlreadyDone++;
            return;
        }

        const config = getConfig(row.url, row.website);
        if (!config) {
            logger.logUnknownWebsite(row.url);
            excelResults.set(row.url, { status: "skipped", error: "no matching website config" });
            skippedUnknown++;
            return;
        }

        processed++;
        const ok = await processRow(row, { context, config, rateLimiter, state, excelResults, args });
        if (ok) succeeded++; else failed++;
    }));

    await Promise.all(tasks);

    if (!shuttingDown) {
        const runSummary = {
            runId: new Date().toISOString().replace(/[:.]/g, "-"),
            total: rows.length,
            succeeded,
            failed,
            skippedAlreadyDone,
            skippedUnknownWebsite: skippedUnknown,
            durationMs: Date.now() - runStart,
        };
        const summaryPath = logger.writeRunSummary(runSummary);
        console.log(`Run summary written to ${summaryPath}`);
        console.log(runSummary);

        try {
            await writeResultsBack(inputPath, excelResults);
        } catch (error) {
            console.warn(`Could not write results back to Excel: ${error.message}`);
        }

        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

if (require.main === module) {
    main().catch(async (error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
