const ExcelJS = require("exceljs");

/**
 * Excel cells don't always hold a plain string. Pasting a link often makes
 * Excel auto-format the cell as rich text (possibly split across several
 * runs — e.g. the domain and the path can end up as two separate runs), or
 * as a real hyperlink ({ text, hyperlink }). Flatten any of those shapes
 * back down to one string.
 *
 * IMPORTANT: a real hyperlink cell (Insert Hyperlink, or Excel's own
 * paste-a-URL autocomplete) is exactly this `{ text, hyperlink }` shape —
 * confirmed against exceljs's own parser
 * (node_modules/exceljs/lib/xlsx/xform/sheet/cell-xform.js, ~line 477-489):
 * on read, any cell whose address appears in the sheet's hyperlink map gets
 * `model.text` set to whatever was DISPLAYED and `model.hyperlink` set to
 * the REAL link target, and both survive onto `cell.value`. `value.text` is
 * only guaranteed to equal the actual URL when the display text and the
 * link happen to be the same string — e.g. a product name linked to its
 * page ("Buy Now" -> https://...) has a `.text` of "Buy Now", not the URL.
 * `.hyperlink` is therefore checked FIRST and is the one actually returned
 * when both are present.
 */
function cellToText(value) {
    if (value == null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "object") {
        if (typeof value.hyperlink === "string") return value.hyperlink; // real hyperlink (or HYPERLINK() formula) — the actual target, not the display text
        if (typeof value.text === "string") return value.text; // hyperlink-shaped value with no separate target (rare) — falls back to its text
        if (Array.isArray(value.richText)) return value.richText.map(run => run.text || "").join(""); // rich text runs
        if (typeof value.formula === "string") {
            // =HYPERLINK("https://...", "Buy Now") — Excel stores no hyperlink
            // relationship for these, so the real target only exists inside the
            // formula text; the cached result is just the display label.
            const m = value.formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
            if (m) return m[1];
        }
        if (value.result != null) return cellToText(value.result); // formula cell — use its cached result (may itself be a hyperlink/rich-text shape)
    }
    return null;
}

/**
 * A URL typed/pasted without a scheme (e.g. "boat-lifestyle.com/products/x",
 * which is also what a split rich-text link collapses to) isn't a valid
 * absolute URL as far as `new URL()` is concerned. Default it to https://.
 */
function normalizeScheme(url) {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Resolves a worksheet cell down to one normalized URL string, or null if
 * it's empty/unreadable. Shared by this file (initial read) and
 * excelWriter.js (matching a row back up to its scrape result) so the two
 * always agree on what a row's URL is — see cellToText()'s hyperlink note
 * above for why that agreement actually matters.
 */
function resolveUrlCell(cell) {
    const raw = cellToText(cell && cell.value);
    if (!raw || !raw.trim()) return null;
    return normalizeScheme(raw.trim());
}

/**
 * Reads the input workbook and returns rows: [{ url, website, status, rowNumber }]
 * `website` and `status` columns are optional.
 */
async function readExcel(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    const headerRow = sheet.getRow(1);
    const columnIndex = {};
    headerRow.eachCell((cell, colNumber) => {
        const key = String(cell.value || "").trim().toLowerCase();
        if (key) columnIndex[key] = colNumber;
    });

    if (!columnIndex.url) {
        throw new Error(`Input Excel is missing a "url" column header in ${filePath}`);
    }

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // header

        const url = resolveUrlCell(row.getCell(columnIndex.url));
        if (!url) return;

        const website = cellToText(columnIndex.website ? row.getCell(columnIndex.website).value : null);
        const status = cellToText(columnIndex.status ? row.getCell(columnIndex.status).value : null);

        rows.push({
            url,
            website: website ? website.trim() : null,
            status: status ? status.trim() : null,
            rowNumber,
        });
    });

    return rows;
}

module.exports = { readExcel, resolveUrlCell, cellToText, normalizeScheme };
