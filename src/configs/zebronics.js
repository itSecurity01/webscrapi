// Genuine Shopify storefront (unlike pepperfry.js's Angular SSR case), so
// the fetch-based JSON-LD technique from controlz.js applies almost
// unmodified here. Three confirmed differences from that reference file:
//  1. No <link rel="canonical">  was captured in this snippet, so the
//     product handle is read from the `product-handle` attribute present
//     on <product-media>/<variant-picker> instead — same idea, different
//     confirmed source.
//  2. The DOM price/compare-price text has a visually-hidden accessibility
//     label glued directly onto the front of it (e.g. "Sale price₹
//     1,249.00", no separating space in the markup), so it needs to be
//     stripped before handing off to the shared price parser.
//  3. Gallery <img src> values are protocol-relative ("//shop.zebronics
//     .com/..."), which the shared parser/downstream code may not expect;
//     normalized to https:// in the DOM-image fallback below.
//  4. selectors.images leads with the thumbnail strip, not the main
//     carousel — a main-carousel-only version of this selector was
//     observed returning only one image on a live page. If this still
//     under-returns after that change, the remaining suspect is the
//     extraction call site itself: confirm it's asking for *all* matches
//     for this field, not just the first (the same single-match behavior
//     controlz.js notes for its `price` selector would also explain this
//     symptom if it applies to array-type fields here too — that's a
//     runner-level fix, not something a selector-string change can reach).
module.exports = {
    name: "zebronics",

    beforeExtract: async (page) => {
        // Confirmed elements: the plain heading and the theme's own
        // <variant-picker> custom element (same wait-for-hydration
        // technique as controlz.js's h1/variant-picker pair, and this
        // theme happens to use the identical tag name).
        await page
            .waitForSelector([".product-meta__title", "variant-picker"].join(", "), {
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

        // Same technique as controlz.js/wishluck.js/milton.js — fetch the
        // storefront's own product JSON and inject it as JSON-LD, mainly
        // for the two things the DOM snippet doesn't cleanly offer: the
        // full `body_html` description (only a short one-line feature
        // blurb was captured in the DOM — see additionalFields below) and
        // proper per-variant `hasVariant` entries (color options here).
        await page.evaluate(async () => {
            try {
                const handle = document.querySelector("[product-handle]")?.getAttribute("product-handle");
                if (!handle) return;

                const res = await fetch(`/products/${handle}.json`, { credentials: "same-origin" });
                if (!res.ok) return;
                const { product } = await res.json();
                if (!product) return;

                const scratch = document.createElement("div");
                scratch.innerHTML = product.body_html || "";
                const description = (scratch.textContent || "").trim();

                // This product only has a "Color" option (confirmed:
                // option1 values are "Black"/"White", no option2/3) — the
                // sizeIdx/colorIdx widening from controlz.js is kept for
                // parity in case a future Zebronics product varies by
                // size too, even though it's unused here.
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
                script.setAttribute("data-injected-by", "zebronics-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below. As
                // an extra fallback specifically for this theme, a
                // per-variant JSON blob also ships inline in the page
                // (`<script data-variant type="application/json">`) with
                // the currently-selected variant's price/sku/weight/
                // barcode — cheap to read even if the fetch above fails,
                // though it only covers one variant, not the full set.
            }
        });
    },

    selectors: {
        // Confirmed, real content — no hydration dependency on this
        // theme, unlike pepperfry.js.
        title: [".product-meta__title"],

        // Confirmed present, but the element's raw textContent reads
        // "Sale price₹ 1,249.00" — see parse.price below for why.
        price: [".price-list .price--highlight"],

        // NOT the full product description — only a short one-line
        // feature blurb was captured in this snippet (see
        // additionalFields.shortDescription). The real description comes
        // from the injected JSON-LD's body_html; this selector is left
        // empty rather than pointed at the blurb, since that's a
        // different, narrower field.
        description: [],

        // Confirmed on two separate product pages: the thumbnail strip
        // reliably carries a real, full-resolution src (width=2000, same
        // quality as the main image — "thumbnail" only describes its
        // on-page display size, not the URL it points to) for every
        // single image. Made primary after the main-carousel-only
        // version of this selector was observed returning just one
        // image on a live page — the carousel is Flickity-driven with
        // reveal/lazy attributes (`reveal`, `become-visible`,
        // `reveal-on-scroll`), so not every `.product__media-item img`
        // is reliably populated without scroll/interaction, whereas the
        // thumbnail list has shown no such gap in either capture. Kept
        // as a fallback since it's still a legitimate image source. See
        // parse.images below for the https:// normalization both need.
        images: [".product__thumbnail-list-inner .product__thumbnail img" ],

        // Confirmed: real accessible text labels ("Black"/"White"),
        // unlike pepperfry.js where color names had to be reverse-
        // engineered from filenames. This is the primary path here, not
        // just a fallback.
        colors: [".variant-swatch-list .variant-swatch__item .visually-hidden"],

        // NOT present — this SKU only varies by color (confirmed via
        // both the DOM swatches and the fetched product.options above).
        // Left unset rather than invented for a product that might have
        // one.
        sizes: [],
    },

    additionalFields: {
        // Confirmed: struck-through regular price, same "Regular
        // price"-prefixed-text quirk as the sale price.
        mrp: [".price-list .price--compare"],

        // Confirmed: "Save 50%" badge next to the price.
        discountLabel: [".label--highlight"],

        // Confirmed: short feature line under the title, e.g. "61 Keys |
        // 1.5m Cable | Compact Design | LED backlit". Distinct from the
        // full description (see selectors.description above).
        shortDescription: [".product-form__text p"],

        // Confirmed but often just literal text rather than a number —
        // this theme's Judge.me widget reads "No reviews" until reviews
        // exist, so don't assume it's always numeric.
        reviewCaption: [".rating__caption"],
    },

    parse: {
        // Strip the glued-on visually-hidden "Sale price"/"Regular
        // price" label before handing off to the shared parser — without
        // this, raw text like "Sale price₹ 1,249.00" may confuse a
        // parser expecting the currency symbol at the start.
        price: (raw) => {
            const cleaned = String(raw).replace(/^(Sale price|Regular price)\s*/i, "");
            return require("../utils/price").parsePrice(cleaned);
        },
        mrp: (raw) => {
            const cleaned = String(raw).replace(/^(Sale price|Regular price)\s*/i, "");
            return require("../utils/price").parsePrice(cleaned);
        },
        // Gallery <img src> values are protocol-relative
        // ("//shop.zebronics.com/..."); normalize to https:// since the
        // injected JSON-LD's `image` field (from the fetched product
        // JSON) already comes back with a full scheme, and downstream
        // consumers shouldn't have to handle both forms.
        images: (raw) => {
            const list = Array.isArray(raw) ? raw : [raw];
            return list.filter(Boolean).map((src) => (String(src).startsWith("//") ? `https:${src}` : src));
        },
    },
};