// Config for nykaafashion.com, built against a real product page (Bergner
// Tripro Triply Stainless Steel 2 Piece Tasra Set, /p/20008871) supplied by
// the user on 2026-09-14. Not yet verified against a live Playwright run —
// see the module comments in hamaramall.js/boat.js in this repo for what
// that process looks like; re-verify this one the same way before trusting
// it in production.
//
// This is a React SPA using Emotion CSS-in-JS (hashed `css-xxxxxxx` class
// names throughout, same instability concern as shopsy.js in this repo).
// UNLIKE shopsy.js though, this site also sprinkles plain `data-at="..."`
// attributes across most of the fields that actually matter for scraping
// (price, MRP, stock, brand link, product-name span, coupon code, ...) —
// these read like intentional QA/analytics test hooks (the "at" pattern is
// a common e2e-testing convention) and are used as the PRIMARY selector
// wherever one exists, since they're far less likely to churn on a redeploy
// than the `css-xxxxxxx` classes sitting right next to them.
//
// UNKNOWN whether this page emits schema.org Product JSON-LD — only body
// markup was supplied (no <head>). scraper.js always tries JSON-LD first
// regardless; check `trace.*.source` on a live run. If absent, `brand` will
// come back null (scraper.js's `brand` field has no DOM fallback at all) —
// the DOM brand name IS captured as additionalInfo.brandName below as a
// backup, same convention as tatacliq.js in this repo.
//
// The 4 "Product Information" panels (Product details / Know your product /
// Vendor details / Return and exchange policy) are togglable
// `.collapsible` accordions, collapsed by default (`height:0;
// visibility:hidden` inline style) — confirmed this does NOT block
// extraction: scraper.js's extractText()/extractList() only check
// `element.count() > 0` and read `textContent`, neither of which cares
// about CSS visibility, so the collapsed content is fully readable without
// ever clicking to expand it.
module.exports = {
    name: "nykaafashion",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(['h1[data-at="product-name"]', '[data-at="sp-pdp"]'].join(", "), {
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

        // Coupons/offers and the ratings summary can lazy-render on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed: the product-name <span> inside the <h1> — deliberately
        // NOT the whole <h1> textContent, which also concatenates the
        // brand-name link right before it with no separating space/
        // whitespace (e.g. "BergnerTripro Triply..."). Brand is captured
        // separately below as additionalInfo.brandName. Falls back to the
        // full <h1> (brand-prefixed) only if that span selector ever comes
        // up empty.
        title: ["h1 span.css-10r400n", 'h1[data-at="product-name"]', "h1"],

        // Confirmed: "₹1,680" current selling price, hooked via the stable
        // `data-at="sp-pdp"` attribute rather than its own hashed class.
        price: ['[data-at="sp-pdp"]', ".price"],

        // Confirmed: the "Know your product" panel's description text —
        // scoped via Playwright's `:has()` + `:text-is()` to that specific
        // `.collapsible` block, since its value node's class (`.css-n8xkpa`)
        // is ALSO reused for unrelated fields (Care instructions, Return
        // policy text) in other panels on the same page — an unscoped
        // `.css-n8xkpa` selector would nondeterministically match whichever
        // of those happens to come first in the DOM instead.
        description: ['.collapsible:has(h3:text-is("Know your product")) .css-n8xkpa'],

        // Confirmed: the large main-gallery photos (up to 1536px via
        // srcset) — extractImages() picks the largest srcset candidate
        // automatically. Falls back to the left-rail thumbnail strip
        // (hooked via the stable `data-at="pdp-product-image"` attribute,
        // but capped at a lower 256px in its own srcset) if the main
        // gallery selector ever comes up empty.
        images: [".css-kwk7lt", '[data-at="pdp-product-image"]'],

        // NOT present in the supplied markup — this product (a cookware
        // set) has no color/size variant picker, only a single SKU. Both
        // omitted rather than guessed; they'll correctly come back as empty
        // arrays with a "missing" trace on a product that genuinely has
        // none.
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹1,695"), hooked via the stable
        // `data-at="mrp-pdp"` attribute. Raw text, not parsed to a number
        // (matches how `mrp` is kept raw in the other configs in this
        // repo).
        mrp: ['[data-at="mrp-pdp"]'],

        // Confirmed: "1% Off" badge next to the price, hooked via the
        // stable `data-at="price-offer"` attribute.
        discountPercent: ['[data-at="price-offer"]'],

        // Confirmed: "Only 2 left" low-stock badge — only present in the
        // DOM when stock is actually low; empty/missing otherwise (that's
        // expected, not a broken selector).
        stockWarning: ['[data-at="stock-warning"]'],

        // Confirmed: brand name from the title-block link (e.g. "Bergner")
        // — see module comment above for why this isn't the top-level
        // `product.brand`.
        brandName: ['h1 a[href*="/designers/"]'],

        // Confirmed: the first/primary coupon code shown ("NFFLAT10"),
        // hooked via its own semantic (non-hashed) class name.
        couponCode: [".couponCode"],

        // Confirmed: numeric rating summary split into two clean counts —
        // scoped via `:has()` + `:text-is()` off each stat's own
        // "Ratings"/"Reviews" caption rather than positional (nth-child)
        // guessing, since both stats share identical wrapper markup.
        ratingValue: ['[data-at="product-rating"] > span'],
        ratingsCount: ['div:has(> div.subtext:text-is("Ratings")) span'],
        reviewsCount: ['div:has(> div.subtext:text-is("Reviews")) span'],

        // Confirmed: "Free Delivery by Tue, 22 Sep" estimate, hooked via
        // the stable `alt="Free delivery"` on the icon next to it rather
        // than any of the surrounding hashed classes.
        freeDeliveryEstimate: ['div:has(> img[alt="Free delivery"]) h3'],

        // Confirmed: the "Product details" panel's attribute key/value
        // rows — each pair is two adjacent <p> siblings with a shared
        // wrapper, so each is found via `:text-is()` on the literal label
        // text paired with `+ p.attribute-value`. A future product missing
        // a given row (e.g. no "Warranty" line) just comes back null for
        // that field, not fatal.
        material: ['p.attribute-key:text-is("Material") + p.attribute-value'],
        pattern: ['p.attribute-key:text-is("Pattern") + p.attribute-value'],
        packSize: ['p.attribute-key:text-is("Pack Size") + p.attribute-value'],
        dimensions: ['p.attribute-key:text-is("Dimensions") + p.attribute-value'],
        warranty: ['p.attribute-key:text-is("Warranty") + p.attribute-value'],
        vibe: ['p.attribute-key:text-is("Vibe") + p.attribute-value'],

        // Confirmed: same "Product details" panel, but a different
        // label/value shape (both plain <div>s, not <p>.attribute-*) — same
        // `:text-is()` + adjacent-sibling technique, different tag/class.
        careInstructions: ['div.css-8edh6i:text-is("Care instructions") + div.css-n8xkpa'],
        packContains: ['div.css-8edh6i:text-is("Pack contains") + div.css-n8xkpa'],

        // Confirmed: the "Vendor details" panel's rows — label/value pair
        // of plain <div>s again, same technique, scoped to the
        // `.prod-info-header` label class used only in this panel.
        soldBy: ['div.prod-info-header:text-is("Sold By") + div'],
        countryOfOrigin: ['div.prod-info-header:text-is("Country of Origin") + div'],
        manufacturerName: ['div.prod-info-header:text-is("Name of Manufacturer/ Packer/ Importer") + div'],
        manufacturerAddress: ['div.prod-info-header:text-is("Address of Manufacturer/ Packer/ Importer") + div'],

        // Confirmed: the "Return and exchange policy" panel's body text —
        // same `:has()` scoping caveat as `description` above (its
        // `.css-n8xkpa` value class is reused across multiple panels).
        returnPolicyText: ['.collapsible:has(h3:text-is("Return and exchange policy")) .css-n8xkpa'],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
