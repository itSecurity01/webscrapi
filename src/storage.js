const fs = require("fs");
const path = require("path");
const { slugify, resolveUniqueFolder } = require("./utils/slugify");
const { validateProduct } = require("./utils/validators");

const OUTPUT_DIR = path.join(process.cwd(), "output");
const SCREENSHOTS_DIR = path.join(process.cwd(), "screenshots");

function ensureProductFolder(website, productName, sourceUrl) {
    const websiteDir = path.join(OUTPUT_DIR, slugify(website));
    fs.mkdirSync(websiteDir, { recursive: true });

    const basePath = path.join(websiteDir, slugify(productName));
    return resolveUniqueFolder(basePath, sourceUrl);
}

/**
 * Validates `product` against the schema, then writes product.json into `folder`.
 * Throws if validation fails — callers should treat that as a scrape failure.
 */
function saveProduct(folder, product) {
    validateProduct(product);
    const filePath = path.join(folder, "product.json");
    fs.writeFileSync(filePath, JSON.stringify(product, null, 2), "utf8");
    return filePath;
}

async function saveScreenshot(page, website, urlOrSlug) {
    const dir = path.join(SCREENSHOTS_DIR, slugify(website));
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `failed-${slugify(urlOrSlug)}-${Date.now()}.png`);
    try {
        await page.screenshot({ path: filePath, fullPage: true });
        return filePath;
    } catch {
        return null;
    }
}

module.exports = { ensureProductFolder, saveProduct, saveScreenshot, OUTPUT_DIR, SCREENSHOTS_DIR };
