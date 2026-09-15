// Config for floweraura.com, built AND live-verified (direct Playwright
// navigation + DOM inspection, no markup was pasted — the element given in
// the request was cross-checked against, not copied from) against a real
// product page (Petals of Quiet Affection, /p/flower/petals-of-quiet-
// affection-9709910fl) on 2026-09-15, plus a second live check against a
// different product (/p/flower/lily-and-the-celestial-daisy-9721790fl) to
// confirm the site-wide patterns below (decorative filler image, the
// three-accordion layout, no variant picker) aren't guessed from one page.
//
// A custom (non-Shopify) storefront — the Drupal-flavoured markup
// ("form-item form-type-checkboxes", "edit-product-attributes") suggests a
// Drupal Commerce backend, not that it matters here since there's no
// fetchable JSON API endpoint like the Shopify configs in this repo use.
//
// BIG STRUCTURAL DIFFERENCE from every other config in this repo:
// confirmed live, this page ships ZERO `<script type="application/
// ld+json">` blocks — everything is schema.org **microdata** (`itemprop`
// attributes) instead. scraper.js's `extractJsonLd()` only ever looks for
// JSON-LD script tags, so without a fix `jsonLd` comes back null on this
// site and EVERY field falls through to `selectors.*` — including `brand`
// and `sku`, which have NO DOM-selector fallback anywhere in scraper.js
// (only a JSON-LD path exists for those two). Fixed below by having
// `beforeExtract` read the microdata itself and inject a synthetic,
// standards-shaped JSON-LD `<script>` from it — same end goal as the
// fetch-a-JSON-endpoint trick the Shopify configs use (give scraper.js one
// clean node to read via its normal JSON-LD-first path), just sourced from
// already-rendered DOM/microdata instead of a network call, since no API
// endpoint exists here.
//
// `brand` is HARDCODED to "FlowerAura" in that injection, not scraped —
// confirmed live there is no per-product brand field anywhere on the page
// (the only "brand" mentions are inside customer review nodes, always
// "FlowerAura", never the product's own microdata) — this is a single-
// brand D2C gifting site where the seller and the brand are the same
// entity for every product, not a marketplace. If that's ever wrong for a
// specific product (a resold third-party brand), it'll need a real fix.
//
// CONFIRMED JUNK IMAGE, not the star.png/mask.png/icon shape
// utils/imageFilter.js already catches, but the same idea: EVERY gallery
// (both products checked) ends with an extra slide,
// `.../home-page/flowers-grown-across-india.jpg` — a site-wide "trust"
// photo ("flowers grown across India") reused as filler on every product,
// not this product's own photography. Excluded by URL path
// (`/home-page/`) when building the injected `image` array below, since
// the generic junk-filename regex has no reason to know this one site-
// specific asset.
//
// NOT present: no size/variant picker on either product checked — the
// attribute checkbox container is literally classed "attribute-null" and
// renders empty. Where this site DOES render checkboxes there (not
// checked live), they read as optional add-ons (e.g. "add a cake",
// "add candles") from the "form-type-checkboxes" markup, not a
// single-choice size/colour variant — so even a populated version of that
// container likely isn't what `selectors.sizes`/`colors` are for.
// Deliberately omitted rather than guessed.
//
// No price-trap here (unlike most configs in this repo with one) —
// confirmed live `.priceNumber`/`.listPrice`/`.percentagePrice` each stay
// at exactly 1 match even after scrolling well past the fold, so no
// recommendation-carousel collision to scope around.
module.exports = {
    name: "floweraura",

    beforeExtract: async (page) => {
        await page.waitForSelector(["h1", ".priceNumber"].join(", "), { timeout: 15000, state: "attached" }).catch(() => {});

        // See the big module comment above for *why* this exists.
        await page.evaluate(() => {
            try {
                const name = document.querySelector('h1[itemprop="name"]')?.textContent?.trim();
                if (!name) return;

                const description = document.querySelector('[itemprop="Description"]')?.textContent?.trim().replace(/\s+/g, " ") || undefined;
                const sku = document.querySelector('meta[itemprop="mpn"]')?.getAttribute("content") || undefined;
                const priceRaw = document.querySelector('[itemprop="offers"] meta[itemprop="price"]')?.getAttribute("content");
                const price = priceRaw ? parseFloat(priceRaw) : undefined;
                const priceCurrency = document.querySelector('[itemprop="offers"] [itemprop="priceCurrency"]')?.getAttribute("content") || "INR";

                // Full gallery, minus the site-wide decorative filler slide
                // (see module comment).
                const images = Array.from(document.querySelectorAll(".image-gallery-slide .image-gallery-image img"))
                    .map(img => img.src)
                    .filter(src => src && !src.includes("/home-page/"));

                const jsonLd = {
                    "@context": "https://schema.org/",
                    "@type": "Product",
                    name,
                    brand: { "@type": "Brand", name: "FlowerAura" },
                    description,
                    sku,
                    image: images,
                    offers: { "@type": "Offer", price, priceCurrency },
                };

                const script = document.createElement("script");
                script.type = "application/ld+json";
                script.setAttribute("data-injected-by", "floweraura-config");
                script.textContent = JSON.stringify(jsonLd);
                document.head.appendChild(script);
            } catch {
                // Swallow — falls through to the DOM selectors below (note:
                // `brand`/`sku` have no DOM-fallback path in scraper.js at
                // all, so a failure here means those two specific fields
                // come back missing, not wrong).
            }
        });
    },

    selectors: {
        // Confirmed, fallback only — the injected JSON-LD `name` is
        // preferred, and there's only one <h1> on the page.
        title: ["h1"],

        // Confirmed, fallback only.
        price: [".priceNumber"],

        // Confirmed, fallback only — matches the injected JSON-LD text
        // exactly (same source node).
        description: ['[itemprop="Description"]'],

        // Confirmed, fallback only. Unlike the injected fix above, this
        // raw DOM path does NOT exclude the decorative
        // "flowers-grown-across-india.jpg" filler slide — see module
        // comment.
        images: [".image-gallery-slide .image-gallery-image img"],

        // NOT present on either product checked — see module comment.
    },

    additionalFields: {
        // Confirmed: struck-through MRP (e.g. "₹ 645").
        mrp: [".listPrice"],

        // Confirmed: "32% OFF" badge next to the price.
        discountPercent: [".percentagePrice"],

        // Confirmed: the average star rating (e.g. "4.7") and the ratings
        // count (e.g. "3 Ratings"). Two separate spans on this theme, not
        // one combined sentence like some other configs in this repo get —
        // captured as two plain fields instead of forcing a join.
        rating: [".reviewPoint"],
        ratingsCount: [".total-reviews-ratings-count"],

        // Confirmed: the "Product Contains" accordion — what's physically
        // in the box (e.g. "2 Purple Sola Beauty Rose"). Scoped through
        // its own accordion (`:has()` on the "Product Contains" heading)
        // rather than a bare `ul.containsdata li` — confirmed live that
        // bare selector also picks up the unrelated "Care Instructions"
        // accordion further down the page, which reuses the exact same
        // `ul.containsdata` class.
        productContains: { selectors: ['.accordian-contains:has(.heading:text-is("Product Contains")) ul.containsdata li'], multiple: true },

        // Confirmed: generic flower-care tips, same accordion-scoping
        // reason as `productContains` above.
        careInstructions: { selectors: ['.accordian-contains:has(.heading:text-is("Care Instructions")) ul.containsdata li'], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
