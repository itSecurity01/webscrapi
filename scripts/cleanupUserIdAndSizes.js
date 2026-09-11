/**
 * One-off data cleanup (companion to cleanupColourField.js): on every
 * existing output/**\/upload.json draft —
 *   - sets `userId` to the default account id, unless one is already set
 *   - blanks `productSizes` to [] (raw scraped sizes are per-product data
 *     meant for the review step, same reasoning as colour)
 * Nothing else in the file is touched — program/categories/status/colour/
 * etc. stay exactly as already reviewed.
 *
 * Usage: node scripts/cleanupUserIdAndSizes.js [--dry-run]
 */
const fs = require("fs");
const path = require("path");
const { DEFAULT_USER_ID } = require("../src/transform/toUploadSchema");

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
    const draft = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const changes = [];

    if (!draft.userId) {
        changes.push(`userId ${JSON.stringify(draft.userId || null)} -> ${JSON.stringify(DEFAULT_USER_ID)}`);
        draft.userId = DEFAULT_USER_ID;
    }
    if (Array.isArray(draft.productSizes) && draft.productSizes.length > 0) {
        changes.push(`productSizes ${JSON.stringify(draft.productSizes)} -> []`);
        draft.productSizes = [];
    }

    if (changes.length === 0) {
        skipped++;
        continue;
    }

    changed++;
    console.log(`${dryRun ? "[dry-run] " : ""}${filePath}:\n  ${changes.join("\n  ")}`);
    if (!dryRun) fs.writeFileSync(filePath, JSON.stringify(draft, null, 2), "utf8");
}

console.log(`\n${changed} file(s) ${dryRun ? "would be" : "were"} updated, ${skipped} already had both fields set correctly.`);
