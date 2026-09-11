/**
 * Reports duplicate URL rows in the input Excel — read-only, changes nothing.
 * Duplicate rows aren't skipped within a single scrape run (state/run.json
 * only prevents re-scraping across separate runs), so a messy input file
 * means the same product gets scraped 2-3x in one run, wasting time even
 * though it's harmless (each re-scrape just overwrites the same output
 * folder, per resolveUniqueFolder's source-url marker match).
 *
 * Usage:
 *   node src/checkDuplicates.js
 *   node src/checkDuplicates.js --input=input/other.xlsx
 */
const path = require("path");
const { readExcel } = require("./excelReader");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { input: process.env.INPUT_XLSX || "input/products.xlsx" };
    for (const arg of argv) {
        if (arg.startsWith("--input=")) args.input = arg.split("=")[1];
    }
    return args;
}

async function main() {
    const args = parseArgs();
    const inputPath = path.resolve(process.cwd(), args.input);

    console.log(`Reading ${inputPath} ...`);
    const rows = await readExcel(inputPath);

    const counts = new Map();
    for (const row of rows) {
        counts.set(row.url, (counts.get(row.url) || 0) + 1);
    }

    const dupes = [...counts.entries()].filter(([, n]) => n > 1);
    const dupeRowCount = dupes.reduce((sum, [, n]) => sum + n, 0);

    console.log(`\nTotal rows: ${rows.length}`);
    console.log(`Distinct URLs: ${counts.size}`);
    console.log(`Duplicate URLs: ${dupes.length} (accounting for ${dupeRowCount} rows, ${dupeRowCount - dupes.length} of them extra/wasted)`);

    if (dupes.length > 0) {
        console.log("\nDuplicates (xN = how many rows share that URL):");
        dupes
            .sort((a, b) => b[1] - a[1])
            .forEach(([url, n]) => console.log(`  x${n}  ${url}`));
    }
}

main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
