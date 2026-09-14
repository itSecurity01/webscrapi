// Config for controlz.world, built AND live-verified (direct Playwright
// navigation + DOM inspection, no markup was pasted) against a real product
// page (Apple iPhone 16 Plus, Premium Renewed condition,
// /products/apple-iphone-16-plus) on 2026-09-14.
//
// controlz.world sells REFURBISHED/renewed phones on Shopify's newer
// "Horizon" theme (semantic custom elements throughout — `<price-list>`,
// `<sale-price>`, `<compare-at-price>`, `<on-sale-badge>`,
// `<variant-picker>`, `<product-gallery>` — much more stable to hook than
// the usual class-name soup, since these are literal HTML tag names, not
// classes that can be renamed on a redeploy).
//
// SAME "ProductGroup, not Product" JSON-LD gotcha wishluck.js/milton.js in
// this repo already document, confirmed independently here — falls through
// to DOM for everything without the fix below.
//
// Fix: same `/products/<handle>.json` fetch-and-inject technique as
// wishluck.js/milton.js, generalized via canonical link — with ONE
// deliberate widening over those two configs' copies: this product's real
// capacity option is literally named "Storage" (confirmed via the JSON
// endpoint's `options` array — `{"name":"Storage","values":["128GB"]}`),
// not "Size". wishluck.js's original `sizeIdx` detection
// (`name.includes("size")`) would NOT match "storage" and would silently
// drop capacity data — broadened here to
// `name.includes("size") || name.includes("storage")` so it catches both,
// since "Storage" is the far more common naming for this product category
// (phones/laptops/tablets) than literal "Size".
//
// Also confirmed live: this product has a THIRD option beyond size/color —
// "Category" (the refurb condition grade, e.g. "Premium Renewed"). Neither
// wishluck.js's original logic nor the widened copy here maps a 3rd
// option into schema.org's `hasVariant` (schema.org only defines
// `size`/`color` as recognized variant properties, and scraper.js's
// `collectJsonLdVariantValues()` only ever looks for those two literal
// keys) — captured instead as `additionalFields.conditionGrade` from the
// DOM, since it's clearly important data for a refurb-phone listing that
// would otherwise be silently lost.
module.exports = {
    name: "controlz",

    beforeExtract: async (page) => {
        // Mostly server-rendered, but give the theme's hydration JS a
        // moment before extracting.
        await page
            .waitForSelector(["h1.product-info__title", "variant-picker"].join(", "), {
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
        // technique as wishluck.js/milton.js in this repo, generalized via
        // the canonical link, with the widened size/storage detection
        // described above.
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
                const sizeIdx = optionNames.findIndex(n => n.includes("size") || n.includes("storage"));
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
                script.setAttribute("data-injected-by", "controlz-config");
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
        title: ["h1.product-info__title", "h1"],

        // Confirmed: `<sale-price>` is a real custom element (Shopify
        // Horizon theme), not a class — 5 instances exist on the page
        // (likely duplicated across a desktop/mobile or sticky-bar
        // layout), but extractText() always takes the first match, which
        // was confirmed to be the correct main buy-box price.
        price: ["sale-price", ".price"],

        // Confirmed, but only as a fallback — normally `description` comes
        // from the injected JSON-LD's full `body_html` first.
        description: [".product-description", ".rte"],

        // Confirmed, but only used as a fallback in practice — the
        // injected JSON-LD above already carries the complete image list
        // from the same `/products/<handle>.json` this theme's own JS
        // uses.
        images: ["product-gallery img", ".product-gallery img"],

        // NOT used in practice — JSON-LD's injected `hasVariant` above
        // already supplies `colors` (the "Color" option name matches
        // wishluck.js's original colorIdx detection with no widening
        // needed). Kept as the fallback path: `<span class="sr-only">` per
        // swatch, hooked via the theme's own `.thumbnail-swatch` class
        // (confirmed used ONLY for the Color option on this product — the
        // Category option instead uses a different `.block-swatch` class).
        colors: [".thumbnail-swatch span.sr-only"],

        // NOT used in practice — same reasoning as colors above, JSON-LD's
        // injected `hasVariant` already supplies `sizes` via the widened
        // size/storage detection described in the module comment. This DOM
        // fallback grabs the Storage fieldset's summary text next to its
        // legend — confirmed correct for THIS product (single "128GB"
        // value, rendered as plain text, not swatches, since there's only
        // one option). A Lenovo/OPPO-style product genuinely offering
        // MULTIPLE storage capacities would need a swatch-based selector
        // here instead — not yet seen on any controlz.world product
        // checked, so not guessed at.
        sizes: ['fieldset:has(legend:text-is("Storage:")) .h-stack span'],
    },

    additionalFields: {
        // Confirmed: struck-through MRP via the theme's real
        // `<compare-at-price>` custom element. Raw text, not parsed to a
        // number (matches how `mrp` is kept raw in the other configs in
        // this repo).
        mrp: ["compare-at-price"],

        // Confirmed: "Save Rs. 33,000.00" badge, another real custom
        // element (`<on-sale-badge>`).
        discountAmount: ["on-sale-badge"],

        // Confirmed: the refurb condition grade (e.g. "Premium Renewed")
        // — see the big module comment above for why this lives here
        // rather than in `sizes`/`colors`. Scoped via `:has()` +
        // `:text-is()` off the "Category:" legend rather than position,
        // since the fieldset order (Category/Color/Storage) isn't
        // guaranteed stable across products.
        conditionGrade: ['fieldset:has(legend:text-is("Category:")) .h-stack span'],
    },

    parse: {
        // The DOM fallback price text on this theme reads "Rs. 66,999.00"
        // (confirmed live) — the shared parser's currency table only
        // recognizes "₹" and ISO codes (INR/USD/...), not "Rs.", so it
        // would come back with currency: null on that path. This never
        // actually fires when the JSON-LD injection above succeeds (it
        // supplies price/currency directly), but matters if that fetch
        // ever fails and extraction falls through to the DOM `price`
        // selector — same fix as wishluck.js's identical "Rs." case in
        // this repo.
        price: (raw) => {
            const parsed = require("../utils/price").parsePrice(raw);
            if (!parsed.currency && /rs\.?\s*\d/i.test(String(raw))) parsed.currency = "INR";
            return parsed;
        },
    },
};
