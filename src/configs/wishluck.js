// Config for wishluck.in, built against a real, live-fetched product page
// (Kids Interactive Learning Phone, /products/interactive-kids-learning-phone)
// on 2026-09-12. Unlike the other configs in this repo, this one wasn't built
// from a markup snippet pasted by the user — the snippet they pasted (a
// 15-slide image gallery) got truncated at the 50,000-char paste limit
// before any title/price/description markup came through, so the real page
// was fetched directly (`curl` for the HTML, and Shopify's own
// `/products/<handle>.json` endpoint) to build and verify this config.
// Re-verify against a live page before production use, same as every config
// in this repo — and in particular re-check the two "NOT confirmed" guesses
// below (colors, rating) against a product that actually has that markup,
// since this reference product didn't.
//
// wishluck.in is Shopify (theme id 93, a heavily customized build — most of
// the usual Dawn-theme block/section names are still present, but some
// standard blocks are simply never rendered on this store, see below).
//
// IMPORTANT — this theme's native Product JSON-LD is USELESS to scraper.js:
// it's typed "ProductGroup", not "Product" (schema.org's node for "this page
// represents a family of variant Products", with the real Product entries
// nested inside `hasVariant`). scraper.js's extractJsonLd()/findProductNodes()
// only ever matches a node whose own @type is (or includes) "Product" — a
// bare "ProductGroup" is silently skipped, so `jsonLd` comes back null for
// this page and EVERY field falls through to DOM selectors. That's a real
// problem for two fields specifically, with no DOM workaround possible:
//   - `brand`: scraper.js reads ONLY `jsonLd.brand.name` — there's no DOM
//     fallback for it anywhere in scraper.js (see its "--- brand ---"
//     block) — and this theme renders no vendor/brand text anywhere on the
//     page either (confirmed: zero DOM matches for any vendor/brand
//     markup). Without fixing the JSON-LD, brand is permanently null.
//   - `description`: confirmed this theme never renders the product's
//     body_html visibly on the page at all — no `.rte`, no
//     `.product__description`, no accordion/tabs/collapsible-content
//     markup anywhere (this store appears to put all descriptive copy
//     inside the product photos themselves instead; the reference product's
//     description only shows up in `<meta name="description">`, the OG/
//     Twitter meta tags, and embedded JSON). And a DOM selector can't
//     recover it either way: `<meta>` tags have no `textContent`, and
//     scraper.js's extractText() only ever reads textContent, never
//     attributes.
//
// Fix (in `beforeExtract` below, so scraper.js itself never has to change):
// fetch this exact product's `/products/<handle>.json` — the same endpoint
// Shopify's own theme JS calls for variant-picker updates, same-origin, no
// auth — and assemble a compliant schema.org "Product" node from it, then
// append that as a *new* `<script type="application/ld+json">` tag.
// scraper.js's normal JSON-LD-first extraction then picks it up exactly like
// any native block. If that fetch ever fails (network hiccup, theme
// change, endpoint moved), it fails silently and extraction falls through
// to the DOM selectors below — worse (null brand, no description) but not
// fatal, and shouldn't happen since this is the same JSON this exact page
// uses to render itself.
module.exports = {
    name: "wishluck",

    beforeExtract: async (page) => {
        // Mostly server-rendered, but give the theme's hydration JS (and the
        // media gallery, see below) a moment before extracting.
        await page
            .waitForSelector([".product__title h1", ".product__media-list"].join(", "), {
                timeout: 15000,
                state: "attached",
            })
            .catch(() => {});

        // No consent banner was visible in the fetched markup; harmless
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

        // See the big module comment above for *why* this exists.
        await page.evaluate(async () => {
            try {
                const canonical = document.querySelector('link[rel="canonical"]');
                const match = canonical && canonical.href.match(/\/products\/([^/?#]+)/);
                if (!match) return;

                const res = await fetch(`/products/${match[1]}.json`, { credentials: "same-origin" });
                if (!res.ok) return;
                const { product } = await res.json();
                if (!product) return;

                // Strip body_html down to plain text via a scratch element
                // instead of a regex, so entities/nesting resolve correctly.
                const scratch = document.createElement("div");
                scratch.innerHTML = product.body_html || "";
                const description = (scratch.textContent || "").trim();

                // Shopify's product.options tells us what each option
                // *means* (e.g. options[0].name === "Size"); map that onto
                // schema.org's `size`/`color` properties, since
                // collectJsonLdVariantValues() in scraper.js only ever looks
                // for those two literal keys on each hasVariant entry. This
                // store's own "Pack" option (quantity bundles, not a real
                // size/color) matches neither and correctly stays out of
                // both — see additionalFields.variantOptions below for that
                // raw data instead.
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
                script.setAttribute("data-injected-by", "wishluck-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below.
            }
        });

        // The gallery (product__media-list) can lazy-render extra slides on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, but only as a fallback for if the JSON-LD injection
        // above fails — normally `name` comes from the injected JSON-LD
        // first. <h1> splits the title into two <span>s
        // (.first-three-words / .remaining-words) for responsive line
        // wrapping; textContent joins them but keeps the source's internal
        // whitespace/newlines, so expect e.g. "Kids Interactive Learning \n
        // Phone" rather than perfectly single-spaced text.
        title: [".product__title h1", "h1"],

        // Confirmed: "Rs.549.00" sale price. `.price-item--regular` is the
        // single price shown when there's no discount at all (no
        // `.price-item--sale` in that case); `.price` alone is a last-resort
        // catch-all. See `parse.price` below — "Rs." isn't recognized by the
        // shared price parser's currency table, only "₹" and ISO codes.
        price: [".price__sale .price-item--sale", ".price__regular .price-item--regular", ".price"],

        // NOT usable — see the big module comment above. This theme never
        // renders body_html anywhere in the DOM, and scraper.js's
        // extractText() only reads textContent (not attributes), so even
        // `meta[name="description"]` wouldn't work here. Left empty
        // deliberately rather than listing a selector that can never
        // succeed; description should come from the injected JSON-LD only.
        description: [],

        // Confirmed: gallery <img> tags inside the main media list.
        // extractImages() picks the largest srcset candidate automatically.
        images: [".product__media-item img", ".product__media img"],

        // NOT confirmed as a genuine "size" selector — this reference
        // product's only variant dimension is a pack-quantity option
        // ("Pack of 1" / "Pack of 2" / "Bundle"), not a size. This <select>
        // is the theme's sticky-add-to-cart-bar variant dropdown, which
        // Shopify server-renders (and keeps in the DOM, just CSS-hidden
        // until the sticky bar activates) for every multi-variant product
        // regardless of what the option is actually called — so on a
        // product that genuinely has a Size option, this will correctly
        // list its values as "<Size> - Rs.<price>" strings; on this
        // reference product it'd list the pack options instead. Only used
        // if the JSON-LD injection's size-aware `hasVariant` above didn't
        // already supply `sizes`.
        sizes: ["select.select__select option"],

        // NOT confirmed — no color-swatch markup was rendered for this
        // reference product (it has no color option), so this is a
        // best-effort guess based on the swatch component stylesheets this
        // theme does load globally (component-swatch.css /
        // component-swatch-input.css), following common Shopify Dawn-theme
        // swatch conventions. Verify against a product that actually has
        // colors before relying on it.
        colors: [".swatch-input__input:checked + label", ".swatch input:checked + label", ".color-swatch"],
    },

    additionalFields: {
        // Confirmed: "Rs.1,189.00" struck-through compare-at price, i.e. the
        // pre-discount MRP. Raw text, not parsed to a number (matches how
        // `mrp` is kept raw in the other configs in this repo).
        mrp: [".price-item--compare"],

        // Confirmed: this store's real variant dimension for this product
        // ("Pack of 1 - Rs.549.00", "Pack of 2 - Rs.998.00", "Bundle -
        // Rs.1,199.00") — the sticky-cart <select> described above, kept
        // here as raw catch-all data for whatever a product's variant
        // option actually is (pack size, bundle, size, color, ...) when it
        // isn't literally "size" or "color".
        variantOptions: { selectors: ["select.select__select option"], multiple: true },

        // Confirmed: "Sold out" badge — only present in the DOM when the
        // currently-selected variant is unavailable; empty/missing
        // otherwise (that's expected, not a broken selector).
        soldOutBadge: [".price__badge-sold-out"],

        // NOT confirmed — no rating/review widget (Judge.me, Loox, Stamped,
        // Okendo, Shopify Product Reviews, ...) was present anywhere in the
        // fetched markup for this product. Best-effort guesses only, kept
        // in case another product on the store has reviews enabled.
        rating: ['[data-rating]', ".jdgm-prev-badge__stars", ".spr-badge-starrating"],
        reviewCount: [".jdgm-prev-badge__text", ".spr-badge-caption"],
    },

    parse: {
        price: (raw) => {
            const parsed = require("../utils/price").parsePrice(raw);
            // DOM fallback price text on this theme reads "Rs.549.00" — the
            // shared parser's currency table only recognizes "₹" and ISO
            // codes (INR/USD/...), not "Rs.", so it comes back with
            // currency: null. This store's currency is confirmed INR (via
            // the product.json endpoint's `price_currency`), so fill that in
            // only when nothing else already supplied a currency — normally
            // the JSON-LD injection above provides one directly.
            if (!parsed.currency && /rs\.?\s*\d/i.test(String(raw))) parsed.currency = "INR";
            return parsed;
        },
    },
};
