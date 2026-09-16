// Config for columbiasportswear.co.in, built AND live-verified (direct
// Playwright navigation + DOM/JSON-LD inspection, no markup was pasted —
// the element given in the request was cross-checked against, not copied
// from) against a real product page (Columbia Men's Black Omni-Wick
// Utilizer Polo, /products/utilizer-polo-ax0126-010) on 2026-09-15, plus a
// second live check against a genuinely discounted product
// (/products/columbia-women-red-sun-trek-flip-bl5786-656) specifically to
// verify the MRP-fallback behaviour below on a product that DOES have an
// active discount, not just the one that doesn't.
//
// The exact same Shopify theme/app stack as adventuras.js elsewhere in
// this repo (identical `product__title`/`product__media-list`/
// `price__sale`/`product-details-table`/`best-for-content-li`/
// `grop-product-swiper` markup, confirmed live field-for-field) — this
// config reuses that one's fetch-and-inject technique and DOM selectors,
// re-verified independently against this store rather than assumed to
// carry over unchanged.
//
// Same "ProductGroup, not Product" JSON-LD gotcha as wishluck.js/milton.js/
// controlz.js/plumgoodness.js/adventuras.js elsewhere in this repo — worse
// here, in fact: confirmed live the page's only `@type: "Product"` node
// (a second, SEO-app-generated block) carries JUST `name`+`aggregateRating`,
// nothing else — no price, image, sku, or description at all. Fixed the
// same way as adventuras.js: fetch Shopify's own `/products/<handle>.json`
// (what the theme's own JS uses) and inject a complete, standards-shaped
// Product JSON-LD from it.
//
// THE MRP/"only one price" CASE (explicitly asked about): confirmed live
// on the reference product that `compare_at_price` is an EMPTY STRING
// (not null, not missing — `""`) on every variant, because this product
// has no active discount — the sale price and regular price are simply
// identical. The DOM mirrors this: `.price__sale s.price-item--regular`
// (the struck-through MRP node) exists but is empty. `additionalFields.mrp`
// below lists that node FIRST, then `.price__regular .price-item--regular`
// (the plain current price) as a fallback — extractText() in scraper.js
// only accepts a match with actual non-empty text, so on a no-discount
// product it skips the empty MRP node and correctly falls through to the
// real price, making `mrp` equal `price` instead of coming back blank.
// Confirmed BOTH ways live: the reference product (no discount) yields
// mrp == price; the second, genuinely-discounted product checked
// (₹1,999 MRP vs ₹1,599 price) correctly yields the real, different MRP
// from the first selector instead of falling through.
//
// NOT `colors`: like adventuras.js, this product's own Shopify options are
// Size-only (S/M/L/XL/XXL) — colour is modelled as 12 SIBLING product
// listings instead (confirmed live via the color-swatch swiper), captured
// as `additionalFields.colorVariantLinks` rather than a real `colors`
// variant of this product.
module.exports = {
    name: "columbia",

    beforeExtract: async (page) => {
        // Server-rendered, but gallery/variant custom elements still need
        // a beat to hydrate before attributes are read off them.
        await page
            .waitForSelector(["h1", ".product__media-list"].join(", "), { timeout: 15000, state: "attached" })
            .catch(() => {});

        // No consent banner observed on the live page; harmless no-op if
        // absent, kept for parity with adventuras.js/other configs.
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

        // See the big module comment above for *why* this exists — same
        // fetch-and-inject technique as adventuras.js/milton.js in this
        // repo. Prefer location.pathname over the canonical link for
        // deriving the handle — more robust, doesn't depend on a
        // canonical tag existing in <head> at all.
        await page.evaluate(async () => {
            try {
                const fromPath = window.location.pathname.match(/\/products\/([^/?#]+)/);
                const canonical = document.querySelector('link[rel="canonical"]');
                const fromCanonical = canonical && canonical.href.match(/\/products\/([^/?#]+)/);
                const match = fromPath || fromCanonical;
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
                            priceCurrency: "INR",
                            availability: v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                        },
                    };
                    // Confirmed live: this product line only has a Size
                    // option — colorIdx comes back -1. Colour siblings are
                    // separate product listings, see `colorVariantLinks`
                    // in additionalFields below.
                    if (sizeIdx !== -1) node.size = optionValues[sizeIdx];
                    if (colorIdx !== -1) node.color = optionValues[colorIdx];
                    return node;
                });

                // Fold in Judge.me's aggregate rating as proper schema.org
                // `aggregateRating` rather than a scraped UI string.
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
                    image: (product.images || []).map(img => img.src),
                    offers: variants.map(v => ({
                        "@type": "Offer",
                        price: v.price,
                        priceCurrency: "INR",
                        availability: v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                    })),
                    hasVariant,
                    ...(aggregateRating ? { aggregateRating } : {}),
                };

                const script = document.createElement("script");
                script.type = "application/ld+json";
                script.setAttribute("data-injected-by", "columbia-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below.
            }
        });

        // The color-swatch anchors (`.grop-product-swiper a.default-group`)
        // carry the sibling colorway's name/URL only as attributes
        // (`data-color`, `href`) — confirmed live their own textContent is
        // blank (just an <img>, no text node), so extractText()/
        // extractList() in scraper.js (which only ever read
        // `.textContent()`) can't see them directly, same shape as a gap
        // hit elsewhere in this repo (e.g. nykaa.js's star-rating
        // aria-label). Fixed by writing each swatch's "Name|URL" into a
        // real, hidden text node scraper.js CAN read — additionalFields
        // .colorVariantLinks below just reads these back.
        await page.evaluate(() => {
            const swatches = Array.from(document.querySelectorAll(".grop-product-swiper a.default-group"));
            swatches.forEach(a => {
                const color = a.getAttribute("data-color");
                if (!color || !a.href) return;
                const marker = document.createElement("span");
                marker.className = "columbia-config-color-link";
                marker.style.display = "none";
                marker.textContent = `${color}|${a.href}`;
                document.body.appendChild(marker);
            });
        });

        // Same lazy-gallery-slide precaution as adventuras.js — confirmed
        // harmless no-op on THIS product (image count didn't change), kept
        // since the injected JSON-LD's `image` list is the real source of
        // truth for the gallery either way.
        await page.evaluate(() => {
            document.querySelectorAll(".other_all_images").forEach(el => (el.style.display = "block"));
        });

        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, fallback only — the injected JSON-LD `name` is
        // preferred. `.product__title h1` matches twice (duplicate
        // mobile/desktop blocks, identical text) — fine for a text-content
        // read, take `.first()` if calling this outside extractText().
        title: [".product__title h1", "h1"],

        // Confirmed, fallback only. Sale price listed first since that's
        // the actually-payable amount when a real discount exists; on a
        // no-discount product both read the same value either way.
        price: [".price__sale .price-item--sale", ".price__regular .price-item--regular", ".price"],

        // Confirmed, fallback only. Targeted by ID PREFIX
        // (`ProductAccordion-collapsible_tab_`), not the full randomised
        // ID — confirmed live this theme mints a fresh random suffix per
        // section instance, so a hardcoded exact ID wouldn't necessarily
        // carry over to a different product/page. `.first()` correctly
        // lands on the real description (confirmed 3700+ chars) out of the
        // theme's several mobile/desktop-duplicated accordion tabs.
        description: ['[id^="ProductAccordion-collapsible_tab_"]'],

        // Confirmed, fallback only — the injected JSON-LD's `image` array
        // already carries the complete gallery from the same endpoint.
        images: [".product__media-list img"],

        // NOT applicable — see module comment on colour being modelled as
        // sibling listings, not a variant of this product.
    },

    additionalFields: {
        // Confirmed: spec table inside the "Product Details" accordion,
        // duplicated mobile/desktop like everything else on this theme —
        // `.first()` (what extractText already does) lands on the right
        // copy either way.
        sku: ['.product-details-table tr:has-text("SKU") td'],
        material: ['.product-details-table tr:has-text("Material") td'],
        countryOfOrigin: ['.product-details-table tr:has-text("Country of Origin") td'],
        manufacturer: ['.product-details-table tr:has-text("Manufacturer") td'],
        fitType: ['.product-details-table tr:has-text("Fit Type") td'],
        careInstructions: ['.product-details-table tr:has-text("Care Instructions") td'],
        netQty: ['.product-details-table tr:has-text("Net Qty") td'],
        features: ['.product-details-table tr:has-text("Features") td'],

        // Confirmed: "Trekking"/"Safari"/"Lifestyle"-style activity chips
        // near the title.
        activityTags: [".best-for-content-li"],

        // Confirmed: MRP-inclusive-of-tax disclaimer under the price.
        taxNote: [".product__tax"],

        // MRP — see the big module comment above for the "only one price"
        // handling this was specifically built and verified for. Listed
        // first so a genuine struck-through MRP wins on a discounted
        // product; falls back to the same node as `price` so `mrp` is
        // never blank on a non-discounted one.
        mrp: [".price__sale s.price-item--regular", ".price__regular .price-item--regular"],

        // Confirmed: the color-swatch strip links to 12 SIBLING colorways
        // of this exact product as separate product URLs (this product
        // has no colour *option* of its own — see module comment). Each
        // entry is "ColorName|https://...url", written into the DOM by the
        // beforeExtract step above (see its comment for why the swatches'
        // own `data-color`/`href` attributes need that indirection).
        colorVariantLinks: { selectors: [".columbia-config-color-link"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
        mrp: (raw) => require("../utils/price").parsePrice(raw),
    },
};
