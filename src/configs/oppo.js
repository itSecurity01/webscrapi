// Config for oppo.com (the India storefront, /in/product/<slug>.P.<id>),
// originally built from a partial product page (OPPO Reno16 5G,
// /in/product/reno16-5g.P.P1110156) supplied by the user on 2026-09-14 (cut
// off before any `<script type="application/ld+json">` block reached us),
// then verified against a real, LIVE run on the same date via an actual
// Playwright `scrapeProduct()` call — see that run's `trace` below for what
// it confirmed.
//
// CORRECTION from that live run: this page DOES emit schema.org Product
// JSON-LD (name/brand/price/currency/sku all confirmed coming from it) —
// contrary to what the truncated supplied markup suggested. Two confirmed
// JSON-LD GAPS needed a `beforeExtract` fix, same "patch it in place before
// extraction" technique as muscleblaze.js in this repo:
//   - `color` is a bare STRING of just the currently-selected color
//     ("Starry White"), never a `hasVariant` array — so
//     collectJsonLdVariantValues() in scraper.js only ever sees that one
//     value and the other 2 real color options (confirmed in the DOM) never
//     surface. Patched into a proper `color` array of all 3 before
//     extraction.
//   - `image` only lists the 4 `.is-sku` renders for the current color, not
//     the ~13-slide marketing gallery visible in the DOM banner carousel.
//     Patched with the full DOM gallery before extraction.
//
// Also confirmed live: the Protection Plan list
// (additionalFields.protectionPlanNames/Prices below) is a genuine
// client-side hydration RACE, not a scroll-dependent lazy-load — it came
// back EMPTY on some runs and populated (3/3) on others with the exact same
// wait+scroll sequence, purely depending on how much wall-clock time had
// elapsed. Fixed with an explicit `waitForSelector(".insurance-item")`
// instead of a blind timeout; confirmed reliable (3/3 items) across 3
// repeated live runs after that fix. Non-fatal if it times out — not every
// product may offer protection plans.
//
// NOTE: `sizes` below is mapped to STORAGE capacity (e.g. "8+256GB",
// "12+256GB"), not a physical garment size — this is a phone PDP with two
// variant dimensions, Color and Storage, and storage is the closer
// conceptual match to `sizes` of the two.
module.exports = {
    name: "oppo",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1.product-name", ".swiper-banner__banner img"].join(", "), {
                timeout: 15000,
                state: "attached",
            })
            .catch(() => {});

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

        // See the big module comment above: the Protection Plan list is a
        // genuine hydration race, confirmed flaky with a blind scroll+
        // timeout — wait for it explicitly instead. Non-fatal if it never
        // appears (not every product may offer protection plans).
        await page.waitForSelector(".insurance-item", { timeout: 10000 }).catch(() => {});

        // See the big module comment above for *why* this exists — patches
        // two confirmed JSON-LD gaps (a single-string `color` instead of
        // the full option list, and a sparse `image` array missing most of
        // the marketing gallery) directly into the existing Product
        // JSON-LD, so scraper.js's normal JSON-LD-first extraction picks up
        // the complete data with no DOM `colors`/`images` selector even
        // needing to run.
        await page.evaluate(() => {
            try {
                // Only the Color option-group's labels are wanted, not
                // Storage's — find the ".option" block whose own heading is
                // literally "Color" (same technique as the DOM `colors`
                // selector) rather than assuming a fixed position.
                const colorGroup = [...document.querySelectorAll(".option")].find(
                    opt => (opt.querySelector(".cell .title")?.textContent || "").trim() === "Color"
                );
                const colors = colorGroup
                    ? [...colorGroup.querySelectorAll(".option-item .label__title")].map(el => el.textContent.trim()).filter(Boolean)
                    : [];

                const galleryUrls = [...document.querySelectorAll(".swiper-banner__banner img.swiper-image")]
                    .map(img => img.currentSrc || img.src)
                    .filter(Boolean);

                if (colors.length === 0 && galleryUrls.length === 0) return;

                for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                    try {
                        const data = JSON.parse(script.textContent);
                        const nodes = Array.isArray(data) ? data : Array.isArray(data["@graph"]) ? data["@graph"] : [data];
                        const product = nodes.find(
                            n => n && (n["@type"] === "Product" || (Array.isArray(n["@type"]) && n["@type"].includes("Product")))
                        );
                        if (product) {
                            if (colors.length > 0) product.color = colors;
                            if (galleryUrls.length > 0) product.image = [...new Set(galleryUrls)];
                            script.textContent = JSON.stringify(data);
                            break;
                        }
                    } catch {
                        // Not JSON, or not this block — try the next <script>.
                    }
                }
            } catch {
                // Swallow — falls through to JSON-LD's original (sparser) values.
            }
        });
    },

    selectors: {
        // Confirmed: <h1 class="product-name ...">OPPO Reno16 5G</h1>
        title: ["h1.product-name", "h1"],

        // Confirmed: "₹66,999" current selling price for the currently
        // selected color/storage combo.
        price: [".product-information__price .sale-price", ".sale-price", ".price"],

        // NOT present in the supplied markup — no dedicated single
        // "description" block was visible for this product (the page's
        // marketing copy lives in a "Why OPPO Store" tab and rich-content
        // sections further down, none of which reduce to one clean
        // paragraph). Left empty rather than guessing wrong; last-resort
        // generic fallbacks kept only in case a different OPPO product page
        // does carry one.
        description: [".product-description", '[data-testid="description"]', ".pdp-description"],

        // Confirmed: the full gallery, including the duplicate `.is-sku`
        // color-variant renders at the end of the carousel — all genuine
        // <img> tags with real (non-lazy-placeholder) `src` values already
        // populated in the supplied markup. Falls back to the (lower-
        // resolution, 360x360-cropped) desktop thumbnail strip if the main
        // banner selector ever comes up empty.
        images: [".swiper-banner__banner img.swiper-image", ".thumbnail-list--desktop .thumbnail-image"],

        // Confirmed: color swatch labels ("Starry White", "Twilight
        // Violet", "Stellar Purple") — scoped via Playwright's `:has()` +
        // `:text-is()` to the ".option" block whose own heading is
        // literally "Color", since Storage (below) reuses the exact same
        // `.option-item .label__title` structure and would otherwise also
        // match here.
        colors: ['.option:has(.cell .title:text-is("Color")) .option-item .label__title'],

        // Confirmed: storage-capacity labels ("8+256GB", "12+256GB") — see
        // the module comment above for why this fills `sizes`. Same
        // `:has()`/`:text-is()` scoping technique as `colors`, targeting
        // the "Storage" heading instead.
        sizes: ['.option:has(.cell .title:text-is("Storage")) .option-item .label__title'],
    },

    additionalFields: {
        // Confirmed: struck-through original price ("₹89,999"). Raw text,
        // not parsed to a number (matches how `mrp` is kept raw in the
        // other configs in this repo).
        mrp: [".original-price del"],

        // Confirmed: "25% off" badge next to the price.
        discountPercent: [".discount-rate"],

        // Confirmed: "(incl. of all taxes)" note next to the price.
        taxNote: [".tax-tip"],

        // Confirmed: the currently-selected color + storage combo shown
        // next to the title (e.g. "Starry White", "8+256GB") —
        // `multiple: true` since it's always exactly these two values in
        // sequence, not one composite string.
        selectedVariant: { selectors: [".label-list .label-item"], multiple: true },

        // Confirmed: bank/EMI offer callouts (e.g. "Or from ₹5,583/mo.
        // with no cost EMI.", "10% instant bank discount up to ₹6,699.").
        bankOffers: { selectors: [".offer-list .offer-item .offer-description"], multiple: true },

        // Confirmed: "Buy with Exchange" trade-in callouts — the headline
        // savings figure and the separate trade-in-device bonus figure are
        // two different numbers on this page (not present at all on a
        // product with exchange disabled, so expect null there).
        exchangeSavings: [".product__trade-in__entry .btn .save"],
        exchangeBonus: [".product__trade-in__entry .bonus .val"],

        // Confirmed: Protection Plan (extended warranty / screen /
        // accident cover) list — name and price captured as two parallel
        // lists (same row order in both) rather than one combined string,
        // since each row's price sits in a sibling node with no shared
        // wrapper text. NOTE: "Show more"-gated plans (anything past the
        // first 2, collapsed behind a `.show-more` toggle) ARE still
        // present in the DOM here (`max-height: 0` is a CSS collapse, not
        // removal) — confirmed against the supplied markup showing a 3rd
        // "Extended Warranty" plan inside `.show-more__content` — so both
        // lists should already include every plan without needing to click
        // "Show more".
        protectionPlanNames: { selectors: [".insurance-item .insurance-spuname"], multiple: true },
        protectionPlanPrices: { selectors: [".insurance-item__price"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
