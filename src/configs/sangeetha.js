// Config for sangeetha.com, built AND live-verified (direct Playwright
// navigation + DOM inspection, no markup was pasted) against a real product
// page (Nothing Phone (4b) 8GB 128GB Blue, /product-details/nothing-
// phone-4b-8gb-128gb-blue-a10400367/20861) on 2026-09-14.
//
// This is a Next.js storefront (`/_next/image`, `data-nimg` throughout)
// with NO schema.org JSON-LD anywhere on the page (confirmed: zero
// `<script type="application/ld+json">` blocks) — every field below relies
// entirely on DOM selectors. Because of that, `brand` will ALWAYS come back
// null: scraper.js's `brand` field has no DOM fallback at all anywhere in
// scraper.js itself (see its "--- brand ---" block). The DOM DOES carry a
// brand name (in the Specs section, confirmed "Nothing") — captured as
// `additionalInfo.brandDom` below as a substitute, same convention as
// tatacliq.js's brandName field in this repo. Class names throughout are
// plain and human-readable (not atomic/hashed), similar in stability to
// tatacliq.js/moglix.js in this repo.
//
// IMPORTANT PRICE GOTCHA, confirmed live and easy to get wrong: the page
// shows TWO different "price" numbers up top, and they mean different
// things —
//   - `.price_bank_offer` ("₹37,374", labeled "with Bank Offers") is a
//     CONDITIONAL price only achievable by paying with a specific bank
//     card, next to a "32% Off" badge (`.best_price__totalOff`) that's
//     computed against THAT price, not the real one.
//   - `.best_price__total` ("₹39,999") is the actual, unconditional selling
//     price — confirmed by checking the struck-through MRP right next to
//     it (`.best_price__old`, "₹54,999": 54999→39999 is the real ~27%
//     discount; 54999→37374 is where the unrelated "32% Off" bank-offer
//     badge's math actually comes from).
// `price` below is deliberately `.best_price__total`, NOT
// `.price_bank_offer` — the bank-offer figure is captured separately as
// `additionalInfo.bankOfferPrice`/`bankOfferDiscountPercent`, clearly
// labeled so it's never mistaken for the product's real price.
module.exports = {
    name: "sangeetha",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1.product-name", ".product-gallery img"].join(", "), {
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

        // The Highlights/Specs tab content and offers list can lazy-render
        // on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed: <h1 class="product-name ...">.
        title: ["h1.product-name", "h1"],

        // Confirmed: the REAL selling price — see the big "PRICE GOTCHA"
        // module comment above for why this must NOT be
        // `.price_bank_offer`.
        price: [".best_price__total", ".price"],

        // Confirmed: the "Product Highlights" bullet list — no schema.org
        // description exists anywhere on this page (see module comment),
        // so this raw bullet-point text is the best available substitute.
        description: [".highlights_web_prod_highlights", ".highlights_web_prod_highlights ul"],

        // Confirmed: the main carousel's full-resolution photos (6 unique
        // shots, duplicated a few times in the DOM for the carousel's
        // infinite-loop clone slides — extractImages()'s Set dedupes that
        // automatically). Deliberately scoped to `.react-multi-carousel-
        // track`, NOT the whole `.product-gallery` — that broader
        // container ALSO includes the dot-navigation thumbnail strip
        // (`.react-multi-carousel-dot-list`), which re-renders the SAME
        // photos through a `/_next/image` proxy capped at a tiny 96px —
        // confirmed live that including it just adds low-res duplicate
        // URLs alongside the real ones, not any new photos.
        images: [".product-gallery .react-multi-carousel-track img"],

        // Confirmed: RAM+Storage variant pills (e.g. "8GB + 128GB",
        // "8GB + 256GB") — scoped via the theme's own `.variant_storage__col`
        // modifier class, which distinguishes this variant group from the
        // Color group right below it (both otherwise share the exact same
        // `.variant__col`/`.color-txt__sanNew` structure).
        sizes: [".variant__col.variant_storage__col p.color-txt__sanNew"],

        // Confirmed: color swatch labels (e.g. "Black", "White", "Blue") —
        // the inverse of the `sizes` scoping above (`:not(...)` excludes
        // the Storage group's pills, which would otherwise also match this
        // same base selector). NOTE: this scoping assumes exactly these
        // two variant groups (Storage, Color) exist on the page, confirmed
        // true for this product — a Sangeetha product with a 3rd variant
        // dimension would need re-scoping, not yet seen on any page
        // checked so far.
        colors: [".variant__col:not(.variant_storage__col) p.color-txt__sanNew"],
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹54,999"). Raw text, not parsed
        // to a number (matches how `mrp` is kept raw in the other configs
        // in this repo).
        mrp: [".best_price__old"],

        // Confirmed — see the big "PRICE GOTCHA" module comment above:
        // these two describe the BANK-CARD-CONDITIONAL price, not the
        // product's real price/discount (those are the top-level `price`
        // field and `mrp` above respectively). Deliberately named
        // differently from a plain "discountPercent" so they're never
        // confused with the real MRP→price discount, which this page
        // doesn't display as a clean percentage anywhere.
        bankOfferPrice: [".price_bank_offer"],
        bankOfferDiscountPercent: [".best_price__totalOff"],

        // Confirmed: DOM brand name backup — see module comment above for
        // why the top-level `product.brand` will always be null on this
        // site. Scoped via `:has()` + `:text-is()` off the Specs section's
        // own "Brand" label rather than position, since row order isn't
        // guaranteed stable across products.
        brandDom: ['.prod_web_specs__box:has(h6:text-is("Brand")) p'],
        modelName: ['.prod_web_specs__box:has(h6:text-is("Model Name")) p'],
        modelSeries: ['.prod_web_specs__box:has(h6:text-is("Model Series")) p'],
        condition: ['.prod_web_specs__box:has(h6:text-is("Condition")) p'],

        // Confirmed: every Specs row as two parallel raw lists (same row
        // order in both) — a category-agnostic catch-all covering whatever
        // fields a given product's spec box actually has (only 5 confirmed
        // on this product: Type, Condition, Model Name, Brand, Model
        // Series — a much sparser spec sheet than a laptop/appliance
        // listing, expected for a phone retailer's minimal template).
        specLabels: { selectors: [".prod_web_specs__content h6"], multiple: true },
        specValues: { selectors: [".prod_web_specs__content p"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
