/**
 * Combines every output/**\/upload.json draft into one array file, mirroring
 * output/combine.py (which does the same thing for product.json). Written
 * to output/combined_uploads.json by default.
 *
 * By default each entry is adapted to match the Mongoose `campaignSchema`
 * (see src/transform/toCampaignDocument.js) — field names/types/enums lined
 * up so the file can be fed straight to something like
 * `Campaign.insertMany(JSON.parse(fs.readFileSync("combined_uploads.json")))`.
 * Pass --format=raw to get the plain upload-schema dump instead (no
 * gender/ObjectId adaptation, no isThirdParty/url/ThirdPartyCampaignDetails).
 *
 * DEFAULT STATUS FILTER: drafts already marked `_meta.status === "uploaded"`
 * are excluded automatically (no flag needed) — without this, a product
 * exported via the mongosh-paste path (toMongoImportJson.js --shell /
 * `npm run import-to-mongo`, which has no way to mark drafts uploaded
 * itself — see markUploaded.js) would get re-combined into every future
 * export forever. Pass `--include-uploaded` to disable this and include
 * everything regardless of status, or `--status=X` for the older
 * exact-match behavior (only drafts whose status is EXACTLY X — this still
 * overrides the default "uploaded" exclusion entirely, so `--status=uploaded`
 * explicitly re-includes only the uploaded ones if that's genuinely what you
 * want).
 *
 * MANIFEST: alongside the output file, also writes a `.manifest.json` file
 * (e.g. output/combined_uploads.manifest.json) — the `{ site, slug }` of
 * every draft that went into this combine. That's what `markUploaded.js`
 * (`npm run mark-uploaded`) reads to flip those drafts to `_meta.status =
 * "uploaded"` once you've confirmed the export was actually pasted/imported
 * into Mongo successfully.
 *
 * Usage:
 *   node src/combineUploads.js
 *   node src/combineUploads.js --site=shopsy
 *   node src/combineUploads.js --status=reviewed            (only "reviewed" drafts, overrides the default uploaded-exclusion)
 *   node src/combineUploads.js --include-uploaded           (include everything, even already-"uploaded" drafts)
 *   node src/combineUploads.js --campaign-status=draft       (set campaignSchema `status` on every doc;
 *                                                              omitted by default so Mongoose's own
 *                                                              default, "public", applies)
 *   node src/combineUploads.js --format=raw                 (skip the Mongo adaptation)
 *   node src/combineUploads.js --format=raw --strip-meta     (raw mode only: drop _meta bookkeeping)
 *   node src/combineUploads.js --out=output/ready.json       (write somewhere else; manifest follows as output/ready.manifest.json)
 */
const fs = require("fs");
const path = require("path");
const { toCampaignDocument } = require("./transform/toCampaignDocument");

const OUTPUT_DIR = path.join(process.cwd(), "output");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { site: null, status: null, stripMeta: false, out: null, format: "mongo", campaignStatus: null, includeUploaded: false };
    for (const arg of argv) {
        if (arg.startsWith("--site=")) args.site = arg.split("=")[1];
        else if (arg.startsWith("--status=")) args.status = arg.split("=")[1];
        else if (arg.startsWith("--out=")) args.out = arg.split("=")[1];
        else if (arg.startsWith("--format=")) args.format = arg.split("=")[1];
        else if (arg.startsWith("--campaign-status=")) args.campaignStatus = arg.split("=")[1];
        else if (arg === "--strip-meta") args.stripMeta = true;
        else if (arg === "--include-uploaded") args.includeUploaded = true;
    }
    return args;
}

/**
 * True if `draft` should be included given --status/--include-uploaded.
 * See the module comment's "DEFAULT STATUS FILTER" section for the reasoning.
 */
function passesStatusFilter(draft, args) {
    if (args.status) return !!draft._meta && draft._meta.status === args.status;
    if (args.includeUploaded) return true;
    return !draft._meta || draft._meta.status !== "uploaded";
}

/** Recursively finds every upload.json under `dir` (mirrors combine.py's os.walk). */
function findUploadJsonFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findUploadJsonFiles(full));
        } else if (entry.isFile() && entry.name.toLowerCase() === "upload.json") {
            results.push(full);
        }
    }
    return results;
}

/**
 * Core of the combine step, factored out so src/exportForMongo.js (and,
 * later, the review server) can build the same combined document list
 * in-process — no child process, no intermediate file round-trip — instead
 * of duplicating this scan/filter/adapt logic. Pure aside from *reading*
 * each upload.json (same class of "pure" as excelReader.js's readExcel):
 * no files are written and nothing is printed here — callers that want
 * progress output pass `onFile(filePath, outcome)`, called once per file
 * with outcome `"added" | "excluded-uploaded" | "invalid"`.
 *
 * @returns {{ files: string[], products: object[], manifest: {site:string,slug:string}[],
 *             invalidFiles: {filePath:string, error:string}[],
 *             warnings: {label:string, message:string}[], excludedUploaded: number }}
 */
function buildCombinedDocuments(args, { onFile } = {}) {
    const scanRoot = args.site ? path.join(OUTPUT_DIR, args.site) : OUTPUT_DIR;
    const files = findUploadJsonFiles(scanRoot);

    const products = [];
    const manifest = [];
    const invalidFiles = [];
    const warnings = [];
    let excludedUploaded = 0;

    for (const filePath of files) {
        try {
            const draft = JSON.parse(fs.readFileSync(filePath, "utf8"));

            if (!passesStatusFilter(draft, args)) {
                if (!args.status && draft._meta && draft._meta.status === "uploaded") excludedUploaded++;
                if (onFile) onFile(filePath, "excluded-uploaded");
                continue;
            }

            if (draft._meta && draft._meta.site && draft._meta.slug) {
                manifest.push({ site: draft._meta.site, slug: draft._meta.slug });
            }

            if (args.format === "raw") {
                const record = args.stripMeta
                    ? Object.fromEntries(Object.entries(draft).filter(([key]) => key !== "_meta"))
                    : draft;
                products.push(record);
            } else {
                const { document, warnings: docWarnings } = toCampaignDocument(draft, { status: args.campaignStatus });
                if (docWarnings.length > 0) {
                    const label = draft._meta ? `${draft._meta.site}/${draft._meta.slug}` : filePath;
                    docWarnings.forEach(message => warnings.push({ label, message }));
                }
                products.push(document);
            }

            if (onFile) onFile(filePath, "added");
        } catch (error) {
            invalidFiles.push({ filePath, error: error.message });
            if (onFile) onFile(filePath, "invalid");
        }
    }

    return { files, products, manifest, invalidFiles, warnings, excludedUploaded };
}

/** Where combineUploads() (and exportForMongo.js) write the combined/manifest files for a given --out. */
function resolveOutputPaths(args) {
    const outFile = args.out
        ? path.resolve(process.cwd(), args.out)
        : path.join(OUTPUT_DIR, "combined_uploads.json");
    return { outFile, manifestFile: outFile.replace(/\.json$/i, ".manifest.json") };
}

function main() {
    const args = parseArgs();
    console.log(`Scanning for upload.json files. Output format: ${args.format}\n`);

    const result = buildCombinedDocuments(args, {
        onFile: (filePath, outcome) => {
            if (outcome === "added") console.log(`✓ Added: ${filePath}`);
            else if (outcome === "invalid") console.error(`✗ Invalid JSON: ${filePath}`);
        },
    });

    result.warnings.forEach(({ label, message }) => console.warn(`  ! ${label}: ${message}`));
    result.invalidFiles.forEach(({ filePath, error }) => console.error(`  (${filePath}: ${error})`));

    const { outFile, manifestFile } = resolveOutputPaths(args);
    fs.writeFileSync(outFile, JSON.stringify(result.products, null, 2), "utf8");
    fs.writeFileSync(manifestFile, JSON.stringify(result.manifest, null, 2), "utf8");

    console.log("\n--------------------------------");
    console.log(`Found ${result.files.length} upload.json file(s).`);
    console.log(`Total products: ${result.products.length}${result.invalidFiles.length ? ` (${result.invalidFiles.length} skipped, invalid JSON)` : ""}`);
    if (result.excludedUploaded > 0) {
        console.log(`Excluded: ${result.excludedUploaded} already-"uploaded" draft(s) (pass --include-uploaded to include them anyway)`);
    }
    if (result.warnings.length > 0) {
        console.log(`Warnings: ${result.warnings.length} (see "!" lines above — these won't stop the file from being written, but may fail at insert time, e.g. an empty/invalid "program")`);
    }
    console.log(`Output file: ${outFile}`);
    console.log(`Manifest file: ${manifestFile} (feed to "npm run mark-uploaded" once this export is actually in Mongo)`);
    console.log("--------------------------------");
}

if (require.main === module) main();

module.exports = { buildCombinedDocuments, resolveOutputPaths, passesStatusFilter, findUploadJsonFiles };
