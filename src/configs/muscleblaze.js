// Config for muscleblaze.com, built against a real product page (MuscleBlaze
// Biozyme Iso-Zero, /sv/muscleblaze-biozyme-iso-zero/SP-45405) — the body
// markup was supplied by the user on 2026-09-12, then checked against a live
// fetch of that same URL (the user only pasted body HTML, no <head>, so the
// live fetch was needed to confirm JSON-LD behavior).
//
// CONFIRMED via that live fetch: MuscleBlaze emits real schema.org `Product`
// JSON-LD, and scraper.js's JSON-LD-first extraction picks it up correctly
// for name/brand/price/currency/description/sku — all of the DOM selectors
// below for those fields are fallbacks only; check `trace.*.source` first.
// ONE confirmed gap: that JSON-LD's `image` array only ever lists a single
// photo, while the real on-page gallery has ~18. Since scraper.js takes
// JSON-LD's images outright the moment that array is non-empty (see its
// "--- images ---" block), the DOM `images` selector below would otherwise
// never even run. Rather than fight that priority (which is exactly right
// for the other fields), `beforeExtract` directly patches the real JSON-LD
// node's `image` field in place with the full gallery collected from the
// DOM — every other field is left exactly as the site provides it.
//
// MuscleBlaze's site (HealthKart's "HK" platform) is a React app whose
// elements mostly carry TWO classes: a plain, human-readable one
// (e.g. "banner-heading", "offer-price", "PIC__item") plus a CSS-modules
// hashed one (e.g. "pdpdesktop_banner-heading__EkIUd",
// "priceSectionTag_offer-price__GbHif"). Every selector below deliberately
// targets the PLAIN class only — those read like intentional, stable hooks
// (several even look like they're also used for analytics, e.g. the
// "hk-elements--addToCart" buttons) — never the "_..__HASH" half, which can
// change on any deploy. The `additionalFields` marked "Biozyme-only" below
// are the one exception: no plain-class hook exists for them, so they use
// the hashed class as-is and are more brittle / product-family-specific.
module.exports = {
    name: "muscleblaze",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector([".banner-heading h1", ".hk-packproductsummary"].join(", "), {
                timeout: 15000,
                state: "visible",
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

        // The gallery (and the "prod-info-sec" block below the fold)
        // lazy-render on scroll — this MUST happen before the image-patch
        // evaluate() below, not after: with the wait/scroll placed after
        // instead (an earlier version of this file had it that way),
        // `.PIC__item img.main[alt]` sometimes still had only a handful of
        // thumbnails hydrated, silently patching in a partial gallery. Confirmed
        // by re-running against the live page repeatedly with both orderings.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
        // Belt-and-suspenders over the fixed wait above: don't proceed until
        // at least one real thumbnail has hydrated (swiper sometimes needs a
        // beat longer than 300ms depending on network conditions).
        await page.waitForFunction(() => document.querySelectorAll(".PIC__item img.main[alt]").length > 0, { timeout: 5000 }).catch(() => {});

        await page.evaluate(() => {
            // Fix 1: each `.PIC__item img.main`'s `src` is a 160x160
            // cdn-cgi-resized thumbnail
            // (".../cdn-cgi/image/width=160,height=160,dpr=1/..."), but its
            // `alt` attribute holds the genuine full-resolution original URL
            // (extractImages() in scraper.js only ever reads `src`/
            // `currentSrc`/`srcset`/`dataset.src` — never `alt`). Swap
            // src<-alt for every thumbnail whose alt looks like a URL, and
            // collect the full-res list for fix 2 below. This also makes the
            // DOM `images` selector correct on its own, for the (currently
            // never-hit, see module comment) case where it's actually used.
            const fullResUrls = [];
            document.querySelectorAll(".PIC__item img.main[alt]").forEach(img => {
                if (/^https?:\/\//.test(img.alt)) {
                    if (img.alt !== img.src) img.src = img.alt;
                    fullResUrls.push(img.alt);
                }
            });

            // Fix 2 (the one that matters in practice — see module comment):
            // patch the real Product JSON-LD's sparse `image` field with the
            // full gallery, in place, leaving every other field untouched.
            if (fullResUrls.length === 0) return;
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                try {
                    const data = JSON.parse(script.textContent);
                    const nodes = Array.isArray(data) ? data : Array.isArray(data["@graph"]) ? data["@graph"] : [data];
                    const product = nodes.find(
                        n => n && (n["@type"] === "Product" || (Array.isArray(n["@type"]) && n["@type"].includes("Product")))
                    );
                    if (product) {
                        product.image = [...new Set(fullResUrls)];
                        script.textContent = JSON.stringify(data);
                        break;
                    }
                } catch {
                    // Not JSON, or not this block — try the next <script>.
                }
            }
        });
    },

    selectors: {
        // Confirmed: <h1>MuscleBlaze Biozyme Iso-Zero</h1> inside
        // .banner-heading. The flavour/weight line right under it
        // ("Low carb Ice Cream Chocolate • 1 kg") is deliberately NOT
        // appended here — it's captured separately as
        // additionalFields.variantLabel since it describes the selected
        // variant, not the product name.
        title: [".banner-heading h1", "h1"],

        // Confirmed: "₹5,799" current/offer price. `parsePrice()` already
        // recognizes the "₹" symbol, so no custom `parse.price` override is
        // needed here (unlike wishluck.js's "Rs." case).
        price: [".offer-price", '[data-testid="price"]', ".price"],

        // Confirmed: the full "About the Product" tab content — a large
        // block of marketing copy/embedded infographic images (only the
        // "Description" sub-tab is loaded by default; "Key Benefits" and
        // "Nutritional Information" are separate tabs not present in this
        // markup, i.e. probably fetched on click and NOT recoverable via a
        // plain selector — expect this to only ever cover the Description
        // tab). Very long and includes stray "&nbsp;" runs; clean up
        // downstream if needed, same caveat as tatacliq.js's fallback
        // description selector.
        description: [".pdp-details__content", ".prod-info-sec"],

        // Confirmed: product photo strip. Primary selector is the
        // thumbnail-with-swapped-src trick from beforeExtract above (full
        // resolution once swapped, and covers every angle); the current
        // hero image (`.PIC__zoom img`, already full-resolution, no swap
        // needed) is a fallback in case the thumbnail strip structure ever
        // changes — it alone would return only ONE image, not the full set.
        images: [".PIC__item img.main", ".PIC__zoom img"],

        // NOT present in the supplied markup — the "Choose Flavour and
        // Weight" block only shows the CURRENTLY selected variant
        // (captured as additionalFields.variantLabel below) plus a "Change"
        // toggle; the actual list of other flavour/weight options it opens
        // wasn't in the markup supplied (probably rendered into a modal/
        // drawer on click, not present in the initial DOM). `sizes` is
        // therefore omitted rather than guessed — it'll correctly come back
        // as an empty array with a "missing" trace.
        //
        // `colors` is also omitted entirely: this is a protein-powder PDP
        // (flavour/weight variants, not color) with no color-swatch UI
        // anywhere in the supplied markup.
    },

    additionalFields: {
        // Confirmed: "₹6,799" struck-through MRP. Raw text, not parsed to a
        // number (matches how `mrp` is kept raw in the other configs here).
        mrp: [".mrp-price"],

        // Confirmed: "14% off" badge next to the price.
        discountPercent: [".discount-tag"],

        // Confirmed: "4.4" (the star SVG icon inside the same span has no
        // text, so textContent trims down to just the number).
        rating: [".rtng-star-value"],

        // Confirmed: "1.1 k" review count.
        reviewCount: [".reviews"],

        // Confirmed: the currently-selected variant's flavour + weight,
        // e.g. "Low carb Ice Cream Chocolate • 1 kg". See the `sizes` note
        // above for why the full list of OTHER options isn't captured.
        variantLabel: [".flavour-and-tag-container"],

        // Confirmed: "Get 116 MB Cash" loyalty-reward line. Biozyme-family
        // page only (hashed class, no plain-class hook exists for this one)
        // — may not exist on non-Biozyme MuscleBlaze products at all.
        mbCashReward: [".pdpCommon_mb-reward__cXgyx"],

        // Confirmed, Biozyme-only: the cross-sell "Choose your protein"
        // radio group's option labels (e.g. "Performance Whey", "Iso-Zero",
        // "Gold 100% Whey", "Whey PR") — these are DIFFERENT products
        // (linked SKUs), not size/flavour variants of this one. Hashed
        // classes, no plain-class hook exists; likely absent outside the
        // Biozyme range entirely.
        proteinFamilyOptions: { selectors: [".biozymeRecommendation_label__gv__A"], multiple: true },

        // Confirmed: "USA Patented" trust badge + its one-line description.
        usaPatentBadge: [".usa-patent_title__rnOwh"],
        usaPatentDescription: [".usa-patent_desc__U82bx"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
