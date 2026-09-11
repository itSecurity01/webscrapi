// Config for shopsy.in, built against a real product page (QUEDDY'S Self
// Design Semi Stitched Lehenga Choli) supplied by the user on 2026-09-11.
//
// IMPORTANT CAVEAT: Shopsy's web app is React Native Web (RNW) + styled-
// components. Most classes on the page (`css-175oi2r`, `r-13awgt0`, ...) are
// atomic utility classes shared by hundreds of unrelated elements — they
// encode a single style rule (e.g. "flex:1"), not a component identity, and
// the hash can change on any Shopsy deploy. The selectors below were reverse
// -engineered from the ONE render supplied (matching against class
// *combinations* to disambiguate), but treat this whole file as more
// brittle than a normal CSS-class config and re-verify whenever scraping
// breaks. `sc-XXXXXXXX-N` classes come from styled-components and tend to
// be a bit more stable (per-component hash) than the `r-*`/`css-*` ones.
//
// Flipkart-family sites (Shopsy is Flipkart-owned) usually also emit
// schema.org Product JSON-LD for SEO — scraper.js already tries
// `<script type="application/ld+json">` before any DOM selector below, so
// check `trace.*.source === "json-ld"` first; if it's present, most of the
// fragile selectors here never even get used.
module.exports = {
    name: "shopsy",

    beforeExtract: async (page) => {
        // No consent banner was visible in the supplied markup; harmless
        // no-op if absent, kept for parity with the other configs.
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
        // The image carousel and size/color pickers can lazy-render on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed: the title block right under the breadcrumb
        // (<div class="...r-iphfwy"><div class="...r-iphfwy"><span>TITLE</span></div></div>)
        // plus the non-link breadcrumb crumb as a fallback (same text).
        title: [".r-iphfwy", ".r-k6jc1c", "h1"],

        // Confirmed: the two font-size:18px price nodes under the "% off"
        // badge — the SECOND one (class r-13hce6t) is the selling price
        // ("₹476"); the first (r-142tt33) is the struck-through MRP
        // ("1,999") and is captured separately below as `mrp`.
        price: [".r-13hce6t", '[data-testid="price"]', ".price"],

        // NOT confirmed — no description/details section was present in the
        // supplied markup (it may live further down the page, e.g. behind a
        // "Product details" accordion). Left as best-effort fallbacks only.
        description: [
            ".product-description",
            '[data-testid="description"]',
            ".pdp-description",
        ],

        // Confirmed: gallery <img> tags inside the styled-components
        // carousel track. extractImages() picks the largest srcset
        // candidate automatically (the pasted markup has 1x/2x srcset).
        images: [".sc-c07e066a-1 img", 'img[alt="Image Placeholder"]'],

        // Confirmed: color swatch captions ("BLUE", "GREEN", "MAROON", "WINE").
        colors: [".r-cfp7ip", '[data-testid="color-swatch"]'],

        // NOT fully confirmed as a stable hook — only one size ("Free") was
        // present, and its class list overlaps with unrelated layout nodes
        // elsewhere on the page. Best-effort compound-class guess.
        sizes: [".r-1b43r93.r-tuq35u", '[data-testid="size-selector"]'],
    },

    // Arbitrary extra fields beyond the fixed product shape.
    additionalFields: {
        // Confirmed: struck-through original price ("1,999"). NOTE:
        // additionalFields are always stored as raw text (no `parse` hook
        // support beyond the top-level `price` field — see scraper.js) —
        // strip the comma / parse to a number downstream if you need it.
        mrp: [".r-142tt33"],
        // Confirmed: "76% off" badge next to the price.
        discountPercent: [".r-1pb6agd"],
        // Confirmed: "10 ratings and 1 reviews" summary line.
        ratingsSummary: [".r-14yzgew"],
        // Confirmed: seller name ("ZANVI"). Compound class needed —
        // `.r-1kb76zh` alone also matches an unrelated <svg> icon that has
        // no text and would shadow the real match.
        sellerName: [".r-1kb76zh.r-1ozqkpa"],
        // Confirmed: seller's own star rating badge ("3.9 ★").
        sellerRating: [".r-15zeulg"],

        // Confirmed but fragile — the single visible review's title/body/
        // author. Marked `multiple: true` so this still works if a future
        // page render shows several reviews stacked the same way.
        reviewTitles: { selectors: [".r-1cvj4g8"], multiple: true },
        reviewTexts: { selectors: [".r-11f147o"], multiple: true },
        reviewers: { selectors: [".r-1bymd8e.r-3hmvjm.r-1ozqkpa"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
