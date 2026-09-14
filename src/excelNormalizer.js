/**
 * Turns *any* uploaded workbook into the one shape the scraper reads
 * (readExcel(): a first sheet with a "url" header, plus optional "website"
 * and "status" columns).
 *
 * Why: the sheets people actually hand over (see the batch page) are
 * category workbooks — one tab per category ("Shirts", "winter wear", ...),
 * URLs scattered across several repeating column groups, no header row,
 * prices/brands/names in between. Rebuilding a clean url/website/status
 * file by hand for every batch was the slow part of the whole pipeline, and
 * the URL is the only thing the scraper actually needs — website/status are
 * optional in readExcel() and are left blank here.
 *
 * Per selected sheet:
 *   - if row 1 has a "url" header, it's already in our format: read the
 *     url column (and website/status if present) exactly like readExcel().
 *   - otherwise every cell is scanned and anything URL-shaped is pulled out
 *     (real hyperlinks, rich text, formula results, plain "tatacliq.com/..."
 *     text — same cellToText() rules as the reader).
 * Selecting several sheets simply concatenates them in the order given
 * ("merge two pages into one"). Duplicate URLs are dropped (first wins) so
 * a merged file doesn't re-scrape the same product; the count is reported.
 */
const ExcelJS = require("exceljs");
const { cellToText, normalizeScheme } = require("./excelReader");

// Either an explicit http(s) URL, or "domain.tld/some/path" typed without a
// scheme (what a pasted link often collapses to in Excel). The path part is
// required for the scheme-less form so brand names, prices, "e.g." etc.
// never match — a bare "tatacliq.com" isn't a product page anyway.
const URL_RE = /https?:\/\/[^\s"'<>]+|(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\/[^\s"'<>]*/i;

function extractUrl(text) {
    if (!text) return null;
    const match = String(text).match(URL_RE);
    if (!match) return null;
    // Trailing punctuation from prose ("see https://x.com/p/1.") isn't part of the link.
    return normalizeScheme(match[0].replace(/[.,;:)\]]+$/, ""));
}

function headerColumns(sheet) {
    const columnIndex = {};
    sheet.getRow(1).eachCell((cell, colNumber) => {
        const key = String(cellToText(cell.value) || "").trim().toLowerCase();
        if (key) columnIndex[key] = colNumber;
    });
    return columnIndex;
}

/** Rows ({ url, website, status }) found on one worksheet, in reading order. */
function rowsFromSheet(sheet) {
    const columns = headerColumns(sheet);
    const rows = [];

    if (columns.url) {
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const url = extractUrl(cellToText(row.getCell(columns.url).value));
            if (!url) return;
            const website = columns.website ? cellToText(row.getCell(columns.website).value) : null;
            const status = columns.status ? cellToText(row.getCell(columns.status).value) : null;
            rows.push({ url, website: website ? website.trim() : "", status: status ? status.trim() : "" });
        });
        return rows;
    }

    sheet.eachRow((row) => {
        row.eachCell((cell) => {
            const url = extractUrl(cellToText(cell.value));
            if (url) rows.push({ url, website: "", status: "" });
        });
    });
    return rows;
}

async function loadWorkbook(source) {
    const workbook = new ExcelJS.Workbook();
    if (Buffer.isBuffer(source)) await workbook.xlsx.load(source);
    else await workbook.xlsx.readFile(source);
    return workbook;
}

/**
 * Lists the sheets of a workbook with how many URLs each one holds, so the
 * batch page can ask "which page(s) do you want?" with real numbers.
 * @returns {Promise<Array<{ name: string, urlCount: number, hasUrlHeader: boolean }>>}
 */
async function inspectWorkbook(source) {
    const workbook = await loadWorkbook(source);
    return workbook.worksheets.map(sheet => ({
        name: sheet.name,
        urlCount: rowsFromSheet(sheet).length,
        hasUrlHeader: !!headerColumns(sheet).url,
    }));
}

/**
 * Collects url/website/status rows from the named sheets (all sheets if
 * `sheetNames` is empty), de-duplicated by URL.
 * @returns {Promise<{ rows: Array<{url,website,status}>, perSheet: Array<{name, found}>, duplicatesDropped: number }>}
 */
async function collectRows(source, sheetNames = []) {
    const workbook = await loadWorkbook(source);
    const wanted = sheetNames.length > 0
        ? sheetNames.map(name => {
            const sheet = workbook.getWorksheet(name);
            if (!sheet) throw new Error(`Sheet "${name}" not found in the uploaded workbook.`);
            return sheet;
        })
        : workbook.worksheets;

    const seen = new Set();
    const rows = [];
    const perSheet = [];
    let duplicatesDropped = 0;

    for (const sheet of wanted) {
        const found = rowsFromSheet(sheet);
        perSheet.push({ name: sheet.name, found: found.length });
        for (const row of found) {
            if (seen.has(row.url)) { duplicatesDropped++; continue; }
            seen.add(row.url);
            rows.push(row);
        }
    }

    return { rows, perSheet, duplicatesDropped };
}

/** Writes rows out in the scraper's input format (url | website | status). */
async function writeInputWorkbook(rows, outPath) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("products");
    sheet.columns = [
        { header: "url", key: "url", width: 70 },
        { header: "website", key: "website", width: 15 },
        { header: "status", key: "status", width: 12 },
    ];
    rows.forEach(row => sheet.addRow({ url: row.url, website: row.website || "", status: row.status || "" }));
    await workbook.xlsx.writeFile(outPath);
    return outPath;
}

module.exports = { inspectWorkbook, collectRows, writeInputWorkbook, extractUrl };
