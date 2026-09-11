// Generates input/products.xlsx with a header row (url, website, status) and
// a few demo rows pointing at books.toscrape.com (a public scraping sandbox)
// so the pipeline can be run end-to-end immediately. Replace/add rows with
// real boat/levis/hm product URLs once you're ready to test those configs.
const path = require("path");
const ExcelJS = require("exceljs");

async function main() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("products");

    sheet.columns = [
        { header: "url", key: "url", width: 70 },
        { header: "website", key: "website", width: 15 },
        { header: "status", key: "status", width: 12 },
    ];

    const demoUrls = [
        "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
        "https://books.toscrape.com/catalogue/soumission_998/index.html",
        "https://books.toscrape.com/catalogue/sharp-objects_997/index.html",
    ];

    demoUrls.forEach(url => sheet.addRow({ url, website: "", status: "pending" }));

    const outPath = path.join(process.cwd(), "input", "products.xlsx");
    await workbook.xlsx.writeFile(outPath);
    console.log(`Sample Excel written to ${outPath}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
