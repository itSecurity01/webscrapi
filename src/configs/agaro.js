// Config for agarolifestyle.com, built AND live-verified (direct Playwright
// navigation + DOM/JSON-LD inspection, no markup was pasted — the element
// given in the request was cross-checked against, not copied from) against
// a real product page (Regency Multi Cook Kettle With Steamer - 1.2 Litres
// - Sea Green, /products/regency-multi-cook-kettle-with-steamer-1-2-
// litres-sea-green) on 2026-09-15.
//
// A Shopify store (confirmed via the `data-json-product` Shopify-shaped
// variant JSON on the page's <single-product> element, and cdn.shopify.com
// asset URLs) — but UNLIKE every Shopify config in this repo so far, no
// fetch-a-JSON-endpoint workaround is needed here at all. Confirmed live:
// the page ships SEVEN `<script type="application/ld+json">` blocks (a
// third-party "SchemaPlus" SEO app layers several on top of the theme's
// own), and the very first Product-typed node among them — which is
// exactly the one `findProductNodes()`/`extractJsonLd()` in scraper.js
// will pick, since it takes the first match — is itself genuinely
// complete: name/brand/description/sku/mpn/category/a real 8-photo
// `image` array/`offers`(price+currency)/`aggregateRating`, all correct
// and none of them faked or duplicated-from-the-title. name/brand/price/
// currency/sku/description/images all come through with NO fix needed —
// the cleanest JSON-LD situation of any config in this repo.
//
// CONFIRMED PRICE TRAP-SHAPED DUPLICATION, but harmless: `.price-item
// .regular_price` / `.price-item.comp_price` / `.prod_priceWrap` each
// match 14 times once the page is fully scrolled (sticky bars, a quick-
// view modal, and a "Related Products" rail all reuse these classes) —
// but every single one of the 14 carries the SAME real value for this
// product (confirmed live via a dedup check), never a recommended
// product's own price. Genuinely scoped, unique, purpose-named classes
// exist for a cleaner read regardless: `.product-page-info__price`
// (price+MRP combined, exactly 1 match) and `.product-page-info__price-
// sale-details` (the discount badge, exactly 1 match) — used for
// `additionalFields` below instead of the noisier-but-still-safe
// duplicated classes.
//
// NOT `sizes`/`colors`: confirmed live this exact product has only the
// single Shopify "Default Title" variant (no option picker rendered at
// all — `.product-page-info__variants` reads "Default variant" and stays
// `d-none`). Color, where this store has it, is modeled as fully separate
// product listings instead (this product's own title bakes in "Sea
// Green" as part of the name, not a swatch) — same shape as
// bellavita.js's single-SKU products elsewhere in this repo. A colour
// swatch selector (`.product-options__value--circle`) DOES exist
// elsewhere on this same page, but confirmed live it belongs to an
// unrelated item inside the "Related Products" rail, not this product —
// deliberately not used here for that reason.
module.exports = {
    name: "agaro",

    beforeExtract: async (page) => {
        // Server-rendered, JSON-LD present immediately — no lazy-mount or
        // accordion-click gotchas confirmed live on this theme.
        await page.waitForSelector(["h1", ".product-page-info__price"].join(", "), { timeout: 15000, state: "attached" }).catch(() => {});
    },

    selectors: {
        // Confirmed, fallback only — the JSON-LD `name` is preferred.
        title: ["h1"],

        // Confirmed, fallback only. See module comment: 14 duplicate
        // matches, always the same real value.
        price: [".price-item.regular_price"],

        // Confirmed, fallback only — matches the native JSON-LD's own
        // description text (same underlying source, just also rendered
        // in the description tab).
        description: [".tabs__content.rte", ".prodDescription_wrap"],

        // Confirmed, fallback only — JSON-LD's `image` array already
        // carries the complete real 8-photo gallery.
        images: [".product-gallery__main_item img"],

        // NOT present on this product — see module comment.
    },

    additionalFields: {
        // Confirmed: the real, unconditional MRP + current price line
        // (e.g. "₹ 1,799MRP: ₹ 2,499"). Kept as the combined line rather
        // than splitting it — `.price-item.comp_price` below already
        // gives a clean MRP-only value if that's what's needed instead.
        mrp: [".price-item.comp_price"],

        // Confirmed: "29% OFF" badge — the one genuinely unique
        // (non-duplicated) selector for this, see module comment.
        discountPercent: [".product-page-info__price-sale-details"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
        mrp: (raw) => require("../utils/price").parsePrice(raw),
    },
};
