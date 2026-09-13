const ExcelJS = require("exceljs");
const { resolveUrlCell } = require("./excelReader");

/**
 * Mirrors run results back into the source Excel file so progress is
 * visible without opening logs/state files. Adds "status" and "scrapedAt"
 * columns if they don't already exist. Called once at the end of a run
 * (batch write) rather than per-row, to avoid repeated file I/O.
 *
 * `results` is a Map<url, { status, error? }>.
 */
async function writeResultsBack(filePath, results) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.worksheets[0];
    if (!sheet) return;

    const headerRow = sheet.getRow(1);
    const columnIndex = {};
    headerRow.eachCell((cell, colNumber) => {
        const key = String(cell.value || "").trim().toLowerCase();
        if (key) columnIndex[key] = colNumber;
    });

    if (!columnIndex.url) return;

    function ensureColumn(name) {
        if (columnIndex[name]) return columnIndex[name];
        const newCol = headerRow.cellCount + 1;
        headerRow.getCell(newCol).value = name;
        columnIndex[name] = newCol;
        return newCol;
    }

    const statusCol = ensureColumn("status");
    const scrapedAtCol = ensureColumn("scrapedat");
    const errorCol = ensureColumn("error");

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        // Must resolve a row's URL the exact same way readExcel() does (real
        // hyperlink target over display text, rich-text runs joined, scheme
        // normalized) — `results`'s keys are readExcel()'s resolved URLs, so
        // matching on anything looser here (e.g. the old `.text`-only check)
        // silently drops the write-back for hyperlink/rich-text rows.
        const url = resolveUrlCell(row.getCell(columnIndex.url));
        if (!url) return;

        const result = results.get(url);
        if (!result) return;

        row.getCell(statusCol).value = result.status;
        row.getCell(scrapedAtCol).value = new Date().toISOString();
        row.getCell(errorCol).value = result.error || null;
    });

    await workbook.xlsx.writeFile(filePath);
}

module.exports = { writeResultsBack };
