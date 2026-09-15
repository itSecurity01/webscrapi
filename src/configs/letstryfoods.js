// Config for letstryfoods.com, built AND live-verified (direct Playwright
// navigation + DOM/JSON-LD inspection, no markup was pasted — the element
// given in the request was cross-checked against, not copied from) against
// a real product page (Ganesh Chaturthi Special Combo, /product/
// ganesh-chaturthi) on 2026-09-15, plus a second live check against a
// different product (/product/paachratan-mixture) to confirm the
// single-weight-per-product assumption below isn't guessed from one page.
//
// A Next.js storefront (own custom backend, not Shopify — confirmed via
// `/_next/image?url=...` proxy paths and a bespoke Product JSON-LD shape,
// no `/products/<handle>.json` endpoint like the Shopify configs in this
// repo). Styled entirely with Tailwind utility classes rather than
// CSS-in-JS hashes (unlike nykaa.js in this repo) — much more stable
// selectors as a result, and everything below is server-rendered (no
// lazy-mount/IntersectionObserver timing gotchas like nykaa.js either).
//
// The native Product JSON-LD is correctly typed and genuinely rich —
// confirmed live to carry name/sku/brand/description/offers(price+
// currency)/category/countryOfOrigin/a real 2-photo gallery (as proper
// `ImageObject` nodes, not plain URL strings — scraper.js's image
// extraction already unwraps `{ "@type": "ImageObject", url, ... }` nodes
// generically, same fix added for firstcry.js elsewhere in this repo, so
// this needs NO config-side workaround). name/brand/price/currency/sku/
// images all come through on the JSON-LD path with no fix needed.
//
// ONE confirmed gap: `description` is the raw HTML the CMS stores
// (`"<p>...</p>"`), not plain text — confirmed live. Fixed below by
// stripping tags out of a scratch element before writing it back into the
// existing JSON-LD block, same "scratch div, read .textContent" technique
// plumgoodness.js/milton.js use in this repo for an HTML `body_html`
// field. Left unstripped, a reviewer would see literal `<p>` tags in the
// description textarea — harmless functionally, just untidy.
//
// NOT present: no size/weight variant picker on either product checked —
// each ships a single, fixed weight (e.g. "975 g"), not a multi-value
// picker, and neither product's JSON-LD carries `hasVariant`. This store
// appears to model different pack sizes as entirely separate product URLs
// (several slugs literally end in "-160-gm"/"-180-gm") rather than
// variants of one product page — `selectors.sizes`/`colors` are omitted
// rather than guessed at.
//
// NOT captured: JSON-LD's `category` ("Namkeens") and `countryOfOrigin`
// ("IN") have no DOM equivalent on the page to hang an `additionalFields`
// selector off (additionalFields can only read the DOM, not jsonLd) —
// same kind of gap as bellavita.js's/nykaa.js's uncaptured
// `aggregateRating`. Left uncaptured rather than force-fitting a fragile
// breadcrumb-position selector for one extra field.
//
// CONFIRMED PRICE TRAP, same shape as every other config in this repo
// that has one: "You may also like"-style recommendation cards further
// down the page reuse the exact same `font-bold text-gray-900` (price)
// and `line-through` (MRP) utility classes as the real buy-box — confirmed
// live (17 total page-wide matches for the price class alone, vs. exactly
// 1 once scoped through `.rounded-2xl.border.border-gray-200`, the real
// buy-box's own wrapper, confirmed live to not wrap any recommendation
// card). Every price-related selector below is scoped through that
// wrapper for that reason.
module.exports = {
    name: "letstryfoods",

    beforeExtract: async (page) => {
        // Server-rendered — no lazy-mount wait needed (confirmed live: the
        // "Product Info" table and its full content are already in the DOM
        // immediately after `domcontentloaded`, no scroll/click required).
        await page.waitForSelector(["h1", ".rounded-2xl.border.border-gray-200"].join(", "), { timeout: 15000, state: "attached" }).catch(() => {});

        // See the big module comment above for *why* this exists.
        await page.evaluate(() => {
            try {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                for (const script of scripts) {
                    let data;
                    try {
                        data = JSON.parse(script.textContent);
                    } catch {
                        continue;
                    }
                    const nodes = Array.isArray(data) ? data : [data];
                    const product = nodes.find(n => {
                        const type = n && n["@type"];
                        return type === "Product" || (Array.isArray(type) && type.includes("Product"));
                    });
                    if (!product || typeof product.description !== "string") continue;

                    const scratch = document.createElement("div");
                    scratch.innerHTML = product.description;
                    const clean = (scratch.textContent || "").trim().replace(/\s+/g, " ");
                    if (clean) product.description = clean;

                    script.textContent = JSON.stringify(data);
                    break;
                }
            } catch {
                // Swallow — falls through to the raw-HTML JSON-LD description
                // (still readable, just with literal <p> tags) or the DOM
                // selectors below.
            }
        });
    },

    selectors: {
        // Confirmed, fallback only — the JSON-LD `name` is preferred and
        // there's only one <h1> on the page.
        title: ["h1"],

        // Confirmed: the real selling price. See module comment's "PRICE
        // TRAP" note for why the buy-box wrapper scoping is required.
        price: [".rounded-2xl.border.border-gray-200 span.font-bold.text-gray-900"],

        // Confirmed, fallback only — the injected JSON-LD above already
        // carries the same text, cleaned of its HTML tags.
        description: ['xpath=//div[normalize-space(text())="Description"]/following-sibling::div[1]'],

        // Confirmed: the real 2-photo gallery. Only used as a fallback in
        // practice — JSON-LD's `image` array already carries both (see
        // module comment on the ImageObject unwrap). Deliberately not
        // deduped-by-hand here: the same two photos also render in a
        // thumbnail strip using this same `data-nimg="fill"` attribute,
        // but scraper.js's extractImages() already de-dupes by URL, so
        // the 2x repeat collapses to the correct 2 unique images.
        images: ["img[data-nimg='fill']"],

        // NOT present on either product checked — see module comment.
    },

    additionalFields: {
        // Confirmed: struck-through MRP (e.g. "₹ 1000"). Same buy-box
        // scoping as `price` above, for the same reason.
        mrp: [".rounded-2xl.border.border-gray-200 span.line-through"],

        // Confirmed: "35% OFF" badge next to the price.
        discountPercent: [".rounded-2xl.border.border-gray-200 span.text-green-600"],

        // Confirmed: the "Product Info" spec table — a clean label/value
        // row layout, one row per field, present in the DOM immediately
        // (no accordion click needed; it renders already-expanded).
        ingredients: ['xpath=//div[normalize-space(text())="Ingredients"]/following-sibling::div[1]'],
        netWeight: ['xpath=//div[normalize-space(text())="Unit"]/following-sibling::div[1]'],
        shelfLife: ['xpath=//div[normalize-space(text())="Shelf life"]/following-sibling::div[1]'],
        dietPreference: ['xpath=//div[normalize-space(text())="Diet preference"]/following-sibling::div[1]'],
        disclaimer: ['xpath=//div[normalize-space(text())="Disclaimer"]/following-sibling::div[1]'],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
        mrp: (raw) => require("../utils/price").parsePrice(raw),
    },
};
