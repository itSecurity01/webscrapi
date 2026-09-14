// Config for lenovo.com (the India storefront, /in/en/p/laptops/...),
// built AND live-verified (direct Playwright navigation + DOM inspection,
// no markup was pasted) against a real product page (ThinkPad L14 Gen 6
// 14-inch Intel, /in/en/p/laptops/thinkpad/thinkpadl/lenovo-thinkpad-l14-
// gen-6-14-inch-intel/21s6s00k00) on 2026-09-14.
//
// Emits real schema.org Product JSON-LD (name/sku/mpn/brand/offers/image) —
// confirmed live, so name/brand/price/currency/sku should normally come
// from `trace.*.source === "json-ld"`. TWO confirmed gaps, neither fatal:
//   - JSON-LD carries no `description` field at all on this product (not
//     empty-string, just absent) — always falls through to the DOM
//     selector below.
//   - JSON-LD's `image` array has only ONE photo; the real gallery has far
//     more (21 <img> nodes, mostly 58x58 nav thumbnails plus one 584x584
//     hero) — see the beforeExtract fix below for why the DOM `images`
//     selector needs a URL rewrite to actually be useful when it runs.
//
// CONFIRMED SLOW TO RENDER: the price block is not in the initial
// server-rendered HTML at all (confirmed via raw HTML fetch — zero
// occurrences of the price anywhere) and needs several seconds of
// client-side rendering after `domcontentloaded` before it exists in the
// DOM (confirmed absent at +3s, confirmed present at +5s on repeated
// checks) — `beforeExtract` waits on the real price node explicitly rather
// than a fixed timeout guess.
//
// GALLERY GOTCHA (two parts, both fixed in beforeExtract below):
//   1. `.gallery-container img` src values carry explicit
//      `?width=58&height=58` (or similar) resize query params baked into
//      the CDN URL — there's no `srcset` for extractImages() to upsize from
//      (unlike most Shopify/Magento themes in this repo), so without a fix
//      every captured image would be a tiny 58x58 thumbnail. Confirmed live
//      that this CDN (`static.pub`) happily serves the SAME asset at any
//      requested size via that same query param (`?width=800` returned
//      real image bytes ~56x larger than `?width=58` for the identical
//      URL).
//   2. Because JSON-LD's own `image` array is non-empty (just sparse, one
//      photo), scraper.js takes it outright and the DOM `images` selector
//      below NEVER ACTUALLY RUNS in practice (same class of gap as
//      muscleblaze.js/oppo.js/moglix.js in this repo) — so a src-only
//      rewrite on the DOM elements wouldn't be enough on its own.
//      `beforeExtract` also patches the resized URLs directly into JSON-LD.
//      One filter applied while collecting them: `.gallery-container`
//      confirmed to include ELEVEN distinct assets, but one of them
//      (`.../ShareResource/optimized/shared/gallery/commercial-windows-11-
//      en-us.jpg`) is a Windows-11 PARTNER BADGE, not a product photo —
//      visually confirmed by fetching and viewing it, along with 2 of the
//      other 10 (genuine ThinkPad angle shots: a port/side view and an
//      open-lid front view). Excluded via its distinct `/ShareResource/`
//      path, which holds shared cross-product assets, unlike the
//      per-product `/medias/`/`/fes/cms/` paths the real photos live under.
module.exports = {
    name: "lenovo",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting. NOTE:
        // deliberately NOT a bare "h1" wait/selector anywhere in this
        // config — the page has a SECOND, empty, visually-hidden <h1>
        // earlier in DOM order (`style="height:0;width:0;overflow:hidden"`,
        // confirmed present as an SEO placeholder) that a plain `h1`
        // selector's `.first()` match would silently grab instead of the
        // real `h1.product_summary`.
        await page
            .waitForSelector(["h1.product_summary", ".gallery-container img"].join(", "), {
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

        // See the big module comment above — the price block renders
        // client-side well after `domcontentloaded`. Non-fatal if it never
        // shows (falls through to JSON-LD, which already has price
        // anyway — this wait exists for the DOM additionalFields below,
        // like discountPercent, that have no JSON-LD equivalent at all).
        await page.waitForSelector(".single_pdp_price_container .price-title", { timeout: 8000 }).catch(() => {});

        // See the "GALLERY GOTCHA" module comment above.
        await page.evaluate(() => {
            const upsized = new Set();
            document.querySelectorAll(".gallery-container img[src]").forEach(img => {
                try {
                    const url = new URL(img.src, location.href);
                    if (url.pathname.includes("/ShareResource/")) return; // partner badge, not a product photo
                    if (url.searchParams.has("width")) url.searchParams.set("width", "1000");
                    if (url.searchParams.has("height")) url.searchParams.set("height", "1000");
                    const resized = url.toString();
                    img.src = resized;
                    upsized.add(resized);
                } catch {
                    // Malformed URL (rare inline data: URI, etc.) — leave as-is.
                }
            });
            if (upsized.size === 0) return;

            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                try {
                    const data = JSON.parse(script.textContent);
                    const nodes = Array.isArray(data) ? data : Array.isArray(data["@graph"]) ? data["@graph"] : [data];
                    const product = nodes.find(
                        n => n && (n["@type"] === "Product" || (Array.isArray(n["@type"]) && n["@type"].includes("Product")))
                    );
                    if (product) {
                        product.image = [...upsized];
                        script.textContent = JSON.stringify(data);
                        break;
                    }
                } catch {
                    // Not JSON, or not this block (this page also emits a
                    // separate BreadcrumbList block, confirmed live) — try
                    // the next <script>.
                }
            }
        });

        // The spec list and reviews widget can lazy-render on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, but only as the fallback path — JSON-LD supplies
        // `name` first. This is the CONFIGURED variant's full name (e.g.
        // "ThinkPad L14 - Intel Core Ultra 5, 16GB RAM, 512 SSD, Win 11
        // Pro"), a more specific string than JSON-LD's generic "ThinkPad
        // L14 Gen 6 (14, Intel)".
        title: ["h1.product_summary"],

        // Confirmed, but only as the fallback path — JSON-LD supplies
        // `price` first. Scoped to `.single_pdp_price_container` (the real
        // buy-box) rather than the bare `.final-price` class, which is
        // ALSO used by a separate sticky mini price-bar elsewhere on the
        // page with no MRP/discount info next to it.
        price: [
            ".single_pdp_price_container .price-title",
            ".single_pdp_price_container .final-price",
            ".final-price",
            ".price",
        ],

        // Confirmed: the lead marketing paragraph — first of several
        // `.description` nodes on the page (one per feature-highlight
        // section further down); only the first is used since
        // extractText() always takes the first match anyway.
        description: [".description"],

        // Confirmed, but only as the fallback path — JSON-LD's single
        // image is used first if the DOM patch above ever fails to find
        // any gallery images. See the "GALLERY GOTCHA" module comment for
        // why plain `img.src` alone (no rewrite) would otherwise return
        // mostly 58x58 thumbnails.
        images: [".gallery-container img"],

        // NOT present on this product page — confirmed no build-to-order
        // configurator (CPU/RAM/storage picker) or color swatches anywhere
        // in the DOM; this is a single fixed SKU (21S6S00K00). Both
        // omitted rather than guessed; they'll correctly come back as
        // empty arrays with a "missing" trace on a product that genuinely
        // has none. A Lenovo product page that DOES offer build-to-order
        // options will need real selectors added here — not yet seen on
        // any page checked so far.
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹1,44,146"). Raw text, not
        // parsed to a number (matches how `mrp` is kept raw in the other
        // configs in this repo).
        mrp: [".single_pdp_price_container del.price"],

        // Confirmed: "5%  off" badge (note the double space baked into the
        // site's own template) next to the price.
        discountPercent: [".single_pdp_price_container .price-save-mt"],

        // Confirmed: the maroon merchandising banner near the title (e.g.
        // "5% Cashback | 12M 0% EMI"). Not present on every product.
        cashbackOffer: [".pc-merchandising_flag p", ".merchandising_flag_normal p"],

        // Confirmed: Bazaarvoice inline rating widget ("4.5" / "(14)").
        rating: [".bv_averageRating_component_container .bv_text"],
        reviewCount: [".bv_numReviews_component_container .bv_text"],

        // Confirmed: "My Lenovo Rewards" points value ("5,762") earnable on
        // this purchase.
        lenovoRewardsPoints: [".loyalty-price-color .popup-activation"],

        // Confirmed: the "System Specs" table's commonly-present fields —
        // each row is an `.item_name` (label) / `.item_content` (value)
        // pair, both siblings inside `.normal_specs` with no product-
        // specific hooks, so each is found via Playwright's `:has()` +
        // `:text-is()` on the literal label text. A future product missing
        // a given row (e.g. no discrete GPU) just comes back null for that
        // field, not fatal.
        processor: ['.specs_item:has(.item_name:text-is("Processor")) .item_content'],
        operatingSystem: ['.specs_item:has(.item_name:text-is("Operating System")) .item_content'],
        graphicsCard: ['.specs_item:has(.item_name:text-is("Graphic Card")) .item_content'],
        memory: ['.specs_item:has(.item_name:text-is("Memory")) .item_content'],
        storage: ['.specs_item:has(.item_name:text-is("Storage")) .item_content'],
        display: ['.specs_item:has(.item_name:text-is("Display")) .item_content'],

        // Confirmed: every spec label/value as two parallel raw lists
        // (same row order in both) — a category-agnostic catch-all
        // covering whatever fields a given product's spec sheet actually
        // has, beyond the commonly-present ones named individually above
        // (15 rows confirmed on this product: Processor, Operating System,
        // Graphic Card, Memory, Storage, Display, AC Adapter/Power Supply,
        // and others not individually named here).
        specLabels: { selectors: [".specs_item .item_name"], multiple: true },
        specValues: { selectors: [".specs_item .item_content"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
