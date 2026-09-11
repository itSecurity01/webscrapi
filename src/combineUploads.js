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
 * Usage:
 *   node src/combineUploads.js
 *   node src/combineUploads.js --site=shopsy
 *   node src/combineUploads.js --status=reviewed            (only "reviewed"/"uploaded" drafts)
 *   node src/combineUploads.js --campaign-status=draft       (set campaignSchema `status` on every doc;
 *                                                              omitted by default so Mongoose's own
 *                                                              default, "public", applies)
 *   node src/combineUploads.js --format=raw                 (skip the Mongo adaptation)
 *   node src/combineUploads.js --format=raw --strip-meta     (raw mode only: drop _meta bookkeeping)
 *   node src/combineUploads.js --out=output/ready.json       (write somewhere else)
 */
const fs = require("fs");
const path = require("path");
const { toCampaignDocument } = require("./transform/toCampaignDocument");

const OUTPUT_DIR = path.join(process.cwd(), "output");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { site: null, status: null, stripMeta: false, out: null, format: "mongo", campaignStatus: null };
    for (const arg of argv) {
        if (arg.startsWith("--site=")) args.site = arg.split("=")[1];
        else if (arg.startsWith("--status=")) args.status = arg.split("=")[1];
        else if (arg.startsWith("--out=")) args.out = arg.split("=")[1];
        else if (arg.startsWith("--format=")) args.format = arg.split("=")[1];
        else if (arg.startsWith("--campaign-status=")) args.campaignStatus = arg.split("=")[1];
        else if (arg === "--strip-meta") args.stripMeta = true;
    }
    return args;
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

function main() {
    const args = parseArgs();
    const scanRoot = args.site ? path.join(OUTPUT_DIR, args.site) : OUTPUT_DIR;
    const files = findUploadJsonFiles(scanRoot);

    console.log(`Found ${files.length} upload.json file(s). Output format: ${args.format}\n`);

    const products = [];
    let invalid = 0;
    let warningCount = 0;

    for (const filePath of files) {
        try {
            const draft = JSON.parse(fs.readFileSync(filePath, "utf8"));

            if (args.status && (!draft._meta || draft._meta.status !== args.status)) {
                continue;
            }

            if (args.format === "raw") {
                const record = args.stripMeta
                    ? Object.fromEntries(Object.entries(draft).filter(([key]) => key !== "_meta"))
                    : draft;
                products.push(record);
            } else {
                const { document, warnings } = toCampaignDocument(draft, { status: args.campaignStatus });
                if (warnings.length > 0) {
                    warningCount += warnings.length;
                    const label = draft._meta ? `${draft._meta.site}/${draft._meta.slug}` : filePath;
                    warnings.forEach(w => console.warn(`  ! ${label}: ${w}`));
                }
                products.push(document);
            }

            console.log(`✓ Added: ${filePath}`);
        } catch (error) {
            invalid++;
            console.error(`✗ Invalid JSON: ${filePath} (${error.message})`);
        }
    }

    const outFile = args.out
        ? path.resolve(process.cwd(), args.out)
        : path.join(OUTPUT_DIR, "combined_uploads.json");

    fs.writeFileSync(outFile, JSON.stringify(products, null, 2), "utf8");

    console.log("\n--------------------------------");
    console.log(`Total products: ${products.length}${invalid ? ` (${invalid} skipped, invalid JSON)` : ""}`);
    if (warningCount > 0) {
        console.log(`Warnings: ${warningCount} (see "!" lines above — these won't stop the file from being written, but may fail at insert time, e.g. an empty/invalid "program")`);
    }
    console.log(`Output file: ${outFile}`);
    console.log("--------------------------------");
}

main();
