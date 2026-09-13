/**
 * Marks every draft listed in a combine-uploads manifest as "uploaded".
 *
 * WHY THIS EXISTS: two of the three ways a product can leave this pipeline
 * already do this bookkeeping themselves — src/uploader.js (REST API) and
 * src/uploadToMongo.js (direct Mongoose insert) both set
 * `_meta.status = "uploaded"` the moment a product is actually sent/inserted.
 * The third path — src/toMongoImportJson.js's `--shell` mode (`npm run
 * import-to-mongo`), which produces the file you paste into Atlas's mongosh —
 * only ever touches the already-combined JSON file. It has no idea which
 * output/**\/upload.json drafts went into it, so it can't mark anything, and
 * there's no way to verify from here that a copy-paste into mongosh actually
 * succeeded. This script closes that gap as a deliberate, separate, manual
 * step: run it once you've confirmed the paste/import actually landed in
 * Mongo. Once marked, `npm run combine-uploads` stops re-including these
 * products by default (see its own module comment) — that's what actually
 * ends the "keep re-exporting the same batch forever" problem.
 *
 * Usage:
 *   node src/markUploaded.js                                    # reads output/combined_uploads.manifest.json
 *   node src/markUploaded.js --manifest=output/other.manifest.json
 *   node src/markUploaded.js --dry-run                          # preview only, writes nothing
 */
const fs = require("fs");
const path = require("path");
const store = require("./reviewServer/dataStore");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { manifest: "output/combined_uploads.manifest.json", dryRun: false };
    for (const arg of argv) {
        if (arg.startsWith("--manifest=")) args.manifest = arg.split("=")[1];
        else if (arg === "--dry-run") args.dryRun = true;
    }
    return args;
}

/**
 * Core of this script, factored out so the review server's "Mark as
 * uploaded" button (Feature 5) can call it directly. Throws if the
 * manifest file is missing (a usage error, not a normal outcome to
 * render) — callers decide how to surface that.
 *
 * @param {string} manifestPath - absolute or cwd-relative path
 * @returns {{ total:number, marked:number, failed:number,
 *             results: {site:string, slug:string, ok:boolean, error?:string}[] }}
 */
function markUploaded(manifestPath) {
    const resolved = path.resolve(process.cwd(), manifestPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(
            `Manifest not found: ${resolved}\n` +
            `Run "npm run combine-uploads" (or "npm run export-mongo") first — it writes this file alongside the combined output.`
        );
    }

    const entries = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (!Array.isArray(entries) || entries.length === 0) {
        return { total: 0, marked: 0, failed: 0, results: [] };
    }

    const bulkResults = store.bulkUpdate(entries, {}, { status: "uploaded" });

    let marked = 0;
    let failed = 0;
    const results = [];
    for (const result of bulkResults) {
        if (!result.ok) {
            failed++;
            results.push({ site: result.site, slug: result.slug, ok: false, error: result.error });
            continue;
        }

        // bulkUpdate/updateDraft only bump _meta.updatedAt and _meta.status —
        // set uploadedAt too, matching the convention uploader.js and
        // uploadToMongo.js already use, so a draft's _meta looks the same
        // regardless of which of the three upload paths touched it.
        const fresh = store.readDraft(result.site, result.slug);
        fresh._meta.uploadedAt = new Date().toISOString();
        store.writeDraft(result.site, result.slug, fresh);

        marked++;
        results.push({ site: result.site, slug: result.slug, ok: true });
    }

    return { total: entries.length, marked, failed, results };
}

function main() {
    const args = parseArgs();
    const manifestPath = path.resolve(process.cwd(), args.manifest);

    if (args.dryRun) {
        if (!fs.existsSync(manifestPath)) {
            console.error(`Manifest not found: ${manifestPath}`);
            process.exit(1);
        }
        const entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        console.log(`${entries.length} product(s) in manifest.`);
        console.log('--dry-run: would mark as "uploaded":');
        entries.forEach(({ site, slug }) => console.log(`  ${site}/${slug}`));
        return;
    }

    let result;
    try {
        result = markUploaded(manifestPath);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    console.log(`${result.total} product(s) in manifest.`);
    result.results.forEach(r => {
        console.log(r.ok ? `✓ ${r.site}/${r.slug}` : `✗ ${r.site}/${r.slug}: ${r.error}`);
    });

    console.log(`\nDone. marked=${result.marked} failed=${result.failed}`);
    if (result.failed > 0) {
        console.log('(failures usually mean the upload.json for that site/slug is missing or was moved/archived — check output/<site>/<slug>/)');
    }
}

if (require.main === module) main();

module.exports = { markUploaded };
