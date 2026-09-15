const { normalizeUrl, largestFromSrcset } = require("./utils/url");

const NAV_TIMEOUT_MS = parseInt(process.env.NAV_TIMEOUT_MS || "30000", 10);

/**
 * Walk a JSON-LD payload (which may be a single object, an array of nodes,
 * or an object with an "@graph" array) and return every node whose @type
 * includes "Product".
 */
function findProductNodes(data) {
    const candidates = Array.isArray(data)
        ? data
        : Array.isArray(data["@graph"])
            ? data["@graph"]
            : [data];

    return candidates.filter(node => {
        if (!node || typeof node !== "object") return false;
        const type = node["@type"];
        return type === "Product" || (Array.isArray(type) && type.includes("Product"));
    });
}

async function extractJsonLd(page) {
    let blocks = [];
    try {
        blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    } catch {
        return null;
    }

    for (const block of blocks) {
        try {
            const data = JSON.parse(block);
            const [product] = findProductNodes(data);
            if (product) return product;
        } catch {
            // ignore invalid JSON-LD blocks, keep checking the rest
        }
    }

    return null;
}

async function extractText(page, selectors) {
    for (const selector of selectors) {
        try {
            const element = page.locator(selector).first();
            if (await element.count() > 0) {
                const text = await element.textContent();
                if (text && text.trim()) {
                    return { value: text.trim(), selector };
                }
            }
        } catch {
            // selector errored (e.g. invalid on this page) — try the next one
        }
    }
    return { value: null, selector: null };
}

async function extractImages(page, selectors, baseUrl) {
    for (const selector of selectors) {
        try {
            const locator = page.locator(selector);
            const count = await locator.count();
            if (count === 0) continue;

            const raw = await locator.evaluateAll(imgs =>
                imgs.map(img => ({
                    src: img.currentSrc || img.src || null,
                    dataSrc: img.dataset ? (img.dataset.src || null) : null,
                    srcset: img.srcset || null,
                }))
            );

            const urls = raw
                .map(img => img.dataSrc || (img.srcset ? largestFromSrcset(img.srcset) : null) || img.src)
                .map(u => normalizeUrl(u, baseUrl))
                .filter(Boolean);

            const unique = [...new Set(urls)];
            if (unique.length > 0) return { urls: unique, selector };
        } catch {
            // try next selector
        }
    }
    return { urls: [], selector: null };
}

function jsonLdField(node, path) {
    return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), node);
}

/**
 * Like extractText, but collects EVERY matching element's text instead of
 * just the first — for fields with multiple values (sizes, colors, tags).
 * Tries selectors in order, keeps the first selector that yields anything.
 */
async function extractList(page, selectors) {
    for (const selector of selectors) {
        try {
            const locator = page.locator(selector);
            const count = await locator.count();
            if (count === 0) continue;

            const texts = await locator.allTextContents();
            const values = [...new Set(texts.map(t => t.trim()).filter(Boolean))];
            if (values.length > 0) return { values, selector };
        } catch {
            // try next selector
        }
    }
    return { values: [], selector: null };
}

/**
 * Collects a variant-style value (e.g. "size" or "color") out of JSON-LD:
 * either a direct property on the Product node, or across each entry of
 * `hasVariant` (schema.org's way of listing per-variant Products/Offers).
 */
function collectJsonLdVariantValues(jsonLd, key) {
    if (!jsonLd) return [];
    const values = new Set();

    const direct = jsonLd[key];
    if (direct) (Array.isArray(direct) ? direct : [direct]).forEach(v => values.add(String(v)));

    const variants = Array.isArray(jsonLd.hasVariant) ? jsonLd.hasVariant : [];
    for (const variant of variants) {
        const val = variant && variant[key];
        if (val) (Array.isArray(val) ? val : [val]).forEach(v => values.add(String(v)));
    }

    return [...values];
}

/**
 * Runs a config's optional `additionalFields` map — arbitrary site-specific
 * fields (material, weight, availability, ...) beyond the fixed product
 * shape. Each entry is either an array of selectors (single value, like
 * title/price) or `{ selectors, multiple: true }` (collects every match,
 * like sizes/colors).
 */
async function extractAdditionalInfo(page, config) {
    const additionalInfo = {};
    const fieldTrace = {};
    const fields = config.additionalFields || {};

    for (const [fieldName, def] of Object.entries(fields)) {
        const selectors = Array.isArray(def) ? def : def.selectors || [];
        const multiple = !Array.isArray(def) && def.multiple === true;

        if (multiple) {
            const res = await extractList(page, selectors);
            additionalInfo[fieldName] = res.values;
            fieldTrace[`additionalInfo.${fieldName}`] = { field: fieldName, source: "dom", selector: res.selector, path: null, success: res.values.length > 0 };
        } else {
            const res = await extractText(page, selectors);
            additionalInfo[fieldName] = res.value;
            fieldTrace[`additionalInfo.${fieldName}`] = { field: fieldName, source: "dom", selector: res.selector, path: null, success: !!res.value };
        }
    }

    return { additionalInfo, fieldTrace };
}

/**
 * Runs the full extraction priority order for one product page:
 * JSON-LD -> DOM selectors -> missing. Returns a product object with a raw
 * `imageUrls` list (not yet downloaded) and a field-level trace.
 */
async function scrapeProduct(page, url, config) {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    if (!response || !response.ok()) {
        const error = new Error(`Navigation failed: HTTP ${response ? response.status() : "no response"} for ${url}`);
        error.status = response ? response.status() : null;
        // Retry-After is seconds (or an HTTP date); normalise to ms so the
        // caller can pause the domain for exactly as long as the site asked.
        const retryAfter = response ? response.headers()["retry-after"] : null;
        if (retryAfter) {
            const secs = Number(retryAfter);
            error.retryAfterMs = Number.isFinite(secs) ? secs * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
        }
        throw error;
    }

    if (typeof config.beforeExtract === "function") {
        await config.beforeExtract(page);
    }

    const trace = {};
    const jsonLd = await extractJsonLd(page);

    function record(field, source, selectorOrPath, success) {
        trace[field] = { field, source, selector: source === "dom" ? selectorOrPath : null, path: source === "json-ld" ? selectorOrPath : null, success };
    }

    // --- name ---
    let name = jsonLd?.name;
    if (name) {
        record("name", "json-ld", "name", true);
    } else {
        const res = await extractText(page, config.selectors.title || []);
        name = res.value;
        record("name", "dom", res.selector, !!res.value);
    }

    // --- brand ---
    let brand = jsonLd?.brand?.name || (typeof jsonLd?.brand === "string" ? jsonLd.brand : null);
    record("brand", "json-ld", "brand.name", !!brand);
    if (!brand) trace.brand = { field: "brand", source: "missing", selector: null, path: null, success: false };

    // --- price / currency ---
    let priceRaw = jsonLdField(jsonLd, "offers.price") ?? jsonLd?.offers?.[0]?.price;
    let currency = jsonLdField(jsonLd, "offers.priceCurrency") ?? jsonLd?.offers?.[0]?.priceCurrency ?? null;
    let price = null;

    if (priceRaw != null) {
        const parsed = config.parse?.price ? config.parse.price(priceRaw) : { value: parseFloat(priceRaw), currency };
        price = parsed.value;
        currency = currency || parsed.currency;
        record("price", "json-ld", "offers.price", price != null);
    } else {
        const res = await extractText(page, config.selectors.price || []);
        if (res.value && config.parse?.price) {
            const parsed = config.parse.price(res.value);
            price = parsed.value;
            currency = currency || parsed.currency;
        }
        record("price", "dom", res.selector, price != null);
    }

    // --- description ---
    let description = jsonLd?.description || null;
    if (description) {
        record("description", "json-ld", "description", true);
    } else {
        const res = await extractText(page, config.selectors.description || []);
        description = res.value;
        record("description", "dom", res.selector, !!res.value);
    }

    // --- sku ---
    let sku = jsonLd?.sku || jsonLd?.mpn || null;
    record("sku", "json-ld", "sku", !!sku);
    if (!sku) trace.sku = { field: "sku", source: "missing", selector: null, path: null, success: false };

    // --- images ---
    let imageUrls = [];
    const jsonLdImages = jsonLd?.image;
    if (jsonLdImages) {
        // Entries may be plain URL strings or schema.org ImageObject nodes
        // ({ "@type": "ImageObject", url, width, height }) — FirstCry does
        // the latter. Unwrap so normalizeUrl never sees an object.
        imageUrls = (Array.isArray(jsonLdImages) ? jsonLdImages : [jsonLdImages])
            .map(u => (u && typeof u === "object") ? (u.url || u.contentUrl || null) : u)
            .map(u => normalizeUrl(u, url))
            .filter(Boolean);
        record("images", "json-ld", "image", imageUrls.length > 0);
    }
    if (imageUrls.length === 0) {
        const res = await extractImages(page, config.selectors.images || [], url);
        imageUrls = res.urls;
        record("images", "dom", res.selector, imageUrls.length > 0);
    }

    // --- sizes ---
    let sizes = collectJsonLdVariantValues(jsonLd, "size");
    if (sizes.length > 0) {
        record("sizes", "json-ld", "size / hasVariant[].size", true);
    } else if (config.selectors.sizes) {
        const res = await extractList(page, config.selectors.sizes);
        sizes = res.values;
        record("sizes", "dom", res.selector, sizes.length > 0);
    } else {
        trace.sizes = { field: "sizes", source: "missing", selector: null, path: null, success: false };
    }

    // --- colors ---
    let colors = collectJsonLdVariantValues(jsonLd, "color");
    if (colors.length > 0) {
        record("colors", "json-ld", "color / hasVariant[].color", true);
    } else if (config.selectors.colors) {
        const res = await extractList(page, config.selectors.colors);
        colors = res.values;
        record("colors", "dom", res.selector, colors.length > 0);
    } else {
        trace.colors = { field: "colors", source: "missing", selector: null, path: null, success: false };
    }

    // --- arbitrary extra fields (material, availability, weight, ...) ---
    const { additionalInfo, fieldTrace } = await extractAdditionalInfo(page, config);
    Object.assign(trace, fieldTrace);

    return {
        source: { website: config.name, url },
        product: { name: name || null, brand: brand || null, price, currency, sku, description },
        variants: { sizes, colors },
        additionalInfo,
        imageUrls,
        trace,
        scrapedAt: new Date().toISOString(),
    };
}

module.exports = { scrapeProduct, findProductNodes };
