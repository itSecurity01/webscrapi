// Config for dotandkey.com, built AND live-verified (direct Playwright
// navigation + DOM inspection, no markup was pasted) against a real product
// page (Watermelon Cooling Sunscreen SPF 50+ PA++++, /products/watermelon-
// cooling-spf-50-face-sunscreen) on 2026-09-14.
//
// dotandkey.com is Shopify with a custom theme. UNLIKE wishluck.js/
// milton.js in this repo, this theme's Product JSON-LD is correctly typed
// "Product" (not "ProductGroup") and is genuinely rich — confirmed live to
// carry name/brand/sku/gtin13/description/a COMPLETE 12-image gallery/
// offers(price+currency)/aggregateRating — so name/brand/price/currency/
// sku/description/images should all come from `trace.*.source ===
// "json-ld"` with no fix needed, a nice change of pace from most configs in
// this repo. `sizes` is the one thing JSON-LD doesn't carry (single
// `offers` object, no `hasVariant`) — see the DOM `sizes` selector below,
// sourced from a clean embedded `<script type="application/json"
// data-variant-data>` block inside `<variant-selector>` that lists every
// real variant (id/price/compare_at_price/sku per size) — not parsed
// directly here since the DOM pill buttons already expose the same values
// as plain visible text, but worth knowing that richer JSON exists inline
// if a future field needs it.
//
// CONFIRMED CAVEAT: `.main-pdp-price__compare` (the struck-through MRP
// node) is NOT absent/hidden when a product has no discount — it still
// exists in the DOM with a rendered value, but that value is literally
// "₹0" (confirmed live on this product, where price === compare_at_price
// so the theme has nothing real to show). Treat an `mrp` of "₹0" as "not on
// sale", not a literal zero-price product.
//
// The scroll-tab sections (Details/Benefits/How To Use/Ingredients/...)
// each have a stable, human-readable anchor id (`#pdp-anchor-<name>`,
// confirmed present for at least: main, in-vivo-spf, details, ingredients,
// benefits, how-to-use, faq, reviews) — additionalFields below read
// straight from those anchors rather than any of the surrounding
// `[font-family:...]`-style Tailwind utility classes, which are far more
// likely to churn on a redeploy.
module.exports = {
    name: "dotandkey",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1.main-pdp-title__heading", "#pdp-anchor-main"].join(", "), {
                timeout: 15000,
                state: "attached",
            })
            .catch(() => {});

        // No consent banner was visible on the live page; harmless no-op
        // if absent, kept for parity with the other configs.
        const consentSelectors = [
            "#onetrust-accept-btn-handler",
            'button[aria-label="Accept"]',
            ".cookie-consent button",
        ];
        for (const sel of consentSelectors) {
            const el = page.locator(sel).first();
            if (await el.count().catch(() => 0) > 0) {
                await el.click({ timeout: 2000 }).catch(() => {});
                break;
            }
        }

        // The scroll-tab sections (Ingredients/Benefits/How To Use/...)
        // can lazy-render on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, but only as a fallback — JSON-LD supplies `name`
        // first (see module comment).
        title: ["h1.main-pdp-title__heading", "h1"],

        // Confirmed, but only as a fallback — JSON-LD supplies `price`
        // first.
        price: [".main-pdp-price__current", ".price"],

        // Confirmed, but only as a fallback — JSON-LD's own `description`
        // is already complete on this product. `#pdp-anchor-details`
        // covers the bullet-point feature list shown on the page (a
        // different, shorter text than JSON-LD's paragraph description,
        // but the closest DOM equivalent available).
        description: ["#pdp-anchor-details", ".description"],

        // Confirmed, but only as a fallback — JSON-LD's own `image` array
        // is already the complete 12-photo gallery on this product, so
        // this selector is not expected to actually run in practice.
        images: [".product-gallery img", ".pdp-gallery img", "img[data-product-image]"],

        // Confirmed: variant-picker size pills (e.g. "80g", "50g") — plain
        // visible text matching each pill's own `data-option-value`
        // attribute. Not present on a single-size product, in which case
        // this correctly comes back empty.
        sizes: [".main-pdp-variants__pill"],

        // NOT present — this is a skincare product line with size (not
        // color) as its only variant dimension; `colors` omitted rather
        // than guessed, correctly comes back as an empty array with a
        // "missing" trace.
    },

    additionalFields: {
        // Confirmed, but see the big CAVEAT in the module comment above —
        // this can legitimately read "₹0" on a product that isn't
        // currently discounted, not a broken selector. Raw text, not
        // parsed to a number (matches how `mrp` is kept raw in the other
        // configs in this repo).
        mrp: [".main-pdp-price__compare"],

        // Confirmed: percentage-off badge next to the price. Empty/absent
        // on a non-discounted product, same as mrp above.
        discountPercent: [".main-pdp-price__discount"],

        // Confirmed: "MRP incl. of all taxes" note under the price.
        taxNote: [".main-pdp-price__tax-note"],

        // Confirmed: "Suitable for: Oily & Combination Skin" callout near
        // the title — common across this brand's skincare PDPs, but
        // absent on a product with no skin-type targeting (e.g. haircare).
        skinType: [".main-pdp-skin-type__value"],

        // Confirmed: "Loved by 1633+ customers" social-proof line. JSON-LD
        // DOES carry the same figures as clean numbers
        // (`aggregateRating.ratingValue`/`.reviewCount`, confirmed 4.6/1633
        // live) but scraper.js's fixed field set has no slot for
        // aggregateRating and additionalFields can only read the DOM, not
        // jsonLd — so this raw prose string is what's actually available
        // here, not a missed opportunity for a cleaner number.
        ratingsSummary: [".main-pdp-rating__count"],

        // Confirmed: the 4 main scroll-tab sections, each read from its
        // own stable `#pdp-anchor-<name>` id (see module comment for the
        // full confirmed list of anchor ids on this page). Raw combined
        // text per section (headings + bullet items run together with no
        // separator, same "kept raw" convention as tatacliq.js's
        // productDetailsRaw in this repo) — clean up downstream if needed.
        productDetails: ["#pdp-anchor-details"],
        benefits: ["#pdp-anchor-benefits"],
        howToUse: ["#pdp-anchor-how-to-use"],
        ingredients: ["#pdp-anchor-ingredients"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
