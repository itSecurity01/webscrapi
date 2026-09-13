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

/**
 * Core of this script, factored out so the review server's upload flow
 * (Feature 5) can show the same duplicate report right on the page before
 * a scrape starts, instead of only via this CLI. Pure — no I/O.
 *
 * @param {{url:string}[]} rows - as returned by readExcel()
 * @returns {{ totalRows:number, distinctUrls:number,
 *             dupes: {url:string, count:number}[], dupeRowCount:number }}
 */
function findDuplicates(rows) {
    const counts = new Map();
    for (const row of rows) {
        counts.set(row.url, (counts.get(row.url) || 0) + 1);
    }

    const dupes = [...counts.entries()]
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .map(([url, count]) => ({ url, count }));
    const dupeRowCount = dupes.reduce((sum, d) => sum + d.count, 0);

    return { totalRows: rows.length, distinctUrls: counts.size, dupes, dupeRowCount };
}

async function main() {
    const args = parseArgs();
    const inputPath = path.resolve(process.cwd(), args.input);

    console.log(`Reading ${inputPath} ...`);
    const rows = await readExcel(inputPath);
    const { totalRows, distinctUrls, dupes, dupeRowCount } = findDuplicates(rows);

    console.log(`\nTotal rows: ${totalRows}`);
    console.log(`Distinct URLs: ${distinctUrls}`);
    console.log(`Duplicate URLs: ${dupes.length} (accounting for ${dupeRowCount} rows, ${dupeRowCount - dupes.length} of them extra/wasted)`);

    if (dupes.length > 0) {
        console.log("\nDuplicates (xN = how many rows share that URL):");
        dupes.forEach(({ url, count }) => console.log(`  x${count}  ${url}`));
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}

module.exports = { findDuplicates };
