// Built from a single captured HTML snapshot of a Pepperfry VIP (product)
// page, not a live browser run — every selector below is labeled
// "confirmed" only in the sense of "present in that snapshot," not
// "verified working end-to-end." Re-check against a live page before
// relying on this, especially anything marked unconfirmed/fallback.
//
// Unlike the Shopify-based configs in this repo (controlz.js etc.),
// Pepperfry has no public per-product JSON endpoint to fetch, so the
// JSON-LD injected below is built by parsing the rendered DOM directly
// instead of via fetch().
module.exports = {
    name: "pepperfry",

    beforeExtract: async (page) => {
        // Angular Universal SSR: most content is in the initial HTML, but
        // the colour-swatch alt text and hero-image src look like they're
        // only filled in after hydration, so give the app a moment.
        await page
            .waitForSelector([".vip-share-name-container h1", ".vip-product-price-row"].join(", "), {
                timeout: 15000,
                state: "attached",
            })
            .catch(() => {});

        // No consent banner was present in the captured markup; harmless
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

        // Delivery/assembly details are pincode-gated ("Add Pincode to
        // Get Delivery and Assembly Details") and aren't needed for
        // product data, so deliberately left untouched.

        // No fetch() endpoint exists here (see module comment above), so
        // build the same kind of JSON-LD the Shopify configs get for
        // free, by parsing the rendered DOM instead.
        await page.evaluate(() => {
            try {
                const $ = (sel, root = document) => root.querySelector(sel);
                const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

                const name = $(".vip-share-name-container h1")?.textContent.trim();
                if (!name) return;

                // "₹8,999" / "₹12,999"
                const priceText = $(".vip-product-price-row .text-xxl.font-bold")?.textContent.trim();
                const toNumber = (t) => (t ? Number(t.replace(/[^\d.]/g, "")) : undefined);

                // Largest confirmed hero-image size across the
                // <picture><source> set (1600x1760 also appears on the
                // separate zoom-magnifier <img>, so it's a real ceiling,
                // not a guess).
                const srcsets = $$(".web-vip-main-img source[srcset]").map((s) => s.getAttribute("srcset"));
                const image = srcsets.length ? srcsets[0].replace(/\/\d+x\d+\//, "/1600x1760/") : undefined;

                // "Product Details" accordion: label/value pairs are
                // sibling divs sharing one wrapper (Brand, Assembly,
                // Dimensions, Primary Material, Room Type, Seating
                // Height, Warranty, Weight, Sku, ...) — the set of rows
                // isn't fixed across product categories, so this is
                // collected generically rather than one selector per
                // field.
                const details = {};
                $$('[data-test="vipProductDetailsItems"] > div').forEach((row) => {
                    const label = row.querySelector('[data-test="vipProductDetailsLabel"]')?.textContent.trim();
                    const value = row.querySelector('[data-test="vipProductDetailsValue"]')?.textContent.trim();
                    if (label && value) details[label] = value;
                });

                // Colour swatches: no reliable text label is rendered for
                // them — their <img alt> is Angular-bound and shows up
                // empty/"undefined" in the captured (pre/partial-
                // hydration) markup — so the colour name is recovered
                // from the listing-image filename instead, e.g.
                // ".../akira-...-in-grey-color-akira-h-sko1zi.jpg" ->
                // "grey". Unconfirmed on other products; this pattern
                // held for all three swatches seen here (grey/black/
                // green, "color" and "colour" spellings both present).
                const hasVariant = $$(".vip-color-option-image-wrapper").map((wrap) => {
                    const a = wrap.querySelector("a");
                    const img = wrap.querySelector("img");
                    const src = img && img.getAttribute("src");
                    const match = src && src.match(/-in-([a-z]+)-colou?r-/i);
                    return {
                        "@type": "Product",
                        color: match ? match[1] : undefined,
                        url: a && a.getAttribute("href"),
                    };
                });

                const jsonLd = {
                    "@context": "https://schema.org/",
                    "@type": "Product",
                    name,
                    brand: { "@type": "Brand", name: details["Brand"] || "Pepperfry" },
                    sku: details["Sku"],
                    image,
                    offers: {
                        "@type": "Offer",
                        price: toNumber(priceText),
                        priceCurrency: "INR",
                    },
                    additionalProperty: Object.entries(details).map(([k, v]) => ({
                        "@type": "PropertyValue",
                        name: k,
                        value: v,
                    })),
                    hasVariant,
                };

                const script = document.createElement("script");
                script.type = "application/ld+json";
                script.setAttribute("data-injected-by", "pepperfry-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below.
            }
        });

        // Colour-swatch carousel and thumb gallery both looked fully
        // present without scrolling in the snapshot, but keep a small
        // nudge for parity with the other lazy-gallery configs in case
        // that differs on other products.
        await page.mouse.wheel(0, 1500).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Fallback only — normally `name` comes from the injected
        // JSON-LD above. Scoped via the share-name wrapper since the h1
        // itself carries only generic utility classes (color-tertiary
        // text-lg font-medium) with nothing product-specific to key off.
        title: [".vip-share-name-container h1", "h1"],

        // Fallback only — normally `price` comes from the injected
        // JSON-LD. `.text-xxl.font-bold` is the large "sale" price in
        // the price row; the MRP figure nearby uses `.text-lg` instead,
        // so this shouldn't collide with it — but this is based only on
        // the captured markup, not a live run.
        price: [".vip-product-price-row .text-xxl.font-bold"],

        // NOT found anywhere in the captured markup — this snapshot only
        // covers the top VIP section (gallery/price/CTA/accordion
        // headers), and a free-text "Description" block, if Pepperfry
        // has one, sits outside it. Left empty rather than guessed; fill
        // in once that section has actually been seen on a live page.
        description: [],

        // Fallback only — the hero <img> in `.web-vip-main-img` ships
        // with no `src` in the captured markup (its sibling
        // `<picture><source>` elements carry the real srcset URLs, which
        // is what the JSON-LD injection above reads instead). This will
        // likely return an empty src until/unless hydration fills it in.
        images: [".web-vip-main-img img", ".web-vip-thumb-images img"],

        // Fallback only, and weak even then — see the colour-name
        // comment in beforeExtract. The swatch `<img alt>` renders
        // empty/"undefined" in the captured markup, so this mainly
        // exists for parity with the other configs; real colour names
        // come from the injected JSON-LD's `hasVariant`.
        colors: [".vip-color-option-image-wrapper img"],

        // NOT present — this SKU only varies by colour, no size/variant
        // option was observed. Left unset rather than invented for a
        // product that might not actually have one.
        sizes: [],
    },

    additionalFields: {
        // Confirmed in the captured markup: struck-through MRP, e.g.
        // "₹12,999".
        mrp: [".vip-product-mrp .text-lg"],

        // Confirmed: "(31% Off)" badge next to the price.
        discountPercent: [".vip-product-disc span"],

        // Confirmed: "4.5" rating figure near the title.
        rating: [".vip-product-rating"],

        // Confirmed: "(36-Month Warranty)" next to the rating.
        // Duplicated by the "Warranty" row inside the Product Details
        // accordion ("36 Months' Warranty") — kept here too since it
        // doesn't depend on the accordion being open.
        warranty: [".vip-warranty-container"],

        // Confirmed but promotional/time-limited: "Only For Today: Get
        // Cashback Worth ₹2,250". May not be present on every load.
        cashback: [".cashback-block .font-bold"],

        // Confirmed: "By Mintwud from Pepperfry" seller line under the
        // title.
        soldBy: [".vip-product-name span.color-orange"],
    },

    parse: {
        // "₹8,999" already uses the "₹" symbol the shared parser
        // recognizes (unlike controlz.js's "Rs." theme), so no extra
        // currency-symbol handling is needed — kept explicit rather than
        // omitted so a future "Rs."-prefixed variant is easy to slot in
        // here later.
        price: (raw) => require("../utils/price").parsePrice(raw),
        mrp: (raw) => require("../utils/price").parsePrice(raw),
    },
};
