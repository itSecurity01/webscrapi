// Config for plumgoodness.com, built AND live-verified (direct Playwright
// navigation + DOM inspection, no markup was pasted) against a real product
// page (Green Tea Pore Cleansing Face Wash, /products/green-tea-pore-
// cleansing-face-wash) on 2026-09-14.
//
// plumgoodness.com is Shopify. Same exact gotcha as wishluck.js/milton.js/
// controlz.js in this repo, confirmed independently here: the theme's
// native Product JSON-LD is typed "ProductGroup", not "Product" — confirmed
// live (two duplicate "ProductGroup" blocks present, no "Product"-typed
// block anywhere on the page). scraper.js's extractJsonLd()/
// findProductNodes() only ever matches a node whose own @type is (or
// includes) "Product" — a bare "ProductGroup" is silently skipped, so
// `jsonLd` comes back null and EVERY field falls through to DOM selectors,
// with the same permanent gap: no DOM fallback exists anywhere in
// scraper.js for `brand` (would be null without a fix).
//
// Fix (same fetch-and-inject technique as milton.js/controlz.js, generalized
// via the canonical link so it isn't hardcoded to this one product): fetch
// this exact product's `/products/<handle>.json` — the same endpoint
// Shopify's own theme JS calls for variant-picker updates, same-origin, no
// auth, confirmed working live for this product (31 images, 3 variants) —
// and assemble a compliant schema.org "Product" node from it, then append
// that as a *new* `<script type="application/ld+json">` tag. scraper.js's
// normal JSON-LD-first extraction then picks it up exactly like any native
// block. Only ONE variant dimension confirmed present on this product
// ("Size": 150 ml / 100 ml / 100 ml x 2) — no "Colour"/"Color" option at
// all, confirmed via the live `/products/<handle>.json` `options` array, so
// only the size-detection half of milton.js's option-index logic is kept
// here (color would simply stay undefined on every variant if a future
// Plum product genuinely has one, which is harmless).
//
// CONFIRMED PRICE TRAP, same shape as sangeetha.js's bank-offer gotcha in
// this repo: the page shows a SECOND "price" figure inside a collapsible
// "Best price: ₹256" toggle, well below the real price block. That number
// is NOT the product's real price — confirmed by expanding the toggle live:
// it's built from the real sale price (₹306) minus a redeemable "PlumCash"
// loyalty credit (₹50) that only applies "once per order" and is contingent
// on the shopper's account/cart state, not a price anyone lands on this page
// and sees charged by default. `price` below is deliberately the real
// `.price--highlight` sale price, NOT `#toggle_price` — that conditional
// figure is not captured at all (it's a moving, cart-dependent number, not
// a fixed product attribute worth stashing under a field name someone could
// mistake for a real price).
//
// Both the real price block AND several decoy "you may also like"
// recommendation cards further down the page reuse the exact same
// `.price-list`/`.price--highlight`/`.discounted` classes (confirmed live:
// 7 total matches for `.price--highlight .money`, only the first belonging
// to the real product) — every price-related selector below is scoped
// through `.product-meta` (the real buy-box's own custom-element wrapper,
// confirmed live to NOT wrap any of the recommendation cards, which instead
// sit under `.product-item-meta__price-list-container`) to guarantee
// exactly one match rather than relying on `.first()` happening to land on
// the right one.
module.exports = {
    name: "plumgoodness",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1.product-meta__title", ".product-meta .price-list"].join(", "), {
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
        // technique as milton.js/controlz.js in this repo, generalized via
        // the canonical link rather than hardcoded to one product/handle.
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
                script.setAttribute("data-injected-by", "plumgoodness-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below.
            }
        });

        // The gallery carousel and offers/coupons widgets can lazy-render
        // on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, but only as a fallback for if the JSON-LD injection
        // above fails — normally `name` comes from the injected JSON-LD
        // first.
        title: ["h1.product-meta__title", "h1"],

        // Confirmed: the real, unconditional selling price — see the big
        // "PRICE TRAP" module comment above for why this must NOT be
        // `#toggle_price`. Scoped through `.product-meta` to avoid the
        // decoy recommendation-card prices elsewhere on the page (see
        // module comment).
        price: [".product-meta .price-list .price--highlight .money", ".price"],

        // Confirmed, but only as a fallback — the injected JSON-LD above
        // already carries the complete `body_html` description (features +
        // benefits + the full clinical-study writeup).
        description: [".product-meta__description", ".description"],

        // Confirmed, but only as a fallback in practice — the injected
        // JSON-LD above already carries the complete 31-photo gallery from
        // the same `/products/<handle>.json` this theme's own JS uses.
        // Deliberately scoped to the Flickity carousel's own media list
        // rather than a bare `img`, since the page also has dozens of
        // unrelated "you may also like" thumbnails further down (confirmed
        // 62 total `img` matches on a looser selector vs. this scoped one).
        images: [".product__media-list img", ".product-gallery img"],

        // Confirmed: Size variant pills (e.g. "150 ml", "100 ml",
        // "100 ml x 2") — this theme's custom combo-box dropdown, not a
        // plain radio/label list (confirmed live: 3 matches, exact text).
        // Falls back to the injected JSON-LD's `hasVariant` above in
        // practice.
        sizes: [".combo-box__option-item"],

        // NOT present — confirmed this product has only a Size option, no
        // Colour/Color option at all (see module comment). Omitted rather
        // than guessed; correctly comes back as an empty array with a
        // "missing" trace. A Plum product that DOES offer a colour/shade
        // choice will need a real selector added here — not yet seen on
        // any page checked so far.
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹360"). Same `.product-meta`
        // scoping as `price` above, for the same reason. Raw text, not
        // parsed to a number (matches how `mrp` is kept raw in the other
        // configs in this repo).
        mrp: [".product-meta .price-list .price--compare .money"],

        // Confirmed: "(15% OFF)" badge next to the price.
        discountPercent: [".product-meta .price-list .discounted"],

        // NOT captured: the "Get upto ₹30 worth of PlumCash" loyalty-earn
        // callout near the price. Deliberately left out rather than given a
        // selector — confirmed live this is rendered entirely by a
        // third-party embed (`#nector-customerearn-container`, a
        // "platform.nector.io" widget) that injects its own deeply nested
        // markup with no stable text-only node to hook (the coin amount
        // sits inside an SVG-adjacent span mixed with unrelated prose from
        // sibling widget text) — exactly the kind of fragile, non-product
        // data this repo's configs avoid guessing at.

        // Confirmed: the two feature-highlight chips right under the title
        // (e.g. "Controls oil upto 2-hrs", "Reduces acne in 7 days") — a
        // short marketing-claim summary distinct from the full description.
        // Scoped through `.product-meta` for the same reason as `price`
        // above: confirmed live that `.advantages .advantage` alone matches
        // 20 nodes (this pattern is reused by "you may also like"
        // recommendation cards further down the page), while scoped to the
        // real buy-box it correctly matches exactly 2.
        advantages: { selectors: [".product-meta .advantages .advantage"], multiple: true },

        // Confirmed: manufacturer/country-of-origin/category tooltip block
        // required by Indian e-commerce regulations — present as plain
        // visible text (inside a hover tooltip, but not CSS-hidden from
        // textContent) on every Plum product page.
        manufacturerName: [".manufacturer-box:has(.manufact-text:text-is(\"Name & address of manufacturer\")) .manufact-add"],
        countryOfOrigin: [".manufacturer-box:has(.manufact-text:text-is(\"Country of origin\")) .manufact-add"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
