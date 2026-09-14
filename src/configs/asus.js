// Config for in.store.asus.com, built against a real product page (ASUS TUF
// Gaming A16 FA608PP-QT014WS, /gaming-laptop-asus-tuf-gaming-a16-fa608pp-
// qt014ws.html) supplied by the user on 2026-09-14. Not yet verified against
// a live Playwright run — see the module comments in hamaramall.js/boat.js
// in this repo for what that process looks like; re-verify this one the
// same way (`node src/index.js --headed --website=asus --limit=1 --force`,
// check product.json's `trace`) before trusting it in production.
//
// This is Adobe Commerce / Magento 2 (`form_key` hidden input,
// `product_addtocart_form`, `data-price-amount`/`data-price-type` price
// widgets) with a heavily customized theme (custom "rich-content" marketing
// blocks, PayU offers widget, Bazaarvoice inline ratings). Price/MRP/SKU
// nodes carry the numeric product id in their `id` attribute
// (`product-price-10858`, `new-old-price-10858`, ...) — THAT id changes per
// product, so every selector below deliberately targets the stable
// `data-price-type="..."` attribute or class instead, never the id.
//
// UNKNOWN whether this page emits schema.org Product JSON-LD — only body
// markup was supplied (no <head>). scraper.js always tries JSON-LD first
// regardless; check `trace.*.source` on a live run. If absent, `brand` will
// come back null (scraper.js's `brand` field has no DOM fallback at all —
// see its "--- brand ---" block) even though "ASUS" is obviously the brand;
// there's no reliable brand-only DOM node in the supplied markup to hook
// instead (it only ever appears embedded inside the title/spec text).
//
// KNOWN GOTCHA (confirmed from the supplied markup, not yet from a live
// Playwright run): the image gallery is a slick carousel that only
// eager-loads the first couple of slides — the rest sit with
// `src="...loader-1.gif"` (a spinner placeholder) and the REAL url in a
// `data-lazy` attribute instead. scraper.js's extractImages() only ever
// reads `src`/`currentSrc`/`srcset`/`dataset.src` (note: `data-src`, NOT
// this theme's `data-lazy`) — so without the `beforeExtract` fix below,
// every not-yet-loaded slide would incorrectly resolve to the same
// loader-1.gif URL for every product. `beforeExtract` copies `data-lazy` ->
// `src` directly on every gallery image before extraction runs, sidestepping
// slick's lazy-load entirely rather than trying to scroll/click through it.
module.exports = {
    name: "asus",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1[data-dynamic='spec_based_title']", ".gallery__main img"].join(", "), {
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

        // See the big module comment above for *why* this exists — fixes
        // the slick gallery's not-yet-loaded slides (src still pointing at
        // the loader-1.gif spinner) by copying each one's real URL out of
        // `data-lazy` directly, without needing to interact with the
        // carousel at all.
        await page.evaluate(() => {
            document.querySelectorAll(".gallery__main img[data-lazy]").forEach(img => {
                if (img.dataset.lazy) img.src = img.dataset.lazy;
            });
        });

        // The Bazaarvoice inline-rating widget and the rich-content
        // marketing sections below the fold can render a beat after
        // first paint.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed: the single spec-driven <h1> title.
        title: ["h1[data-dynamic='spec_based_title']", ".product.attribute.spec_based_title h1", "h1"],

        // Confirmed: the current selling price, hooked via Magento's stable
        // `data-price-type="finalPrice"` attribute rather than the
        // product-id-suffixed `id`. `.special-price` scopes it away from
        // the struck-through `.old-price` block below.
        price: [
            '.special-price [data-price-type="finalPrice"] .price',
            '[data-price-type="finalPrice"] .price',
            ".price-final_price .price",
            ".price",
        ],

        // Confirmed: the "Product Description" paragraph — the first <p>
        // inside the short_description block (the marketing copy) rather
        // than the whole block, which also contains spec comparison
        // <table>s whose cell text would otherwise get jammed onto the end
        // with no separators. Falls back to the full block if that <p>
        // selector ever comes up empty.
        description: [
            '[data-dynamic="short_description"] p',
            '.product.attribute.overview [data-dynamic="short_description"]',
        ],

        // Confirmed: gallery <img> tags — both the eager-loaded first slide
        // (.gallery__main-general) and the lazy ones (.gallery__main-lazy,
        // fixed up by beforeExtract above). Deliberately scoped to
        // `.gallery__main` only, NOT `.gallery__nav` — the nav strip holds
        // the same photos at a much smaller fixed size (80x80 vs 477x477)
        // and would otherwise add low-res duplicate URLs.
        images: [".gallery__main img"],

        // NOT present in the supplied markup — this is a Magento SIMPLE
        // product (`<input class="product_type" value="simple">`, no
        // configurable-swatch markup anywhere), with color/spec listed as
        // plain text instead (see additionalFields.color below). Both
        // omitted rather than guessed; they'll correctly come back as empty
        // arrays with a "missing" trace.
    },

    additionalFields: {
        // Confirmed: struck-through original price ("₹305,990.00"), hooked
        // via the theme's own semantic class name rather than the
        // product-id-suffixed `id`. Raw text, not parsed to a number
        // (matches how `mrp` is kept raw in the other configs in this
        // repo).
        mrp: [".new-old-price .price"],

        // Confirmed: the absolute rupee amount saved ("₹66,000.00") and the
        // "(22%)" badge next to it — two separate nodes. NOTE: despite its
        // confusingly-named `data-price-type="oldPrice"` attribute, the
        // `#old-price-<id>` node's actual displayed text is the SAVINGS
        // amount, not the old/MRP price (that's `.new-old-price` above,
        // Magento's own naming is just misleading here) — confirmed against
        // the supplied markup's literal rendered text.
        savingsAmount: ['.price-container span[data-price-type="oldPrice"] .price'],
        discountPercent: [".save-percent"],

        // Confirmed: "1 Year Warranty" callout in the delivery-info strip.
        warranty: ['[data-dynamic="warranty"]', "#warranty_describe"],

        // Confirmed: "Model Number - FA608PP-QT014WS" / "Part Number -
        // 90NR0MD1-M000M0" — raw text including the label prefix (kept
        // as-is, same convention as tatacliq.js's sellerName field; strip
        // the leading label downstream if needed).
        modelNumber: [".simple-sku"],
        partNumber: [".simple-part"],

        // Confirmed: full tech-spec list — each row is a <li> containing a
        // label <span> and a value <span> as siblings with no ID/product-
        // specific hooks, so each is found via `:has()` + Playwright's
        // `:text()` SUBSTRING-match pseudo-class on the (fullwidth-colon-
        // suffixed, e.g. "Processor： ") label text, then reading that
        // row's `.tech-value`. Robust to the product-id/price churn that
        // rules out ID-based selectors elsewhere on this page; will need
        // updating only if ASUS ever renames these spec labels.
        processor: ['li:has(.tech-label:text("Processor")) .tech-value'],
        graphics: ['li:has(.tech-label:text("Graphics")) .tech-value'],
        display: ['li:has(.tech-label:text("Display")) .tech-value'],
        memory: ['li:has(.tech-label:text("Memory")) .tech-value'],
        storage: ['li:has(.tech-label:text("Storage")) .tech-value'],
        msOffice: ['li:has(.tech-label:text("MS Office")) .tech-value'],
        color: ['li:has(.tech-label:text("Color")) .tech-value'],
        operatingSystem: ['li:has(.tech-label:text("Operating System")) .tech-value'],

        // Confirmed: Bazaarvoice inline rating widget ("4.4" / "(312)").
        // NOT yet confirmed to survive a live run — Bazaarvoice widgets are
        // often injected async by third-party JS; the supplied markup
        // already shows `data-bv-ready="true"`, suggesting it's
        // server-rendered/cached here, but verify `trace.*.success` on a
        // live run before relying on it.
        rating: ['[itemprop="ratingValue"]', ".bv_averageRating_component_container .bv_text"],
        reviewCount: [".bv_numReviews_component_container .bv_text"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
