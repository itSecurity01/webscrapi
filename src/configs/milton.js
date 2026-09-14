// Config for milton.in, built AND live-verified (direct Playwright
// navigation + DOM inspection, no markup was pasted) against a real product
// page (New Smarty Thermosteel - The Story We Share, /products/
// new-smarty-thermosteel-the-story-we-share-milton-concepts) on 2026-09-14.
//
// milton.in is Shopify. IMPORTANT — same exact gotcha as wishluck.js in
// this repo, confirmed independently here: the theme's native Product
// JSON-LD is typed "ProductGroup", not "Product" (schema.org's node for
// "this page represents a FAMILY of variant Products", with the real
// Product entries meant to be nested inside `hasVariant` — milton.in's
// ProductGroup node doesn't even include that). scraper.js's
// extractJsonLd()/findProductNodes() only ever matches a node whose own
// @type is (or includes) "Product" — a bare "ProductGroup" is silently
// skipped, so `jsonLd` comes back null and EVERY field falls through to DOM
// selectors, with the same two real gaps wishluck.js documents: no DOM
// fallback exists anywhere in scraper.js for `brand` (permanently null
// without a fix), and no DOM fallback exists for `sizes`/`colors` variant
// data beyond whatever a config's own selectors dig up.
//
// Fix (verbatim reuse of wishluck.js's approach, generalized via the
// canonical link so it isn't hardcoded to this one product): fetch this
// exact product's `/products/<handle>.json` — the same endpoint Shopify's
// own theme JS calls for variant-picker updates, same-origin, no auth,
// confirmed working live for this product — and assemble a compliant
// schema.org "Product" node from it, then append that as a *new*
// `<script type="application/ld+json">` tag. scraper.js's normal
// JSON-LD-first extraction then picks it up exactly like any native block.
// If that fetch ever fails, it fails silently and extraction falls through
// to the DOM selectors below — worse (null brand) but not fatal.
//
// SECOND CONFIRMED GOTCHA (specific to this theme, not present in
// wishluck.js): the price block's markup has TWO `.f-price-item--regular`
// nodes when a product is on sale — a hidden/duplicate one inside
// `.f-price__regular` (holding the SALE price again, not the MRP — a Dawn-
// theme quirk, presumably CSS-hidden by the `.f-price--on-sale` modifier
// class but still present in the DOM) and the REAL struck-through MRP
// nested inside `.f-price__sale` instead. A naive `.f-price-item--regular`
// selector's `.first()` match grabs the WRONG (duplicate, non-MRP) one —
// confirmed by direct inspection; `mrp` below is deliberately scoped to
// `.f-price__sale .f-price-item--regular` to reach the real one.
//
// Also confirmed live: the price/title/badges block sits inside a
// `#ProductInfo-<per-page-numeric-id>` container whose id suffix changes
// per product — every DOM selector below that needs to stay scoped to the
// real buy-box (as opposed to a "you may also like" card elsewhere on the
// page reusing the exact same `.f-price`/`.product__title` classes) uses
// the attribute-prefix selector `[id^="ProductInfo-"]` rather than a
// hardcoded id.
module.exports = {
    name: "milton",

    beforeExtract: async (page) => {
        // Mostly server-rendered, but give the theme's hydration JS a
        // moment before extracting.
        await page
            .waitForSelector(["h1.product__title", ".product__media-list"].join(", "), {
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

        // See the big module comment above for *why* this exists — same
        // technique as wishluck.js in this repo, generalized via the
        // canonical link rather than hardcoded to one product/handle.
        await page.evaluate(async () => {
            try {
                const canonical = document.querySelector('link[rel="canonical"]');
                const match = canonical && canonical.href.match(/\/products\/([^/?#]+)/);
                if (!match) return;

                const res = await fetch(`/products/${match[1]}.json`, { credentials: "same-origin" });
                if (!res.ok) return;
                const { product } = await res.json();
                if (!product) return;

                const scratch = document.createElement("div");
                scratch.innerHTML = product.body_html || "";
                const description = (scratch.textContent || "").trim();

                const optionNames = (product.options || []).map(o => (o.name || "").toLowerCase());
                const sizeIdx = optionNames.findIndex(n => n.includes("size"));
                const colorIdx = optionNames.findIndex(n => n.includes("colour") || n.includes("color"));

                const variants = product.variants || [];
                const hasVariant = variants.map(v => {
                    const optionValues = [v.option1, v.option2, v.option3];
                    const node = {
                        "@type": "Product",
                        name: v.title,
                        sku: v.sku || undefined,
                        offers: {
                            "@type": "Offer",
                            price: v.price,
                            priceCurrency: v.price_currency || "INR",
                        },
                    };
                    if (sizeIdx !== -1) node.size = optionValues[sizeIdx];
                    if (colorIdx !== -1) node.color = optionValues[colorIdx];
                    return node;
                });

                const jsonLd = {
                    "@context": "https://schema.org/",
                    "@type": "Product",
                    name: product.title,
                    brand: { "@type": "Brand", name: product.vendor },
                    description,
                    sku: variants[0] ? variants[0].sku : undefined,
                    image: (product.images || []).map(img => img.src),
                    offers: variants.map(v => ({
                        "@type": "Offer",
                        price: v.price,
                        priceCurrency: v.price_currency || "INR",
                    })),
                    hasVariant,
                };

                const script = document.createElement("script");
                script.type = "application/ld+json";
                script.setAttribute("data-injected-by", "milton-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below.
            }
        });

        // The gallery can lazy-render extra slides on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, but only as a fallback for if the JSON-LD injection
        // above fails — normally `name` comes from the injected JSON-LD
        // first.
        title: ["h1.product__title", "h1"],

        // Confirmed: the real selling price. See the big module comment
        // above for why this is scoped through BOTH `[id^="ProductInfo-"]`
        // (the real buy-box, not a recommendation card reusing the same
        // classes) and `.f-price__sale` (the wrapper that holds the
        // genuine numbers on a discounted product).
        price: [
            '[id^="ProductInfo-"] .f-price__sale .f-price-item--sale',
            '[id^="ProductInfo-"] .f-price-item--regular',
            ".price",
        ],

        // Confirmed but genuinely truncated in the DOM itself (not just
        // CSS-clamped) — this theme's short-description widget swaps its
        // OWN textContent between `data-collapsed-text`/`data-expanded-text`
        // attribute values on click, and extractText() only ever reads
        // textContent, never attributes, so the un-clicked state's literal
        // "...continue..." ellipsis is what this selector returns. Only
        // used as a fallback in practice — the injected JSON-LD above
        // carries the complete `body_html` description already.
        description: [".product-description-text", ".product-short-description"],

        // Confirmed: gallery <img> tags (main slides + nav thumbnails,
        // deduplicated by extractImages()'s Set). Only used as a fallback
        // in practice — the injected JSON-LD above already carries the
        // complete image list from the same `/products/<handle>.json` this
        // theme's own JS uses.
        images: [".product__media-list img", ".product__media img"],

        // Confirmed absent for THIS product (single "1 Gift Set" variant,
        // no real size/color choice) — `sizes`/`colors` come from the
        // injected JSON-LD's `hasVariant` above when a product genuinely
        // has a Size/Colour-named option; omitted here entirely rather
        // than guessed at a DOM selector, matching wishluck.js's same
        // reasoning for its reference product.
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹ 2,400") — see the big module
        // comment above for why this exact scoping (NOT plain
        // `.f-price-item--regular`) is required to avoid grabbing the
        // wrong (duplicate, non-MRP) node. Raw text, not parsed to a
        // number (matches how `mrp` is kept raw in the other configs in
        // this repo).
        mrp: ['[id^="ProductInfo-"] .f-price__sale .f-price-item--regular'],

        // Confirmed: "16% OFF" discount badge next to the price.
        discountPercent: ['[id^="ProductInfo-"] .discount-percentage'],

        // Confirmed: "Save 16%" badge shown near the title, a separate DOM
        // node from discountPercent above (same underlying number, two
        // different UI widgets).
        saveBadge: ['[id^="ProductInfo-"] .f-badge--sale'],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
