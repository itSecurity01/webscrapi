/**
 * One command for what used to be two: `npm run combine-uploads` followed
 * by `npm run import-to-mongo`. Builds the combined document list
 * in-process (src/combineUploads.js's buildCombinedDocuments()) and feeds
 * it straight into the ObjectId conversion (src/toMongoImportJson.js's
 * convertForMongoImport()) — no child process, no intermediate file read —
 * then writes all three files a full export needs:
 *
 *   output/combined_uploads.json            (plain-string ids, for reference / `npm run upload-mongo`)
 *   output/combined_uploads.manifest.json   ({ site, slug } of everything included — feed to `npm run mark-uploaded`)
 *   output/combined_uploads.atlas.js        (ObjectId("...") shell syntax — paste into mongosh)
 *
 * Defaults to the shell/mongosh format (`.atlas.js`) since that's this
 * project's actual export path; pass --json for Extended JSON
 * (`.mongoimport.json`, for `mongoimport`/Compass instead).
 *
 * Same include/exclude rules as combineUploads.js (see its module comment):
 * drafts already marked `_meta.status === "uploaded"` are skipped by
 * default.
 *
 * Usage:
 *   node src/exportForMongo.js
 *   node src/exportForMongo.js --site=shopsy
 *   node src/exportForMongo.js --json                        (Extended JSON instead of shell syntax)
 *   node src/exportForMongo.js --include-uploaded
 *   node src/exportForMongo.js --status=reviewed
 *   node src/exportForMongo.js --campaign-status=draft
 *   node src/exportForMongo.js --out=output/batch1.json       (batch1.json / batch1.manifest.json / batch1.atlas.js)
 */
const fs = require("fs");
const { buildCombinedDocuments, resolveOutputPaths } = require("./combineUploads");
const { convertForMongoImport } = require("./toMongoImportJson");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { site: null, status: null, out: null, campaignStatus: null, includeUploaded: false, json: false };
    for (const arg of argv) {
        if (arg.startsWith("--site=")) args.site = arg.split("=")[1];
        else if (arg.startsWith("--status=")) args.status = arg.split("=")[1];
        else if (arg.startsWith("--out=")) args.out = arg.split("=")[1];
        else if (arg.startsWith("--campaign-status=")) args.campaignStatus = arg.split("=")[1];
        else if (arg === "--include-uploaded") args.includeUploaded = true;
        else if (arg === "--json") args.json = true;
    }
    return args;
}

/**
 * Runs the full combine + convert pipeline and writes all three files.
 * Exported so the Feature 5 "Generate Mongo Import" button can call this
 * directly instead of shelling out. No console output here — callers that
 * want progress printed pass `onFile` (same signature as
 * buildCombinedDocuments()'s).
 *
 * @returns {{ outFile, manifestFile, mongoFile, productCount, manifestCount,
 *             invalidFiles, warnings, excludedUploaded }}
 */
function exportForMongo(args, { onFile } = {}) {
    const combineArgs = { site: args.site, status: args.status, out: args.out, format: "mongo", campaignStatus: args.campaignStatus, includeUploaded: args.includeUploaded };
    const combined = buildCombinedDocuments(combineArgs, { onFile });
    const { converted, warnings: conversionWarnings, fileContents } = convertForMongoImport(combined.products, { shell: !args.json });

    const { outFile, manifestFile } = resolveOutputPaths(combineArgs);
    const mongoFile = outFile.replace(/\.json$/i, args.json ? ".mongoimport.json" : ".atlas.js");

    fs.writeFileSync(outFile, JSON.stringify(combined.products, null, 2), "utf8");
    fs.writeFileSync(manifestFile, JSON.stringify(combined.manifest, null, 2), "utf8");
    fs.writeFileSync(mongoFile, fileContents, "utf8");

    return {
        outFile,
        manifestFile,
        mongoFile,
        productCount: converted.length,
        manifestCount: combined.manifest.length,
        invalidFiles: combined.invalidFiles,
        warnings: [...combined.warnings.map(w => `${w.label}: ${w.message}`), ...conversionWarnings],
        excludedUploaded: combined.excludedUploaded,
    };
}

function main() {
    const args = parseArgs();
    console.log(`Scanning for upload.json files...\n`);

    const result = exportForMongo(args, {
        onFile: (filePath, outcome) => {
            if (outcome === "added") console.log(`✓ Added: ${filePath}`);
            else if (outcome === "invalid") console.error(`✗ Invalid JSON: ${filePath}`);
        },
    });

    console.log("\n--------------------------------");
    console.log(`Total products: ${result.productCount}${result.invalidFiles.length ? ` (${result.invalidFiles.length} skipped, invalid JSON)` : ""}`);
    if (result.excludedUploaded > 0) {
        console.log(`Excluded: ${result.excludedUploaded} already-"uploaded" draft(s) (pass --include-uploaded to include them anyway)`);
    }
    if (result.warnings.length > 0) {
        console.log(`\nWarnings (${result.warnings.length}):`);
        result.warnings.forEach(w => console.log(`  ! ${w}`));
    }
    console.log(`\nCombined file:  ${result.outFile}`);
    console.log(`Manifest file:  ${result.manifestFile}  (feed to "npm run mark-uploaded" once this is actually in Mongo)`);
    console.log(`Mongo file:     ${result.mongoFile}`);
    console.log(args.json
        ? `Import with: mongoimport --uri="<connection string>" --collection=campaigns --jsonArray --file="${result.mongoFile}"`
        : `Paste into Atlas's Data Explorer ">_MONGOSH" shell (or local mongosh) as: db.campaigns.insertMany(<paste the array from this file>)`);
    console.log("--------------------------------");
}

if (require.main === module) main();

module.exports = { exportForMongo };
