module.exports = {
    name: "adventuras",

    beforeExtract: async (page) => {
        // Server-rendered, but the gallery/variant custom elements
        // (`media-gallery`, `variant-selects`) still need a beat to
        // hydrate before we read attributes off them.
        await page
            .waitForSelector(
                ["h1", ".product__media-list", "variant-selects"].join(", "),
                { timeout: 15000, state: "attached" }
            )
            .catch(() => {});

        // No consent banner observed on the live page; harmless no-op if
        // absent, kept for parity with the other configs in this repo.
        const consentSelectors = [
            "#onetrust-accept-btn-handler",
            'button[aria-label="Accept"]',
            ".cookie-consent button",
        ];
        for (const sel of consentSelectors) {
            const el = page.locator(sel).first();
            if ((await el.count().catch(() => 0)) > 0) {
                await el.click({ timeout: 2000 }).catch(() => {});
                break;
            }
        }

        // Same technique as milton.js: fetch Shopify's own
        // `/products/<handle>.json` (what the theme's own JS uses) and
        // inject a clean JSON-LD block. Doubly worth it on THIS theme
        // because the raw DOM duplicates the price block, every
        // accordion, and the "Best for" tag once each for mobile and
        // once for desktop (identical `id`s reused both times — invalid
        // HTML, and a strict-mode locator error waiting to happen). The
        // injected JSON-LD gives one unambiguous source instead of
        // picking between two copies.
        //
        // Prefer location.pathname over the canonical link for deriving
        // the handle — more robust, since it doesn't depend on a
        // canonical tag existing in <head> at all.
        await page.evaluate(async () => {
            try {
                const fromPath = window.location.pathname.match(/\/products\/([^/?#]+)/);
                const canonical = document.querySelector('link[rel="canonical"]');
                const fromCanonical =
                    canonical && canonical.href.match(/\/products\/([^/?#]+)/);
                const match = fromPath || fromCanonical;
                if (!match) return;

                const res = await fetch(`/products/${match[1]}.json`, {
                    credentials: "same-origin",
                });
                if (!res.ok) return;
                const { product } = await res.json();
                if (!product) return;

                const scratch = document.createElement("div");
                scratch.innerHTML = product.body_html || "";
                const description = (scratch.textContent || "").trim();

                const optionNames = (product.options || []).map((o) =>
                    (o.name || "").toLowerCase()
                );
                const sizeIdx = optionNames.findIndex((n) => n.includes("size"));
                const colorIdx = optionNames.findIndex(
                    (n) => n.includes("colour") || n.includes("color")
                );

                const variants = product.variants || [];
                const hasVariant = variants.map((v) => {
                    const optionValues = [v.option1, v.option2, v.option3];
                    const node = {
                        "@type": "Product",
                        name: v.title,
                        sku: v.sku || undefined,
                        offers: {
                            "@type": "Offer",
                            price: v.price,
                            priceCurrency: "INR",
                            availability: v.available
                                ? "https://schema.org/InStock"
                                : "https://schema.org/OutOfStock",
                        },
                    };
                    // Note: unlike milton's reference product, THIS
                    // product only has a Size option (with one value,
                    // 60L) — colorIdx will simply come back -1 here.
                    // Colour siblings live as separate products, see
                    // `colorVariantLinks` in additionalFields below.
                    if (sizeIdx !== -1) node.size = optionValues[sizeIdx];
                    if (colorIdx !== -1) node.color = optionValues[colorIdx];
                    return node;
                });

                // Bonus over milton.js: fold in Judge.me's aggregate
                // rating (0 reviews on this product today, but the
                // attributes are always present) as proper schema.org
                // `aggregateRating` rather than leaving it as a
                // scraped UI string like "0 reviews".
                const reviewWidget = document.querySelector(".jdgm-rev-widg");
                const aggregateRating = reviewWidget
                    ? {
                          "@type": "AggregateRating",
                          ratingValue: reviewWidget.getAttribute("data-average-rating"),
                          reviewCount: reviewWidget.getAttribute("data-number-of-reviews"),
                      }
                    : undefined;

                const jsonLd = {
                    "@context": "https://schema.org/",
                    "@type": "Product",
                    name: product.title,
                    brand: { "@type": "Brand", name: product.vendor },
                    description,
                    sku: variants[0] ? variants[0].sku : undefined,
                    image: (product.images || []).map((img) => img.src),
                    offers: variants.map((v) => ({
                        "@type": "Offer",
                        price: v.price,
                        priceCurrency: "INR",
                        availability: v.available
                            ? "https://schema.org/InStock"
                            : "https://schema.org/OutOfStock",
                    })),
                    hasVariant,
                    ...(aggregateRating ? { aggregateRating } : {}),
                };

                const script = document.createElement("script");
                script.type = "application/ld+json";
                script.setAttribute("data-injected-by", "adventuras-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below.
            }
        });

        // The 5th gallery slide ships with `display:none` on desktop
        // viewports (only auto-visible under 749px, or after a manual
        // "Show More" click) — force it visible so image extraction
        // doesn't silently drop it.
        await page.evaluate(() => {
            document
                .querySelectorAll(".other_all_images")
                .forEach((el) => (el.style.display = "block"));
        });

        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, fallback only — the injected JSON-LD `name` is
        // preferred. `.product__title h1` matches twice (duplicate
        // mobile/desktop blocks, identical text), which is fine for a
        // text-content read but would be a strict-mode error under a
        // bare Playwright `page.locator('h1')` call — take `.first()`.
        title: [".product__title h1", "h1"],

        // Confirmed, fallback only. `.price__sale .price-item--sale` and
        // `.price__regular .price-item--regular` BOTH also appear twice
        // (duplicate mobile/desktop price blocks under the same reused
        // `id="price-template-..."`). This product has no active
        // discount so both read "₹ 13,999.00" either way. Sale price is
        // listed first since that's the actually-payable amount when a
        // real discount exists. `.price` kept as a last-resort catch-all
        // but it also matches noise inside the Razorpay/Snapmint EMI
        // widgets further down the buy box — avoid relying on it if the
        // scoped selectors above ever come back empty.
        price: [
            ".price__sale .price-item--sale",
            ".price__regular .price-item--regular",
            ".price",
        ],

        // Confirmed, fallback only — not actually truncated on this
        // theme (unlike milton's site), just duplicated. Either copy has
        // the full paragraph.
        description: [
            "#ProductAccordion-collapsible_tab_e9AwmR-template--25120142983442__main",
        ],

        // Confirmed. `.product__media-list` is NOT duplicated (shared
        // media column between breakpoints), so this is safe as-is once
        // `beforeExtract` has unhidden the 5th slide above. Preferred
        // over the injected JSON-LD's `image` list if you want the raw
        // responsive `srcset` info too.
        images: [".product__media-list img"],
    },

    additionalFields: {
        // Confirmed: a single, non-duplicated element carrying the
        // canonical Shopify product ID + currently selected variant ID +
        // product name as data attributes — a nice antidote to all the
        // duplicate-id DOM elsewhere on this theme.
        productId: ["#mswishlistbutton"],

        // Confirmed: spec table lives inside the "Materials, fabric &
        // origin" accordion, duplicated mobile/desktop like everything
        // else — take `.first()` if your extractor doesn't already.
        sku: ['.product-details-table tr:has-text("SKU") td'],
        material: ['.product-details-table tr:has-text("Material") td'],
        countryOfOrigin: [
            '.product-details-table tr:has-text("Country of Origin") td',
        ],
        manufacturer: ['.product-details-table tr:has-text("Manufacturer") td'],
        capacity: ['.product-details-table tr:has-text("Capacity") td'],
        dimensions: ['.product-details-table tr:has-text("Dimension") td'],
        netQty: ['.product-details-table tr:has-text("Net Qty") td'],
        features: ['.product-details-table tr:has-text("Features") td'],

        // Confirmed: "Trekking"-style activity chip(s) near the title.
        activityTags: [".best-for-content-li"],

        // Confirmed: MRP-inclusive-of-tax disclaimer under the price.
        taxNote: [".product__tax"],

        // MRP. Confirmed selector, not a guess — Dawn-based Shopify themes
        // (this one included) render the pre-discount original price as
        // `<s class="price-item price-item--regular">` inside `.price__sale`,
        // right next to the sale price. On THIS product it's present in the
        // DOM but empty (no text content), because `compare_at_price` is
        // `null` in the inline variant JSON — there's no active discount to
        // show. Listed first so a genuine struck-through MRP wins on a
        // discounted product; falls back to the same node as `price` so
        // `mrp` is never empty, which also matches what the site's own
        // "MRP Inclusive of all taxes" tax note implies — absent a
        // discount, price *is* MRP. Same duplicate-mobile/desktop-block
        // caveat as `price` above applies here.
        mrp: [".price__sale s.price-item--regular", ".price__regular .price-item--regular"],

        // Confirmed: the color-swatch strip links to SIBLING colorways
        // of this product as separate product URLs (this product has no
        // color *option* of its own — see the hasVariant note above).
        // `data-color` on each `<a>` holds the colorway name, `href` the
        // sibling product URL. Useful for crawling a whole color family
        // starting from any one page in it.
        colorVariantLinks: [".grop-product-swiper a.default-group"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
        mrp: (raw) => require("../utils/price").parsePrice(raw),
    },
};