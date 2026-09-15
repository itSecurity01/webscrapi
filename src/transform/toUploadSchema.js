/**
 * Maps a scraped product.json into the upload-schema shape used by the
 * storefront/campaign import pipeline. See PRODUCT_SCRAPER_PLAN.md /
 * conversation history for the field-by-field mapping rationale.
 *
 * This module is pure — it never touches the filesystem. Callers (the CLI
 * batch runner, the review server) decide where the result gets written.
 */

// Every product from this pipeline is attributed to the same account by
// default — override per-draft during review (or override the whole batch
// via DEFAULT_CAMPAIGN_USER_ID, see toCampaignDocument.js) if that changes.
const DEFAULT_USER_ID = "68a404def358202d178e6b6a";

const { filterProductImages } = require("../utils/imageFilter");

/** Strip everything but digits/dot from a raw numeric-ish string ("1,999" -> 1999). */
function parseNumber(raw) {
    if (raw == null) return 0;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;

    const cleaned = String(raw).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!cleaned) return 0;

    const value = parseFloat(cleaned[0]);
    return Number.isFinite(value) ? value : 0;
}

/** Pull the leading number out of a string like "60% off" -> 60. */
function parseDiscountPercent(raw) {
    if (raw == null) return 0;
    const match = String(raw).match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : 0;
}

/** Random star rating in [4.0, 5.0], one decimal place — see plan: no real
 * per-product rating is available from the scrape, so a plausible placeholder
 * is generated once and persisted (callers must not regenerate on every read). */
function randomRating() {
    return Math.round((4 + Math.random()) * 10) / 10;
}

/**
 * Pick the image URL list to expose as image/subImages. Prefers
 * images that actually downloaded successfully (a stronger signal the URL is
 * live); falls back to the full list if none downloaded, rather than leaving
 * image empty.
 */
function pickImageUrls(images) {
    const list = Array.isArray(images) ? images : [];
    const successful = list.filter(img => img && img.success && img.url);
    const usable = successful.length > 0 ? successful : list.filter(img => img && img.url);
    // Also filters here (not just in the scrape pipeline, src/index.js) so
    // re-running the transform (--force) over an already-scraped
    // product.json retroactively drops any junk asset that slipped in
    // before this filter existed, with no re-scrape needed.
    return filterProductImages(usable.map(img => img.url));
}

/**
 * Transform one scraped product.json object into the upload-schema draft.
 * Fields with no reliable source (program, gender, categories) are left
 * blank/empty for the review step to fill in.
 */
function transformProduct(productJson) {
    const product = productJson.product || {};
    const additionalInfo = productJson.additionalInfo || {};
    const imageUrls = pickImageUrls(productJson.images);

    // Prefer a real scraped rating (a config's additionalFields.rating, e.g.
    // boat.js's ".rating__stars") when one is present and parses to a
    // positive number; only fall back to the random placeholder when the
    // site genuinely gave us nothing to go on.
    const scrapedRating = parseNumber(additionalInfo.rating);

    return {
        name: product.name || "",
        userId: DEFAULT_USER_ID,
        mrp: parseNumber(additionalInfo.mrp),
        productPrice: parseNumber(product.price),
        rating: scrapedRating > 0 ? scrapedRating : randomRating(),
        discount: parseDiscountPercent(additionalInfo.discountPercent),
        vendorComment: "",
        program: "",
        gender: "",
        productDescription: product.description || "",
        additionalInformation: product.description || "",
        toolType: "storeIntegration",
        campaignType: "storeCampaign",
        vendorSku: product.sku || "",
        categories: [],
        // NOTE: scraped sizes (variants.sizes, e.g. "Free"/"M"/"L") are left
        // empty for the review step rather than auto-filled — same
        // reasoning as `colour` below: this is per-product data a human
        // should confirm, not something to assume from a raw scrape. The
        // raw scraped sizes still sit in this product's product.json
        // (variants.sizes) for a reviewer to check.
        productSizes: [],
        // NOTE: scraped colors (variants.colors) are plain names ("BLUE",
        // "Navy Blue", ...), not the hex swatch values `colour` is meant to
        // hold — auto-filling it with names would be data of the wrong
        // shape. Left empty for the review step, same as
        // program/gender/categories; the raw scraped names are still
        // sitting in this product's product.json (variants.colors) if a
        // reviewer needs to look them up to pick hex codes.
        colour: [],
        image: imageUrls[0] || "",
        subImages: imageUrls.slice(1),
    };
}

module.exports = { transformProduct, parseNumber, parseDiscountPercent, randomRating, pickImageUrls, DEFAULT_USER_ID };
