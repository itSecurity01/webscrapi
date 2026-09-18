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
// SPOT-CHECK (2026-09-17, static only — no live navigation, markup pasted
// by a user against a second, unrelated product: Forest Essentials
// Nayantara Clear Lash/Brow Serum, /p/1323960): `.css-1jczs19` (price) and
// `.slide-view-container img` (gallery) both still matched correctly
// against this different product's rendered DOM, which is a good sign the
// hashes are stable across products within one deployment, not just
// per-page. `.css-u05rr` (mrp) and `.css-bhhehx` (discountPercent) were
// absent on this second product too, but that's this product's own data —
// no strikethrough MRP or discount badge is shown for it at all — not a
// broken selector. NOT checked: the pasted markup for this second product
// cut off before the "Product Description" section rendered and did not
// include any <script type="application/ld+json"> tags, so neither the
// heading-match below nor the JSON-LD node shape it depends on could be
// verified against this product. If description is coming back as a
// duplicate of the title, that's the first place to look — start by
// checking the actual heading text/casing on the page and the shape of the
// ld+json payload.
//
// Confirmed live (original product): the page ships exactly ONE `<script
// type="application/ld+json">`, holding a JSON ARRAY of two nodes — a
// "Product" node (name/image/mpn/sku/brand/description/offers/
// aggregateRating) and a "BreadcrumbList" node. findProductNodes() in
// scraper.js already handles an array payload and correctly finds the
// Product node, so name/brand/price/currency/sku all come through with NO
// fix needed. `brand` is a plain string ("Bronson Professional", not
// `{name: ...}`) — scraper.js's brand extraction already handles both
// shapes.
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
//    ROBUSTNESS FIX (2026-09-17, static, unverified live): the heading
//    match used to require an EXACT, case-sensitive "Product Description"
//    string. That's brittle by construction — a different category
//    rendering it as "Product description" (lowercase d), with an SVG
//    icon inline, or with different trailing whitespace would silently
//    no-op the whole fix (both this injection and the DOM fallback
//    selector below), leaving the duplicate-title description in place
//    with no error raised anywhere. Loosened to a case-insensitive,
//    whitespace-normalized match against a short list of plausible
//    heading variants. Only "Product Description" is actually confirmed
//    live (on the massager product) — the others are unverified guesses
//    at likely category-specific variants, included defensively, not
//    confirmed. Delete them if they turn out to cause a false-positive
//    match somewhere, or better, replace this whole heading-text approach
//    with a real selector once one's been checked live against a couple
//    more categories.
//
// 2. GAP: `image` is a single photo; the real gallery has 7 (confirmed via
//    `.slide-view-container img`, matching the "product image1..7" alt
//    text). Same non-empty-but-incomplete-array gotcha as bellavita.js —
//    scraper.js only falls back to DOM when the JSON-LD image list is
//    entirely empty, so a lone image is taken as-is otherwise. Fixed below
//    by overwriting `image` with the full gallery list. Re-confirmed
//    (statically) against a second product on 2026-09-17: same
//    `.slide-view-container img` shape, 8 images that time.
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
//
// DIAGNOSIS (2026-09-17): user reported price AND images both failing to
// extract on the Forest Essentials product, with the actual ld+json
// payload provided directly (not re-derived). Confirmed from that payload:
// `offers.price` is `1495` — a JSON NUMBER, not a string. Every other
// price selector/parse pair in this repo (including this one) was written
// assuming `parse.price` receives a raw DOM text string like `" ₹790"` and
// strips currency symbols/commas with string methods. If `parsePrice()` in
// ../utils/price does anything like `raw.replace(...)` internally, handing
// it a bare number instead of a string throws a TypeError — not an empty
// field, an uncaught crash. NOT confirmed against the actual utils/price.js
// source (not available here), so this is a strong hypothesis, not a
// verified root cause — but it would tidily explain BOTH fields failing
// together despite being otherwise-unrelated code paths (JSON-LD price vs.
// DOM-scraped gallery), if a crash mid-price-resolution aborts extraction
// before images are ever read. Hardened `parse.price` below to coerce to a
// string first regardless — safe no-op if this wasn't the actual cause,
// fixes it outright if it was. If price/images are still failing after
// this, the cause is upstream in scraper.js's own extraction/error-handling
// (not reachable from a config file) and needs an actual stack trace or
// console error to pin down further.
//
// Also folded the description-heading candidates out of a module.exports
// self-reference (`module.exports._descriptionHeadings`, from the previous
// pass) into a plain module-scoped constant below. Functionally
// equivalent, but removes a hypothetical failure mode if this file's
// harness clones/wraps the exported object in a way that could detach the
// `module` closure reference — cheap insurance, not a confirmed cause.
const DESCRIPTION_HEADINGS = ["Product Description", "Product description", "About the Product", "Description"];

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
            .waitForFunction((headings) => {
                const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();
                const wanted = headings.map(norm);
                const h2 = Array.from(document.querySelectorAll("h2")).find(h => wanted.includes(norm(h.textContent)));
                const body = h2 && h2.nextElementSibling;
                return !!(body && body.textContent.length > 200);
            }, DESCRIPTION_HEADINGS, { timeout: 10000 })
            .catch(() => {});

        // MRP FALLBACK (2026-09-17, requested by user): this product has
        // no active discount, so there's no real `.css-u05rr` MRP element
        // for `additionalFields.mrp` to find — it legitimately comes back
        // empty, which reads as "missing" data even though it's correct.
        // Per request, when no genuine struck-through MRP exists, mirror
        // `price`'s own text into a hidden synthetic node carrying the
        // same `.css-u05rr` class, so `mrp` resolves to the same value as
        // `price` instead of coming back empty. Only fires when a real MRP
        // node is NOT already present, so an actual discount is never
        // overwritten. This makes `discountPercent` (`.css-bhhehx`) stay
        // correctly empty in this case — there's no real "58% off"-style
        // badge to mirror, and synthesizing a fake "0% off" would be
        // actively wrong, so that field is deliberately left alone.
        await page
            .evaluate(() => {
                try {
                    const hasRealMrp = document.querySelector(".css-u05rr");
                    const priceEl = document.querySelector(".css-1jczs19");
                    if (!hasRealMrp && priceEl && priceEl.textContent) {
                        const synthetic = document.createElement("span");
                        synthetic.className = "css-u05rr";
                        synthetic.setAttribute("data-synthetic-mrp", "mirrors-price");
                        synthetic.textContent = priceEl.textContent;
                        synthetic.style.display = "none";
                        priceEl.insertAdjacentElement("afterend", synthetic);
                    }
                } catch {
                    // no-op — mrp just stays empty, same as before this fix
                }
            })
            .catch(() => {});

        // See the big module comment above for *why* this exists.
        await page.evaluate((headings) => {
            try {
                const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();
                const wanted = (headings || []).map(norm);

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
                    // via the description heading's text (case-insensitive,
                    // whitespace-normalized — see ROBUSTNESS FIX comment
                    // above) rather than a hashed class, for resilience to
                    // a future CSS-in-JS rebuild.
                    const descHeading = Array.from(document.querySelectorAll("h2")).find(h => wanted.includes(norm(h.textContent)));
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
        }, DESCRIPTION_HEADINGS);
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
        // JSON-LD above already carries the full, real description.
        // ROBUSTNESS FIX (2026-09-17): switched from Playwright's
        // `:text-is()` (exact, case-sensitive match) to `:has-text()`
        // (case-insensitive substring match) for the same reason as the
        // heading-matching change above — an exact match is one casing
        // change away from silently returning nothing. Note this raw DOM
        // path (unlike the injected fix) does NOT strip the embedded
        // <style> tag's CSS text out of the result.
        description: ['h2:has-text("Product Description") + div'],

        // Confirmed: the real photo gallery. Only used as a fallback in
        // practice — the beforeExtract fix above already patches the
        // native JSON-LD's `image` field with this same full list.
        images: [".slide-view-container img"],

        // NOT present on this product — see module comment.
    },

    additionalFields: {
        // Confirmed: struck-through MRP (e.g. "₹400"). Same leaf-class
        // safety as `price` above (confirmed staying at 2 matches, both
        // the real product's own value, even with recommendations
        // rendered). Comes back empty on products with no active discount
        // shown at all (confirmed on a second product, 2026-09-17) — that's
        // correct behavior, not a selector bug.
        mrp: [".css-u05rr"],

        // Confirmed: "28% Off" badge next to the price. Same "empty on a
        // no-discount product is correct" note as `mrp` above.
        discountPercent: [".css-bhhehx"],
    },

    parse: {
        // DEFENSIVE (2026-09-17): `raw` here can come from either a DOM
        // text selector (already a string, e.g. " ₹790") or straight from
        // JSON-LD's `offers.price` (a raw JS number, e.g. 1495 — confirmed
        // via the actual payload for the Forest Essentials product).
        // parsePrice() was written assuming a string to strip ₹/commas
        // from; feeding it a bare number risks a crash inside a string
        // method. String(raw) makes this safe for either shape. See the
        // DIAGNOSIS comment in the module header for the reasoning — this
        // is a strong hypothesis for the "price and images both failing"
        // report, not a confirmed root cause.
        price: (raw) => require("../utils/price").parsePrice(String(raw)),
    },
};