// Config for nykaa.com (the main Nykaa beauty/wellness site — NOT
// nykaafashion.com, which already has its own config in this repo and is a
// separate storefront/theme). Built AND live-verified (direct Playwright
// navigation + DOM/JSON-LD inspection, no markup was pasted) against a real
// product page (Bronson Professional 3D Body Massager, /p/677038) on
// 2026-09-15.
//
// IMPORTANT CAVEAT, different from every Shopify config in this repo:
// nykaa.com is a custom React SPA styled with Emotion/CSS-in-JS, so every
// class name below (the "css-xxxxxxx" ones) is a BUILD-GENERATED HASH, not
// an authored theme class — confirmed live that at least one of these
// (.css-1jczs19 for price) is worth double-checking after any visible
// Nykaa redesign, since a rebuild can reassign these hashes. Kept minimal
// and JSON-LD-first specifically because of this fragility — see below.
//
// Confirmed live: the page ships exactly ONE `<script type="application/
// ld+json">`, holding a JSON ARRAY of two nodes — a "Product" node (name/
// image/mpn/sku/brand/description/offers/aggregateRating) and a
// "BreadcrumbList" node. findProductNodes() in scraper.js already handles
// an array payload and correctly finds the Product node, so name/brand/
// price/currency/sku all come through with NO fix needed. `brand` is a
// plain string ("Bronson Professional", not `{name: ...}`) — scraper.js's
// brand extraction already handles both shapes.
//
// TWO confirmed gaps in that native Product node, both fixed the same
// fetch-nothing / DOM-read-and-patch way (no API endpoint like Shopify's
// products.json exists here, so this reads straight from the rendered
// DOM instead):
//
// 1. GAP: `description` is just the product NAME repeated verbatim, not a
//    real description — confirmed live, both strings are byte-identical.
//    Because scraper.js only falls back to the DOM when jsonLd.description
//    is falsy (it never is here — a duplicated title is still "truthy"),
//    the real, much richer description (features/how-to-use/manufacturer
//    address, confirmed live right under the "Product Description" h2)
//    would otherwise never be picked up. Fixed below by overwriting
//    `description` in place before scraper.js reads the block. Found via
//    that heading's own TEXT, not a hashed CSS-in-JS class — confirmed
//    live this section only lazy-mounts once actually scrolled into view
//    (an IntersectionObserver, not just CSS-hidden), and a single big
//    scroll jump plus a fixed delay missed it more often than not (~3
//    failures in 5 runs); several smaller scroll steps with a short pause
//    between each, then waiting for real text rather than just the
//    element's presence, reproduced reliably (see beforeExtract below).
//    That block also embeds an inline `<style>` tag (seller-authored A+-
//    style rich content, confirmed live) whose CSS text leaks into
//    `.textContent` — stripped by removing `<style>` elements from a clone
//    before reading the text, same "leaking style tag" shape as
//    plumgoodness.js's ingredients section elsewhere in this repo.
//
// 2. GAP: `image` is a single photo; the real gallery has 7 (confirmed via
//    `.slide-view-container img`, matching the "product image1..7" alt
//    text). Same non-empty-but-incomplete-array gotcha as bellavita.js —
//    scraper.js only falls back to DOM when the JSON-LD image list is
//    entirely empty, so a lone image is taken as-is otherwise. Fixed below
//    by overwriting `image` with the full gallery list.
//
// CONFIRMED PRICE TRAP, same shape as sangeetha.js/plumgoodness.js in this
// repo, but sharper here: the "Customers also Viewed" recommendation
// carousel reuses the EXACT SAME price-row wrapper class (`.css-1d0jf8e`)
// and the EXACT SAME accessible price sentence class (`.css-1yjfidh`) as
// the real product's buy-box — confirmed live, both balloon from 2 matches
// to 18/24 once that carousel renders, each showing a *different*
// recommended product's price. Both are deliberately NOT used below.
// Instead, the more specific LEAF classes for price/MRP/discount
// (`.css-1jczs19`/`.css-u05rr`/`.css-bhhehx`) were confirmed to stay at
// exactly 2 matches even with the full recommendations rail rendered —
// both matches are the real product's own desktop/mobile responsive
// duplicates (identical value each), never a recommendation card's.
//
// NOT captured: `aggregateRating` (JSON-LD carries a clean 4.2/2033 live)
// has nowhere to go — same situation as bellavita.js/dotandkey.js, no slot
// in scraper.js's fixed shape and additionalFields can only read the DOM.
// Worse than those two here: the only compact on-page rating badge
// (`[aria-label="4.2 out of 5 stars"]`, confirmed live) carries the number
// in its `aria-label` attribute with EMPTY textContent (the stars are
// `aria-hidden` SVGs) — extractText()/extractList() only ever read
// `.textContent`, so there isn't even a usable prose fallback here. Left
// uncaptured rather than adding attribute-reading machinery for one field.
//
// NOT present: no size/colour/shade variant picker on this product
// (confirmed live — no matching selector at all), so `selectors.sizes`/
// `colors` are omitted rather than guessed. A Nykaa product that DOES ship
// a shade picker (common for makeup) will need real selectors added here
// once one's been checked live — not yet seen on any page checked so far.
module.exports = {
    name: "nykaa",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1", ".css-1jczs19"].join(", "), { timeout: 15000, state: "attached" })
            .catch(() => {});

        // The real "Product Description" section lazy-mounts only once
        // it's actually scrolled into view (confirmed live: an
        // IntersectionObserver-driven section, not just CSS-hidden) — one
        // big `wheel(0, 1500)` jump plus a fixed delay was confirmed flaky
        // live (missed it more often than not, ~3 failures in 5 runs): a
        // single large jump can skip past the trigger zone before the
        // observer fires. Scrolling in several smaller steps with a pause
        // between each, THEN waiting for real text (not just the element's
        // bare presence — the empty container can mount an instant before
        // its content does) reproduced reliably across repeated live runs.
        // Or descEl below comes back empty/absent and the fix silently
        // no-ops, leaving the lazy title-duplicate in place.
        for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, 1000).catch(() => {});
            await page.waitForTimeout(350);
        }
        await page
            .waitForFunction(() => {
                const h2 = Array.from(document.querySelectorAll("h2")).find(h => h.textContent.trim() === "Product Description");
                const body = h2 && h2.nextElementSibling;
                return !!(body && body.textContent.length > 200);
            }, { timeout: 10000 })
            .catch(() => {});

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
                    if (!product) continue;

                    // Fix 1: real description, style tag stripped. Found
                    // via the "Product Description" heading's text rather
                    // than a hashed class (see the beforeExtract comment
                    // above on this section's own lazy-mount timing) —
                    // more resilient to a future CSS-in-JS rebuild than
                    // hardcoding e.g. ".css-13tku5v".
                    const descHeading = Array.from(document.querySelectorAll("h2")).find(h => h.textContent.trim() === "Product Description");
                    const descEl = descHeading && descHeading.nextElementSibling;
                    if (descEl) {
                        const clone = descEl.cloneNode(true);
                        clone.querySelectorAll("style").forEach(s => s.remove());
                        const desc = (clone.textContent || "")
                            .trim()
                            .replace(/\s+/g, " ")
                            .replace(/Read More\s*right arrow\s*$/, "")
                            .trim();
                        if (desc) product.description = desc;
                    }

                    // Fix 2: full photo gallery instead of the single JSON-LD image.
                    const galleryImgs = Array.from(document.querySelectorAll(".slide-view-container img"))
                        .map(img => img.src)
                        .filter(Boolean);
                    if (galleryImgs.length > 0) product.image = galleryImgs;

                    script.textContent = JSON.stringify(data);
                    break;
                }
            } catch {
                // Swallow — falls through to the lazy title-as-description,
                // single JSON-LD image, and the DOM selectors below.
            }
        });
    },

    selectors: {
        // Confirmed, but only as a fallback for if the JSON-LD parse above
        // fails — bare "h1" rather than the page's hashed heading class
        // (see module comment on CSS-in-JS churn), and there's only one
        // <h1> on the page.
        title: ["h1"],

        // Confirmed: the real, current selling price. See module comment's
        // "PRICE TRAP" note for why this specific leaf class (not the
        // shared wrapper) is safe.
        price: [".css-1jczs19"],

        // Confirmed, but only as a fallback in practice — the injected
        // JSON-LD above already carries the full, real description. Same
        // heading-anchored lookup as the injection (Playwright's
        // `:text-is()` + adjacent-sibling combinator, confirmed working
        // live), not the hashed class, for the same resilience reason.
        // Note this raw DOM path (unlike the injected fix) does NOT strip
        // the embedded <style> tag's CSS text out of the result.
        description: ['h2:text-is("Product Description") + div'],

        // Confirmed: the real 7-photo gallery. Only used as a fallback in
        // practice — the beforeExtract fix above already patches the
        // native JSON-LD's `image` field with this same full list.
        images: [".slide-view-container img"],

        // NOT present on this product — see module comment.
    },

    additionalFields: {
        // Confirmed: struck-through MRP (e.g. "₹400"). Same leaf-class
        // safety as `price` above (confirmed staying at 2 matches, both
        // the real product's own value, even with recommendations
        // rendered).
        mrp: [".css-u05rr"],

        // Confirmed: "28% Off" badge next to the price.
        discountPercent: [".css-bhhehx"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
