// Config for boat-lifestyle.com, built against a real product page
// (Rockerz 255 Pro+) supplied by the user on 2026-09-10.
//
// CONFIRMED against that real markup:
//   - title            -> .product-meta__title
//   - additionalFields.rating, .reviewCount, .couponOffer, .tagline
//
// NOT confirmed — the page markup for these was cut off before it reached us
// (price block, gallery <img> tags, size/color variant picker). They're
// best-effort guesses based on common Shopify Dawn-theme conventions and the
// `price-class="price--large"` attribute visible on <product-meta>. Verify
// with `node src/index.js --headed --website=boat --limit=1 --force` and
// check product.json's `trace` — anything "success": false needs the real
// selector pasted in and swapped in below.
//
// Boat is Shopify-based, and most Shopify themes emit Product JSON-LD, so
// name/price/images/sku may well come from JSON-LD automatically before any
// of these DOM selectors are even used — check `trace.*.source` first.
module.exports = {
    name: "boat",

    beforeExtract: async (page) => {
        // Dismiss a cookie/consent banner if present — best-effort, ignore failures.
        // (No consent banner was visible in the supplied markup; harmless no-op if absent.)
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
        // The gallery is a MultiCarousel that may lazy-render extra slides on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed: <h1 class="product-meta__title heading h3"> boAt Rockerz 255 Pro+ </h1>
        title: [".product-meta__title", "h1.product-meta__title", "h1"],

        // Not confirmed. <product-meta ... price-class="price--large" ...> strongly implies
        // a price element carrying the class "price--large" somewhere inside it — guessing
        // the usual Shopify Dawn price-list markup as a starting point.
        price: [
            "price-list.price--large .price-item--sale",
            "price-list.price--large .price-item--regular",
            ".price--large .price-item--sale",
            ".price--large .price-item--regular",
            ".price--large",
            '[data-testid="price"]',
            ".price",
        ],

        // Not confirmed as the full product description (that content wasn't in the
        // supplied markup — likely a details/accordion section further down the page).
        // .pdp-title-extra-info is only the one-line tagline under the title, kept here
        // purely as a last-resort fallback so `description` isn't always empty.
        description: [
            ".product-description",
            '[data-testid="description"]',
            ".product__description",
            ".pdp-title-extra-info",
        ],

        // Not confirmed — the actual <img> tags inside .product__media-item were cut off.
        // Guessing based on the visible <product-media>/.product__media-item structure.
        images: [
            "product-media .product__media-item img",
            ".product__media-item img",
            ".product__media img",
            ".product-gallery img",
        ],

        // Not confirmed — no color-swatch markup was visible in the supplied snippet.
        colors: [".variant-color-swatch", '[data-testid="color-swatch"]', ".color-swatches li"],
        // boAt audio gear generally has no size variant — omit `sizes` entirely rather
        // than guess; it'll correctly show up as an empty array with a "missing" trace.
    },

    // Confirmed against the supplied markup.
    additionalFields: {
        rating: [".rating__stars"],                 // e.g. "4.8"
        reviewCount: [".rating__caption"],           // e.g. "(487)"
        couponOffer: [".offer-callout-simple"],      // e.g. "Get at ₹1099 by using GRAB100"
        tagline: [".pdp-title-extra-info"],          // one-line subtitle under the title

        // Not confirmed — no matching markup was visible in the supplied snippet.
        warranty: ['[data-testid="warranty"]', ".warranty-info"],
        batteryLife: ['[data-testid="battery-life"]', ".spec-battery-life"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
