// Config for boat-lifestyle.com, originally built from a partial product
// page (Rockerz 255 Pro+) supplied by the user on 2026-09-10, then verified
// against a second, real, LIVE product page (Rockerz Summit,
// /products/boat-rockerz-summit-wireless-earphone-with-30h-playback) on
// 2026-09-14 via an actual Playwright run (`scrapeProduct()` called
// directly, not just markup review) — see that run's `trace` below for what
// it confirmed.
//
// CONFIRMED LIVE (2026-09-14 run) — every one of these had
// `trace.*.source === "json-ld"` or `"dom"` with `success: true`:
//   - name/brand/price/currency/sku/images all come from Shopify's own
//     Product JSON-LD automatically (boat-lifestyle.com does emit it) —
//     none of the DOM `title`/`price`/`images` selectors below actually ran
//     on that page; they only matter as the fallback path if JSON-LD is
//     ever missing/malformed, or as the confirmed values (title, images)
//     when checked directly.
//   - description: JSON-LD's `description` came back as an empty string
//     `""` (falsy, so scraper.js correctly fell through) — this particular
//     product apparently has no long-form description in Shopify admin at
//     all (its "Description" tab has no content block in the DOM either,
//     confirmed by direct inspection) — `.pdp-title-extra-info` (the
//     one-line tagline) is genuinely the best available text here, not a
//     failed selector.
//   - additionalFields.rating, .reviewCount, .couponOffer, .tagline,
//     .category, .bulkPurchaseOffer — all confirmed via the DOM.
//   - colors/sizes: confirmed EMPTY is correct for this product — direct
//     inspection found zero variant-picker markup of any kind
//     (`variant-radios`, `.product-form__input`, swatch inputs, `<select
//     name="id">`, ...) anywhere on the page; boAt audio gear commonly
//     ships as a single SKU/color with no picker at all. The `colors`
//     selector guesses below are therefore STILL unconfirmed as a genuine
//     hit — only confirmed as correctly-empty on a colorless product; find
//     a boAt product that actually has a color picker before trusting them.
//
// Boat is Shopify-based and emits real Product JSON-LD — check
// `trace.*.source` first; DOM selectors below are the fallback path.
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
        // Confirmed: <h1 class="product-meta__title heading h3"> boAt Rockerz ... </h1>
        title: [".product-meta__title", "h1.product-meta__title", "h1"],

        // Not confirmed as an actual hit (JSON-LD supplies price on every
        // live page checked so far — see module comment), but kept as the
        // fallback path. <product-meta ... price-class="price--large" ...>
        // strongly implies a price element carrying the class
        // "price--large" somewhere inside it — guessing the usual Shopify
        // Dawn price-list markup as a starting point.
        price: [
            "price-list.price--large .price-item--sale",
            "price-list.price--large .price-item--regular",
            ".price--large .price-item--sale",
            ".price--large .price-item--regular",
            ".price--large",
            '[data-testid="price"]',
            ".price",
        ],

        // Confirmed (as the correct FALLBACK, not the ideal description —
        // see module comment: JSON-LD's description is genuinely empty on
        // every product checked so far, so this is what actually gets
        // used). `.pdp-title-extra-info` is only the one-line tagline under
        // the title; the other three are last-resort guesses for a boAt
        // product that does carry a real long-form description.
        description: [
            ".product-description",
            '[data-testid="description"]',
            ".product__description",
            ".pdp-title-extra-info",
        ],

        // Confirmed: gallery <img> tags inside each carousel slide.
        images: [
            "product-media .product__media-item img",
            ".product__media-item img",
            ".product__media img",
            ".product-gallery img",
        ],

        // Not confirmed as a genuine hit — every boAt product checked so
        // far (2 now) has been single-SKU with zero variant-picker markup
        // of any kind, so this has only ever been verified as
        // correctly-empty, never as an actual match. Kept as a best-effort
        // guess for a boAt product that does have a color picker.
        colors: [".variant-color-swatch", '[data-testid="color-swatch"]', ".color-swatches li"],
        // boAt audio gear generally has no size variant — omit `sizes` entirely rather
        // than guess; it'll correctly show up as an empty array with a "missing" trace.
    },

    additionalFields: {
        // Confirmed against two different live products.
        rating: [".rating__stars"],                 // e.g. "4.8"
        reviewCount: [".rating__caption"],           // e.g. "(487)"
        tagline: [".pdp-title-extra-info"],          // one-line subtitle under the title

        // Confirmed: the single-use coupon-code callout (e.g. "Get at
        // ₹899 by using GRAB400"). When BOTH this and a bulk-purchase
        // callout (below) are present, this selector's plain
        // `.offer-callout-simple` matches whichever renders first in DOM
        // order — confirmed on a live page to be this one, not the bulk
        // offer, but that ordering isn't guaranteed by any class name, just
        // observed on the one page checked.
        couponOffer: [".offer-callout-simple"],

        // Confirmed: a SEPARATE "buy more, save more" callout that can
        // appear alongside couponOffer above (e.g. "Get 5% OFF on purchase
        // of 2 or more items") — scoped away from `.offer-fixed-pdp`
        // (the coupon-code block) so it doesn't just re-match couponOffer's
        // own text. Not present on every product.
        bulkPurchaseOffer: [".product-offer-pdp:not(.offer-fixed-pdp) .offer-callout-simple"],

        // Confirmed: the breadcrumb's category link, hooked via its
        // `/collections/...` href rather than DOM position (breadcrumb
        // depth can vary) — e.g. "boAt — Bluetooth ...". NOTE: that
        // trailing "..." is baked into the actual anchor text on the live
        // page (a genuinely truncated label from boAt's own menu data, not
        // CSS ellipsis) — this is really the raw category name, ellipsis
        // included, not a broken selector.
        category: ['.breadcrumb__link[href^="/collections/"]'],

        // Not confirmed — no matching markup was visible in the supplied snippet.
        warranty: ['[data-testid="warranty"]', ".warranty-info"],
        batteryLife: ['[data-testid="battery-life"]', ".spec-battery-life"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
