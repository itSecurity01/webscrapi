// Config for moglix.com, built AND live-verified (via direct Playwright
// navigation + DOM inspection, not just a pasted markup snippet — no markup
// was supplied for this one) against a real product page (TP-Link Omada
// 16-Port Gigabit Easy Managed Switch ES216G, /mp/msnrkregw7q39n) on
// 2026-09-14.
//
// This is an Angular Universal (SSR) storefront (`_ngcontent-ssr-pwa-*`
// attributes throughout) with plain, human-readable class names — no
// atomic/hashed classes, closer in stability to tatacliq.js/moglix's own
// clean spec-table markup than to shopsy.js in this repo. It emits real,
// rich schema.org Product JSON-LD (name/description/sku/mpn/brand/offers)
// — confirmed live, so name/brand/price/currency/sku/description should
// normally come from `trace.*.source === "json-ld"`.
//
// TWO CONFIRMED GOTCHAS, both fixed in `beforeExtract` below (same "patch
// it before extraction" philosophy as muscleblaze.js/oppo.js in this repo):
//
// 1. JSON-LD's `image` array only ever lists ONE photo, even on a product
//    with a genuine 5-image gallery (confirmed: `.product-images img`
//    returns 5 DIFFERENT asset URLs, not resized variants of the same
//    one). Since scraper.js takes JSON-LD's `image` outright the moment
//    that array is non-empty, the DOM `images` selector below would
//    otherwise never even run — `beforeExtract` patches the real gallery
//    directly into the JSON-LD node's `image` field.
//
// 2. The "Product Specifications" table only renders 4 rows by default —
//    confirmed this is NOT just a CSS collapse (unlike hamaramall.js/
//    oppo.js's hidden-but-present accordions in this repo): the other ~14
//    rows do not exist in the DOM at all until the "Show All
//    Specifications" toggle is actually clicked, after which a SECOND
//    `table.product-spec` (the full list) gets appended after the first
//    (which stays in the DOM unchanged, so the page now has 2 such tables,
//    the first 4 rows OF THE SECOND TABLE duplicating the first table's
//    content). `beforeExtract` clicks that toggle — confirmed reliably
//    reproducible across repeated live runs with this exact sequence:
//    dismiss the sticky header/search overlay first (Escape + a throwaway
//    corner click — a `header-nav` overlay was confirmed to intercept the
//    toggle's click otherwise, timing out every retry), THEN force-click
//    the toggle. Non-fatal if the toggle is ever absent (a product with
//    few enough specs may not show one at all — in that case the lone
//    table IS already the complete list, which the `additionalFields`
//    selectors below account for, see their comments).
//
// PLAYWRIGHT GOTCHA confirmed while building the named spec fields below
// (worth knowing for any future config in this repo using the same
// `:text-is()` label-matching technique as hamaramall.js/acer.js): it only
// works when the label text sits DIRECTLY inside the element you're
// matching, with no wrapping child element — e.g. hamaramall's
// `<p>Country</p>`. Here each label is `<td class="left"><div>Brand</div>
// </td>` — one level deeper — and `td.left:text-is("Brand")` returns ZERO
// matches even though `td.left`'s trimmed textContent genuinely equals
// "Brand" (confirmed by testing `td.left div:text-is("Brand")` directly,
// which DOES match — `:text-is()` behaves like "smallest/innermost element
// whose OWN text equals this", not a plain textContent-equality check
// against every ancestor). Fix: match the inner `div` inside a `:has()` on
// the `td` instead — `td.left:has(div:text-is("Brand")) + td.right` — so
// the adjacent-sibling `+` combinator still operates at the correct `td`
// level to reach the value cell.
module.exports = {
    name: "moglix",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1.prod-name", ".pdp-price-qty-block"].join(", "), {
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

        // Angular hydration settle. CONFIRMED NECESSARY, not cargo-culted:
        // `waitForSelector(..., state: "attached")` above resolves as soon
        // as the SSR'd HTML lands, well before Angular finishes hydrating
        // and wiring up click handlers — a "Show All Specifications" click
        // fired immediately after that (no extra wait) reliably did
        // NOTHING on repeated live runs (0/3), while the identical click
        // preceded by this wait succeeded reliably (3/3). Don't remove
        // this even though nothing above visibly "needs" it.
        await page.waitForTimeout(1200);

        // See gotcha #2 in the module comment above — dismiss the
        // intercepting overlay first (Escape + a throwaway corner click),
        // THEN click the toggle IN A RETRY LOOP rather than once: even with
        // the hydration wait above, a single click attempt was still
        // occasionally too early (Angular's own internal readiness varies
        // run to run) — this loop re-clicks and re-checks up to 3 times,
        // confirmed reliable (3/3 expansions, 17/17 spec rows) across
        // repeated live runs, vs. a single fire-and-forget click which
        // was not.
        await page.keyboard.press("Escape").catch(() => {});
        await page.mouse.click(5, 5).catch(() => {});
        await page.waitForTimeout(300);
        for (let attempt = 0; attempt < 3; attempt++) {
            await page.locator(".show-all-strip.spec span").click({ timeout: 3000, force: true }).catch(() => {});
            await page.waitForTimeout(600);
            const expanded = await page
                .locator("table.product-spec:not(:has(+ .show-all-strip))")
                .count()
                .catch(() => 0);
            if (expanded > 0) break;
        }

        // See gotcha #1 in the module comment above.
        await page.evaluate(() => {
            try {
                const galleryUrls = [...document.querySelectorAll(".product-images img")]
                    .map(img => img.currentSrc || img.src)
                    .filter(Boolean);
                if (galleryUrls.length === 0) return;

                for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                    try {
                        const data = JSON.parse(script.textContent);
                        const nodes = Array.isArray(data) ? data : Array.isArray(data["@graph"]) ? data["@graph"] : [data];
                        const product = nodes.find(
                            n => n && (n["@type"] === "Product" || (Array.isArray(n["@type"]) && n["@type"].includes("Product")))
                        );
                        if (product) {
                            product.image = [...new Set(galleryUrls)];
                            script.textContent = JSON.stringify(data);
                            break;
                        }
                    } catch {
                        // Not JSON, or not this block (this page also emits
                        // separate ImageObject/BreadcrumbList JSON-LD
                        // blocks, confirmed live) — try the next <script>.
                    }
                }
            } catch {
                // Swallow — falls through to JSON-LD's original single image.
            }
        });
    },

    selectors: {
        // Confirmed, but only as the fallback path — JSON-LD supplies
        // `name` first (see module comment).
        title: ["h1.prod-name", "h1"],

        // Confirmed, but only as the fallback path — JSON-LD supplies
        // `price` first. The tax-INCLUSIVE price ("₹4,377 (Incl. of all
        // taxes)") is what matches JSON-LD's `offers.price` exactly;
        // `.actual-price.main-price` is a DIFFERENT, tax-EXCLUSIVE number
        // ("₹3,709 + ₹668 GST") a few lines below it — `:not()` excludes
        // that one specifically so the DOM fallback can't silently grab
        // the wrong figure.
        price: [".actual-price:not(.main-price) small", ".actual-price:not(.main-price)", ".price"],

        // Confirmed: the first paragraph of the "Product Details" section —
        // `:not(.static-desc)` excludes the generic SEO boilerplate
        // paragraph right after it ("Browse through the extensive list
        // of..."), which shares the same parent but is clearly not part of
        // the actual product description. Only used as a fallback in
        // practice; JSON-LD already carries this exact text.
        description: [".prod-detail p:not(.static-desc)", ".prod-detail p"],

        // Not used in practice — see gotcha #1 in the module comment
        // above: the real gallery is patched directly into JSON-LD's
        // `image` array before extraction runs. Kept as a fallback for if
        // that patch ever fails. NOTE: `.prod-img img` (singular, no "s")
        // is a DIFFERENT, deceptively-similar class used by an unrelated
        // "Compare similar products" carousel further down the page —
        // confirmed it returns photos of OTHER products entirely, and is
        // deliberately NOT used here.
        images: [".product-images img", ".pinch-zoom img"],

        // NOT present on this product (an IT/networking single-SKU item,
        // no variant picker of any kind) — Moglix sells across wildly
        // different categories, some of which may have real size/color
        // options; both omitted rather than guessed, they'll correctly
        // come back as empty arrays with a "missing" trace where genuinely
        // absent.
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹6,000") and its "27% OFF" badge
        // — two separate nodes in the same `<p class="mrp">` block. Raw
        // text, not parsed to a number (matches how `mrp` is kept raw in
        // the other configs in this repo).
        mrp: [".mrp small"],
        discountPercent: [".mrp span"],

        // Confirmed to exist ("₹3,709 + ₹668 GST", GST breakdown `<small>`
        // nested inside the same `<strong>` as the base price with no
        // separating element — expect one jammed-together raw string, not
        // two clean numbers) but CONFIRMED FLAKY: this specific node
        // renders asynchronously on a timeline decoupled from every other
        // readiness signal on the page — it showed up on only 1 of 4
        // repeated live runs even after an 8-SECOND dedicated wait (every
        // other field, including the full spec table, was reliable well
        // under 2s). No fix applied — a longer wait didn't help and
        // guessing at why felt worse than being honest that it's
        // unreliable. Expect null more often than not; treat any non-null
        // value as a bonus, not a broken selector if it's usually empty.
        priceExcludingTaxRaw: [".actual-price.main-price strong"],

        // Confirmed: brand name from the spec table's first row — see
        // module comment on why the top-level `product.brand` (from
        // JSON-LD) is preferred; this is a DOM backup, same convention as
        // tatacliq.js's brandName field in this repo.
        brandNameDom: ['table.product-spec:not(:has(+ .show-all-strip)) td.left:has(div:text-is("Brand")) + td.right'],

        // Confirmed: the rest of the full spec table's commonly-present
        // fields, scoped via `:not(:has(+ .show-all-strip))` to the SECOND
        // (post-click, complete) `table.product-spec` — see gotcha #2 in
        // the module comment above for why that scoping matters: without
        // it, an unscoped selector would nondeterministically match
        // whichever of the two (nearly-identical) tables happens first.
        // NOTE: this scoping trick doubles as a safe no-op — if the "Show
        // All Specifications" toggle was absent to begin with (a product
        // with few enough specs to need no expansion), the one remaining
        // table already has no `.show-all-strip` sibling either, so the
        // selector still correctly matches it.
        //
        // These 6 field names (Item Code/Series/Case Material/Warranty/
        // Country of origin/Package Contents) are Moglix's own standard
        // spec-sheet vocabulary reused across many categories on this
        // site, but Moglix sells everything from network switches to
        // safety gear — expect some of these to legitimately come back
        // null on a product from a very different category (that's not a
        // broken selector, just a field this category's spec sheet
        // doesn't have). See `specLabels`/`specValues` below for a
        // category-agnostic catch-all covering whatever fields a given
        // product's spec sheet actually has.
        itemCode: ['table.product-spec:not(:has(+ .show-all-strip)) td.left:has(div:text-is("Item Code")) + td.right'],
        series: ['table.product-spec:not(:has(+ .show-all-strip)) td.left:has(div:text-is("Series")) + td.right'],
        caseMaterial: ['table.product-spec:not(:has(+ .show-all-strip)) td.left:has(div:text-is("Case Material")) + td.right'],
        warranty: ['table.product-spec:not(:has(+ .show-all-strip)) td.left:has(div:text-is("Warranty")) + td.right'],
        countryOfOrigin: ['table.product-spec:not(:has(+ .show-all-strip)) td.left:has(div:text-is("Country of origin")) + td.right'],
        packageContents: ['table.product-spec:not(:has(+ .show-all-strip)) td.left:has(div:text-is("Package Contents")) + td.right'],

        // Confirmed: every spec label/value as two parallel raw lists (same
        // row order in both), category-agnostic — covers whatever fields a
        // given product's spec sheet actually has, beyond the
        // commonly-present ones named individually above. NOTE: on a
        // product whose default 4-row preview already shows ALL of its
        // specs (no "Show All Specifications" toggle at all), this may
        // include one trailing "SHOW MORE" junk entry in `specValues`
        // (confirmed present in the live table's own markup, not an
        // extraction bug) — filter that out downstream if it matters.
        specLabels: {
            selectors: ['table.product-spec:not(:has(+ .show-all-strip)) td.left'],
            multiple: true,
        },
        specValues: {
            selectors: ['table.product-spec:not(:has(+ .show-all-strip)) td.right'],
            multiple: true,
        },

        // NOT confirmed — no rating/review widget scoped to THIS product
        // was found anywhere on the page (the only `.avgrating` nodes
        // present all live inside the unrelated "Compare similar products"
        // table further down, confirmed via ancestor inspection — using
        // them here would silently attribute a DIFFERENT product's rating
        // to this one, so they're deliberately NOT used). This product
        // appears to have zero reviews. Left out entirely rather than
        // guessed; add a real selector here once a live product WITH
        // reviews is available to verify against.
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
