// Config for bellavitaorganic.com, built AND live-verified (direct
// Playwright navigation + DOM/JSON inspection, no markup was pasted)
// against a real product page (TAAJ Ameer Attar - 12ml, /products/
// taaj-ameer-attar) on 2026-09-15, plus a second live check against a
// real multi-variant product (Comfort Matte Bullet Lipstick - 4.2g,
// /products/comfort-matte-bullet-lipstick-2, 10 Color variants) to make
// sure the variant handling below isn't guessed from a single-variant page.
//
// bellavitaorganic.com is Shopify (Dawn theme — confirmed via
// `window.Shopify` + the `product__*`/`price__*`/`variant-radios` class
// names). UNLIKE most Shopify configs in this repo (wishluck.js/milton.js/
// controlz.js/plumgoodness.js), this theme's native JSON-LD block IS
// correctly typed "Product" (confirmed live: 4 `<script type="application/
// ld+json">` blocks — Organization, FAQPage, and TWO Product-typed blocks,
// one carrying the real name/description/sku/offers/brand, a second
// carrying only `aggregateRating`) — so `findProductNodes()` matches it
// fine and name/description/sku/price/currency all come through cleanly
// with NO fix needed.
//
// TWO confirmed gaps in that native block, both fixed the same way as the
// other Shopify configs in this repo (fetch-and-patch via the canonical
// link's handle, same `/products/<handle>.json` endpoint this theme's own
// variant-picker JS calls — same-origin, no auth):
//
// 1. GAP: `image` only carries ONE photo (confirmed live: the manually
//    authored block has a single hero image, while the real gallery has 8
//    photos in `.product__media-list img`). Because scraper.js's image
//    logic only falls back to DOM when the JSON-LD `image` field is
//    entirely empty (`if (imageUrls.length === 0)`), a *non-empty but
//    incomplete* array like this one is taken as-is and the other 7 photos
//    are silently lost — there is no DOM fallback path for "JSON-LD had
//    some images but not all of them". Fixed below by overwriting `image`
//    in-place with the full list from `/products/<handle>.json` before
//    scraper.js ever reads the block.
//
// 2. GAP: no `hasVariant` at all, so multi-variant products lose their
//    sizes/colors entirely on the JSON-LD path. Worse, the DOM path can't
//    pick up the slack either for colors: confirmed live on the lipstick
//    page that each color option is a swatch `<input type="radio"
//    name="Color" value="Cherry Pop">` with an EMPTY-text `<label
//    class="color__swatch">` (no visible text node — the color name lives
//    only in the input's `value` attribute). scraper.js's `extractList()`
//    reads `allTextContents()`, which comes back as a list of empty
//    strings for these swatches — so a naive `selectors.colors` DOM
//    selector would silently yield nothing. Fixed the same way as
//    plumgoodness.js/milton.js/controlz.js: build `hasVariant` from
//    `/products/<handle>.json`'s `options`/`variants` (which carry the
//    real color/size names as data, not text nodes) and inject it into the
//    same JSON-LD block, so `collectJsonLdVariantValues()` in scraper.js
//    picks it up on the normal JSON-LD path. Confirmed live against the
//    lipstick page: `options` is `[{ name: "Color", values: [...10] }]`,
//    matched here by `colorIdx` on the option name.
//    NOT every option name maps to `sizes`/`colors` this way — confirmed
//    live that some bellavita products (e.g. "Bright Wonder Skin
//    Brightening Soap", option name "Variant", values "Pack of 3"/"Pack of
//    6"/...) use a generic "Variant"/"Option" option name that isn't
//    semantically a size or a color. Deliberately NOT guessed at beyond
//    "size"/"colour"/"color" in the option name (same restraint as
//    plumgoodness.js) — those products' pack-count variant correctly comes
//    back empty on `sizes`/`colors` rather than being miscategorized; nothing
//    in this repo's fixed product shape has a slot for a generic "Variant"
//    axis anyway.
//
// `brand` comes through from JSON-LD as `"Frag"` — confirmed genuine, not a
// bug: `/products/<handle>.json`'s own `vendor` field is `"Frag"` for this
// product (an internal fragrance-line tag Bella Vita uses for its perfume
// SKUs, not the storefront name "Bella Vita Organic"). Left as-is rather
// than overridden — this repo's configs report what the source actually
// says, not a guessed "nicer" value.
//
// CONFIRMED PRICE TRAP, same shape as sangeetha.js/plumgoodness.js in this
// repo: `.price-item--sale`/`.price-item--regular` (the real price/MRP
// classes) are reused by "you may also like" recommendation cards further
// down the page — confirmed live (6 and 12 total page-wide matches for
// those two classes respectively, vs. exactly 1 each once scoped through
// `.product__info-wrapper`, the real buy-box's own wrapper, confirmed live
// to NOT wrap any recommendation card). Every price-related selector below
// is scoped through `.product__info-wrapper` for that reason.
module.exports = {
    name: "bellavita",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1.product__heading", ".product__info-wrapper .price"].join(", "), {
                timeout: 15000,
                state: "attached",
            })
            .catch(() => {});

        // See the big module comment above for *why* this exists — same
        // fetch-and-inject technique as plumgoodness.js/milton.js/
        // controlz.js in this repo, generalized via the canonical link
        // rather than hardcoded to one product/handle.
        await page.evaluate(async () => {
            try {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                // Same rule scraper.js's own findProductNodes() uses — grab
                // the FIRST script whose @type is (or includes) "Product",
                // so we patch the exact node scraper.js will later read
                // (this page has a second, aggregateRating-only "Product"
                // block further down that must NOT be the target).
                const productScript = scripts.find(s => {
                    try {
                        const d = JSON.parse(s.textContent);
                        const type = d && d["@type"];
                        return type === "Product" || (Array.isArray(type) && type.includes("Product"));
                    } catch {
                        return false;
                    }
                });
                if (!productScript) return;

                const canonical = document.querySelector('link[rel="canonical"]');
                const match = canonical && canonical.href.match(/\/products\/([^/?#]+)/);
                if (!match) return;

                const res = await fetch(`/products/${match[1]}.json`, { credentials: "same-origin" });
                if (!res.ok) return;
                const { product } = await res.json();
                if (!product) return;

                const data = JSON.parse(productScript.textContent);

                // Fix 1: full image gallery instead of the single curated photo.
                if (Array.isArray(product.images) && product.images.length > 0) {
                    data.image = product.images.map(img => img.src);
                }

                // Fix 2: hasVariant, only for option axes that are genuinely
                // a size or a color (see module comment).
                const optionNames = (product.options || []).map(o => (o.name || "").toLowerCase());
                const sizeIdx = optionNames.findIndex(n => n.includes("size"));
                const colorIdx = optionNames.findIndex(n => n.includes("colour") || n.includes("color"));
                const variants = product.variants || [];

                if (variants.length > 1 && (sizeIdx !== -1 || colorIdx !== -1)) {
                    data.hasVariant = variants.map(v => {
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
                }

                productScript.textContent = JSON.stringify(data);
            } catch {
                // Swallow — falls through to the single curated JSON-LD
                // image + the DOM selectors below (no hasVariant, so
                // sizes/colors would come back empty on this product/page).
            }
        });

        // The ratings widget and ingredient/media gallery lazy-render on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, but only as a fallback for if the JSON-LD (already
        // correctly typed "Product" on this theme) fails to parse —
        // normally `name` comes from it directly.
        title: ["h1.product__heading", "h1"],

        // Confirmed: the real, unconditional selling price — either the
        // sale price (when discounted) or the plain regular price.
        // Scoped through `.product__info-wrapper` to avoid the decoy
        // recommendation-card prices elsewhere on the page (see module
        // comment's "PRICE TRAP" note).
        price: [
            ".product__info-wrapper .price__sale .price-item--sale",
            ".product__info-wrapper .price__regular .price-item--regular",
            ".product__info-wrapper .price",
        ],

        // Confirmed, but only as a fallback — the native JSON-LD already
        // carries the complete description (including the top/heart/base
        // fragrance notes) with no fix needed.
        description: [".product__description", ".description"],

        // Confirmed: the real 8-photo gallery (matches `/products/<handle>
        // .json`'s `images` array exactly). Only used as a fallback in
        // practice — the beforeExtract fix above already patches the
        // native JSON-LD's `image` field with this same full list.
        images: [".product__media-list img", ".product-gallery img"],

        // NOT usable as a DOM selector for this theme — see module comment
        // ("GAP 2"): color/size swatch labels have no visible text, only a
        // `value` attribute on their `<input>`, which `extractList()`
        // (`allTextContents()`) cannot read. Omitted rather than given a
        // selector that would silently return blanks; sizes/colors come
        // from the injected JSON-LD `hasVariant` (beforeExtract above)
        // instead, confirmed working against the 10-color lipstick page.
    },

    additionalFields: {
        // Confirmed: struck-through MRP (e.g. "₹599.00"). Same
        // `.product__info-wrapper` scoping as `price` above, for the same
        // reason.
        mrp: [".product__info-wrapper .price__compare .price-item--regular"],

        // Confirmed: "–51%" sale badge next to the price.
        discountPercent: [".product__info-wrapper .badge.price__badge-sale"],

        // Confirmed: Judge.me reviews widget summary line (e.g. "4.87
        // Based on 143 reviews"). JSON-LD DOES carry the same figures as
        // clean numbers (the second Product-typed block's
        // `aggregateRating.ratingValue`/`.reviewCount`, confirmed 4.87/143
        // live) but scraper.js's fixed field set has no slot for
        // aggregateRating and additionalFields can only read the DOM, not
        // jsonLd — so this raw prose string is what's actually available
        // here, not a missed opportunity for a cleaner number (same
        // situation as dotandkey.js's `ratingsSummary`).
        ratingsSummary: [".jdgm-rev-widg__summary"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
