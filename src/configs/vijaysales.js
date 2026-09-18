

module.exports = {
    name: "vijaysales",

    beforeExtract: async (page) => {
        // Wait for the core PDP content to attach. Unlike nykaa.js, I have
        // no live confirmation this site needs scroll-triggered lazy
        // mounting for its description block — the pasted snapshot shows
        // the description's richText content present in the raw HTML
        // (just CSS-hidden via a `d-none` class on its wrapper `<section>`,
        // which is a display concern, not a "not-yet-mounted" one). So
        // this intentionally does NOT include nykaa.js-style scroll
        // choreography unless/until a live run shows it's actually needed.
        await page
            .waitForSelector(
                ["h1.productFullDetail__productName", ".product__price--deatils.vsPrice"].join(", "),
                { timeout: 15000, state: "attached" }
            )
            .catch(() => {});

        // Per CROSS-CHECK #1/#2 above: the rating badge and EMI amount
        // appear to populate after initial load. Give them a real chance
        // to fill in, but explicitly don't fail the whole extraction if
        // they never do — CROSS-CHECK #1 makes clear this field is
        // unreliable on this site regardless, and additionalFields.rating
        // below is written to tolerate coming back empty rather than
        // treating that as an error.
        await page
            .waitForFunction(() => {
                const statsEl = document.querySelector(".product__title--stats");
                return !!(statsEl && /\d/.test(statsEl.textContent || ""));
            }, { timeout: 8000 })
            .catch(() => {});

    
        await page.evaluate(() => {
            try {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                for (const script of scripts) {
                    let data;
                    try {
                        data = JSON.parse(script.textContent);
                    } catch {
                        continue; // e.g. the confirmed-empty first script tag
                    }
                    const nodes = Array.isArray(data) ? data : [data];
                    const product = nodes.find(n => n && n["@type"] === "Product");
                    if (!product) continue;
                    // No patch applied — see module comment. Left as a hook.
                    break;
                }
            } catch {
                // Swallow — falls through to DOM selectors below.
            }
        });
    },

    selectors: {
        // Confirmed present in the pasted snapshot. Only one <h1> on the
        // page in that snapshot.
        title: ["h1.productFullDetail__productName span[role=\"name\"]", "h1"],

        // Confirmed present, scoped to avoid the hidden offer-wrapper
        // duplicate — see PRICE DUPLICATE note above. NOT confirmed to
        // stay uniquely-matching once a real discount/deal is active on a
        // live page (only checked in the one static state this snapshot
        // was in: discount already shown, offer-wrapper hidden).
        price: [".product__price--deatils.vsPrice .product__price--price"],

        // Confirmed present, but only as a fallback — JSON-LD's own
        // `description` field is a real, distinct SEO description (not a
        // duplicated product name, confirmed by comparing the two strings
        // directly in the pasted markup), so scraper.js's own JSON-LD path
        // should already surface it without needing this DOM fallback.
        description: [".productFullDetail__description .richText__root"],

        // Confirmed present: the full 5-image gallery via the carousel's
        // `data-gallery-items` JSON attribute is richer (ordered, with
        // captions) than reading each <img src> individually, and its
        // count already matches the JSON-LD `image` array — no gap to
        // patch here, unlike nykaa.js's single-vs-full-gallery mismatch.
        // scraper.js would need attribute-JSON-parsing support to use this
        // one directly; the plain <img> fallback below works with a
        // standard image-list extractor.
        images: [".carousel__root img.carousel__currentImage", ".thumbnailList__root img.thumbnail__image"],

        // NOT present on this product — see "NOT PRESENT" note above.
    },

    additionalFields: {
        // Confirmed present. Scoped to `.vsPrice` for the same reason as
        // `price` above.
        mrp: [".product__price--deatils.vsPrice .product__price--mrp span"],

        // Confirmed present, same scoping reasoning.
        discountPercent: [".product__price--deatils.vsPrice .product__price--discount-label"],

        // Confirmed present as a form attribute rather than visible text —
        // more reliable than the (also present but visually hidden)
        // `[role="sku"]` element, since that one lives inside a
        // `d-none`-wrapped section.
        sku: ["form.productFullDetail__root"],

        // UNRELIABLE — see CROSS-CHECK #1 above. Confirmed present with a
        // real value in the static snapshot, confirmed EMPTY on a fresh
        // live text fetch, and a DIFFERENT value exists elsewhere on the
        // same live page. Extract it, but don't treat an empty or
        // seemingly-mismatched result as a bug in the selector — it may
        // just be this field, on this site.
        rating: [".product__title--reviews-star.stars"],
        reviewSummaryText: [".product__title--stats"],

        availabilityText: [".instock__text"],
        deliveryEstimate: [".delivery__text"],
        keyFeatures: [".product__keyfeatures--list li"],
        warrantyTitle: ["#warranty_title"],
        warrantyDetails: ["#services__tooltip"],
        bankOffers: [".product__price--deals-card.bank-offers-card .product__price--deals-content p"],
    },

    parse: {
      
        price: (raw) => require("../utils/price").parsePrice(String(raw)),

        mrp: (raw) => require("../utils/price").parsePrice(String(raw)),
    },
};