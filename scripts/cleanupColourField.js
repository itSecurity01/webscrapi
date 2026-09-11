/**
 * One-off data cleanup: blanks the `colour` field to [] on every existing
 * output/**\/upload.json draft, WITHOUT touching anything else in the file
 * (program, categories, status, etc. stay exactly as already reviewed).
 *
 * Why: before the toUploadSchema.js fix, `colour` was auto-filled with raw
 * scraped color names ("BLUE", ...) instead of being left for review — this
 * one-time pass corrects drafts that were already generated/reviewed under
 * the old behavior. New drafts from `npm run transform` no longer need this
 * (colour already defaults to [] there).
 *
 * Usage: node scripts/cleanupColourField.js [--dry-run]
 */
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(process.cwd(), "output");
const dryRun = process.argv.includes("--dry-run");

function findUploadJsonFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...findUploadJsonFiles(full));
        else if (entry.isFile() && entry.name.toLowerCase() === "upload.json") results.push(full);
    }
    return results;
}

const files = findUploadJsonFiles(OUTPUT_DIR);
let changed = 0;
let skipped = 0;

for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf8");
    const draft = JSON.parse(raw);

    if (!Array.isArray(draft.colour) || draft.colour.length === 0) {
        skipped++;
        continue;
    }

    const before = draft.colour;
    draft.colour = [];
    changed++;
    console.log(`${dryRun ? "[dry-run] " : ""}${filePath}: colour ${JSON.stringify(before)} -> []`);

    if (!dryRun) {
        fs.writeFileSync(filePath, JSON.stringify(draft, null, 2), "utf8");
    }
}

console.log(`\n${changed} file(s) ${dryRun ? "would be" : "were"} updated, ${skipped} already had an empty/missing colour.`);
