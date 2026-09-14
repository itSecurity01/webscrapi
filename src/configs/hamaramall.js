// Config for hamaramall.com, built against a real product page (Lal Sweets
// Soan Papdi Prem - (200g - Pack of 2), /products/SKUE622579C) supplied by
// the user on 2026-09-14. Only the product-detail BODY markup was supplied
// (no <head>), so it's UNKNOWN whether this page also emits schema.org
// Product JSON-LD — scraper.js always tries that first regardless, so check
// `trace.*.source` on a live run; every selector below is the DOM fallback
// path and was verified against the one supplied render only.
//
// hamaramall.com is a Nuxt/Vue 3 app (scoped `data-v-xxxxxxxx` attributes,
// `data-nuxt-img` on decorative images) and looks to be a multi-vendor
// marketplace ("Lal Sweets" is a third-party store, linked via
// `/providers/<id>`, not the platform itself) — expect `brand` to often come
// back null: scraper.js's `brand` field only ever reads `jsonLd.brand.name`
// (no DOM fallback exists in scraper.js itself), and nothing in the supplied
// markup looks like a manufacturer/brand name distinct from the store name
// (captured instead as `additionalInfo.storeName` below) or the
// `additionalInfo.manufacturerName` highlight-table row.
//
// Rather than hook Tailwind's arbitrary-value utility classes (`text-[18px]`,
// `text-[#111111]`, ...) directly — these are exact style values, not
// component identities, and can drift on any redeploy the same way atomic
// classes do on other Tailwind-based sites in this repo — most selectors
// below instead key off STABLE, human-authored hooks the page already relies
// on for its own behaviour: real `alt` text (`img[alt="Product Image"]`,
// `img[alt="Store Logo"]`), CSS4 `:has()` relative to those same stable
// anchors, and (for the spec/highlights table, which has no class hooks at
// all — labels and values are both plain unstyled-looking `<p>` siblings)
// Playwright's `:text-is()` exact-text pseudo-class to pair each literal
// label with the value `<p>` right next to it. Bracket-class selectors are
// kept only as last-resort fallbacks.
module.exports = {
    name: "hamaramall",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1", 'img[alt="Product Image"]'].join(", "), {
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

        // The "OFFERS FOR YOU" coupon carousel (embla) sits well below the
        // fold and doesn't just need scroll-into-view — confirmed via a live
        // run that even one full-page wheel(0, 2000) + 300ms wait wasn't
        // enough for `.marquee-scroll` to mount (came back 0 matches);
        // several smaller scroll steps with pauses between them was. The
        // trailing waitForSelector is a non-fatal top-up in case a slower
        // load needs a bit more than the loop alone — some products may
        // have no active coupons at all, so this must never throw.
        for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, 1500).catch(() => {});
            await page.waitForTimeout(400);
        }
        await page.waitForSelector(".marquee-scroll", { timeout: 4000 }).catch(() => {});
    },

    selectors: {
        // Confirmed: the only <h1> on the page.
        // "text-[18px] text-[#111111] font-medium" kept as a fallback in
        // case a future render adds other <h1>s (e.g. section headers).
        title: ["h1", "h1.text-\\[18px\\]"],

        // Confirmed: the sale price ("₹ 169.00") is the <span> immediately
        // followed by the struck-through MRP <span class="line-through">,
        // in a row shaped [discount-badge, sale-price, mrp]. `:has()` off
        // that stable `.line-through` sibling avoids depending on either
        // span's own arbitrary-value classes. Bracket-class compound and a
        // generic `.price` kept as fallbacks.
        price: ["span:has(+ span.line-through)", "span.text-\\[20px\\].font-medium", ".price"],

        // Confirmed live, and confirmed WRONG without the `h1 + div` scope:
        // the page header also has an unrelated "Choose your location"
        // <p class="...line-clamp-2..."> earlier in the DOM (a "Deliver to"
        // location picker, present on every page of this site) — plain
        // `p.line-clamp-2` matches that FIRST and extractText() only ever
        // returns the first match, so the real description was never
        // reached. Scoping to the <div> that immediately follows the <h1>
        // (where the real description actually lives) fixes that. Also
        // confirmed live: no "Read More" toggle button exists in the DOM at
        // all for this product (despite being visible in the originally
        // supplied markup) — description length/overflow apparently
        // decides server-side (or per-render) whether that control renders,
        // so it isn't a reliable anchor either. `line-clamp-2` still only
        // visually truncates via CSS; the complete text is present in
        // `textContent`, which is all extractText() reads.
        description: ["h1 + div p.line-clamp-2", "h1 + div p.text-\\[16px\\]"],

        // Confirmed: the 4 thumbnail strip images, hooked via their stable
        // `alt="Product Image"` (shared with the large hero image variant
        // of the same photos, but the thumbnails alone already cover the
        // full gallery). extractImages() picks the largest srcset/src
        // automatically.
        images: ['img[alt="Product Image"]'],

        // NOT present in the supplied markup — this product (a packaged
        // sweet box) has no size/color variant picker, only an "ADD TO
        // CART" button. Both omitted rather than guessed; they'll correctly
        // come back as empty arrays with a "missing" trace on a product that
        // genuinely has none.
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹ 198.00"). Raw text, not parsed
        // to a number (matches how `mrp` is kept raw in the other configs
        // in this repo).
        mrp: ["span.line-through"],

        // Confirmed: "14%" discount badge, hooked via the stable
        // `alt="Discount arrow down icon"` on the icon inside it rather
        // than its `text-[#0BD09F]` color class. textContent comes back as
        // " 14% " (the <img> contributes nothing) — trim downstream if
        // needed.
        discountPercent: ['span:has(> img[alt="Discount arrow down icon"])'],

        // Confirmed: third-party store name ("Lal Sweets"), hooked via the
        // stable `alt="Store Logo"` on the logo image next to it rather than
        // its own utility classes. See module comment above for why this
        // isn't the top-level `product.brand`.
        storeName: ['div:has(> img[alt="Store Logo"]) span'],

        // Confirmed: "Not cancellable and no returns" return-policy line,
        // hooked via the stable `alt="Exchange policy icon"` on the icon
        // next to it.
        policyNote: ['div:has(> img[alt="Exchange policy icon"]) span'],

        // Confirmed: the Highlights spec table at the bottom of the page —
        // label and value are plain sibling <p> tags with no distinguishing
        // classes of their own, so each is hooked via Playwright's
        // `:text-is()` exact-match pseudo-class on the literal label text,
        // paired with the value <p> immediately after it via `+`. Robust to
        // Tailwind class churn since it depends only on the label wording;
        // will need updating if hamaramall ever renames these labels, and a
        // future product missing a given row will just come back null for
        // that field (not fatal).
        country: ['p:text-is("Country") + p'],
        manufacturerAddress: ['p:text-is("Manufacturer Address") + p'],
        manufacturerName: ['p:text-is("Manufacturer Name") + p'],
        manufacturedDate: ['p:text-is("Manufactured Month/Year") + p'],
        countryOfOrigin: ['p:text-is("Country of Origin") + p'],
        netQuantity: ['p:text-is("Net Quantity") + p'],

        // Confirmed but fragile: active coupon codes from the "OFFERS FOR
        // YOU" marquee carousel (e.g. "FESTIVE50", "SPRING20"). Each code is
        // repeated many times inside its own marquee track (for the
        // seamless-scroll illusion) — extractList() already de-duplicates
        // via Set, so this correctly comes back as one entry per real
        // coupon, not one per repeat. `multiple: true` since there can be
        // several active coupons.
        couponCodes: { selectors: [".marquee-scroll span.ml-6"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
