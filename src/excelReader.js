const ExcelJS = require("exceljs");

/**
 * Excel cells don't always hold a plain string. Pasting a link often makes
 * Excel auto-format the cell as rich text (possibly split across several
 * runs — e.g. the domain and the path can end up as two separate runs), or
 * as a hyperlink formula ({ text, hyperlink }). Flatten any of those shapes
 * back down to one string.
 */
function cellToText(value) {
    if (value == null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "object") {
        if (typeof value.text === "string") return value.text; // hyperlink formula shape
        if (Array.isArray(value.richText)) return value.richText.map(run => run.text || "").join(""); // rich text runs
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

        const rawUrl = cellToText(row.getCell(columnIndex.url).value);
        if (!rawUrl || !rawUrl.trim()) return;

        const website = cellToText(columnIndex.website ? row.getCell(columnIndex.website).value : null);
        const status = cellToText(columnIndex.status ? row.getCell(columnIndex.status).value : null);

        rows.push({
            url: normalizeScheme(rawUrl.trim()),
            website: website ? website.trim() : null,
            status: status ? status.trim() : null,
            rowNumber,
        });
    });

    return rows;
}

module.exports = { readExcel };
