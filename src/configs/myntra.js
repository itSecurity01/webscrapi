// Config for myntra.com, built from a real product page (Prosharx Men
// Colourblocked Compression T-shirt, /44993306/buy) fetched via a plain
// HTTP GET (curl, real browser User-Agent) on 2026-09-24, then LIVE-VERIFIED
// with an actual Playwright run against the same URL the same day — full
// end-to-end success (name/brand/price/sku/description/images/sizes/colors
// all resolved via the JSON-LD patch below, every additionalFields entry
// populated).
//
// IMPORTANT, CONFIRMED LIVE: headless Chromium (`chromium.launch({headless:
// true})`, this repo's default) got silently blocked by Myntra on this
// machine — `net::ERR_HTTP2_PROTOCOL_ERROR` on the first attempt, then a
// plain 30s navigation timeout after disabling HTTP/2 client-side, on
// otherwise-identical requests. A HEADED run (`chromium.launch({headless:
// false})`) against the exact same URL immediately succeeded. This repo's
// CLI already has a flag for this — run this config with `--headed` (see
// CLI_REFERENCE.md), e.g. `node src/index.js --website=myntra --headed`.
// Whether plain headless-but-not-`headless:true` variants (e.g. Chrome's
// `--headless=new`) would also pass through was not tested; `--headed` is
// the confirmed-working path.
//
// THE KEY FINDING: every PDP ships a `<script>window.__myx = {"pdpData":
// {...}}</script>` blob BEFORE any JS runs — confirmed present in the raw,
// un-hydrated HTML (curl saw it, so it does not depend on React hydration
// or headless execution). It carries far more structured data than the
// page's own `<script type="application/ld+json">` (which only has
// name/image[1]/sku/mpn/description(=name again)/offers/brand — no MRP,
// discount, sizes, colour, rating, or attributes at all). `beforeExtract`
// below reads `window.__myx.pdpData` and:
//   1. Patches the JSON-LD Product node in place (full gallery, a real
//      description, `size`/`color`) so scraper.js's JSON-LD-first
//      extraction picks up the richer data with no changes needed there —
//      same technique as nykaa.js's `beforeExtract` in this repo.
//   2. Writes every other field the fixed product shape has no slot for
//      (mrp, discount, rating, seller, fabric/fit/pattern/...) into hidden
//      `[data-scraper-field="..."]` spans appended to <body>, since
//      `additionalFields` can only read element text, not window globals —
//      `additionalFields` below just points selectors at those spans.
// If `window.__myx` is ever absent (redesign, A/B test, bot-detection
// block page), every hidden span is skipped and extraction falls through
// to the plain DOM `selectors` below — those are UNVERIFIED best-guess
// class names from general Myntra PDP knowledge, not confirmed against
// this fetch (the raw HTML has zero rendered PDP markup/classes in it at
// all — everything user-visible is client-rendered from `__myx` after
// hydration, which curl never runs), so treat them as a fallback of last
// resort and check them against a live headed run first.
//
// CONFIRMED (from the real payload, see comments below): `pdpData.media`
// image URLs are a *template* — `h_($height),q_($qualityPercentage),
// w_($width)` literally in the string, not a real path — and would 404 if
// downloaded as-is. Filled in with concrete values before use.
module.exports = {
    name: "myntra",

    beforeExtract: async (page) => {
        // window.__myx is inlined in the initial document (confirmed via
        // curl, no hydration needed), but give the navigation a moment in
        // case Myntra ever moves it behind a deferred/async script.
        await page.waitForFunction(() => window.__myx && window.__myx.pdpData, { timeout: 15000 }).catch(() => {});

        await page.evaluate(() => {
            try {
                const p = window.__myx && window.__myx.pdpData;
                if (!p) return;

                const stripHtml = (html) =>
                    (html || "")
                        .replace(/<[^>]+>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim();

                // CONFIRMED: `media.albums[0].images[].secureSrc` holds the
                // full gallery (7 photos on the sample product), but as a
                // sizing TEMPLATE, e.g. ".../h_($height),q_($qualityPercentage),
                // w_($width)/v1/assets/images/...jpg" — the literal
                // "($height)" etc. substrings, not real numbers. Fill in
                // concrete values (matching the size Myntra's own JSON-LD
                // uses for its single cover image) so the URL is actually
                // fetchable.
                const album = (p.media && p.media.albums && p.media.albums[0]) || { images: [] };
                const images = (album.images || [])
                    .map((img) => img.secureSrc || img.src || "")
                    .map((u) => u.replace("($height)", "1440").replace("($qualityPercentage)", "100").replace("($width)", "1080"))
                    .filter(Boolean);

                // CONFIRMED: `productDetails` is an array of {title,
                // description} panels ("Product Details", "MATERIAL & CARE",
                // "SIZE & FIT" on the sample product), `description` being
                // an HTML string (`<ul><li>...`) — stripped to plain text
                // and joined, since scraper.js's `description` field is
                // plain prose.
                const description = (p.productDetails || [])
                    .map((section) => {
                        const body = stripHtml(section.description);
                        return section.title && body ? `${section.title}: ${body}` : body;
                    })
                    .filter(Boolean)
                    .join("\n");

                // CONFIRMED: `sizes[]` entries carry `.label` ("S"/"M"/...)
                // and `.available` (boolean). All labels are captured (not
                // just in-stock ones) so a sold-out size still shows up in
                // the product's size range — `availableSizes` below (a
                // separate additionalFields entry) carries the in-stock
                // subset if that distinction matters downstream.
                const allSizes = (p.sizes || []).map((s) => s.label).filter(Boolean);
                const availableSizes = (p.sizes || []).filter((s) => s.available).map((s) => s.label).filter(Boolean);

                // Patch the native JSON-LD Product node in place — same
                // "find script, JSON.parse, mutate, JSON.stringify back"
                // technique as nykaa.js in this repo.
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                for (const script of scripts) {
                    let data;
                    try {
                        data = JSON.parse(script.textContent);
                    } catch {
                        continue;
                    }
                    const nodes = Array.isArray(data) ? data : [data];
                    const product = nodes.find((n) => {
                        const type = n && n["@type"];
                        return type === "Product" || (Array.isArray(type) && type.includes("Product"));
                    });
                    if (!product) continue;

                    if (images.length > 0) product.image = images;
                    if (description) product.description = description;
                    // schema.org's `size`/`color` — scraper.js's
                    // collectJsonLdVariantValues() reads these directly off
                    // the Product node (wrapping a lone string into a
                    // 1-item array itself).
                    if (allSizes.length > 0) product.size = allSizes;
                    if (p.baseColour) product.color = p.baseColour;
                    // CONFIRMED: `price.discounted` (596) is the real
                    // selling price shown on-page; the native JSON-LD
                    // already carries this same value as `offers.price`
                    // ("596", already a string) — reapplied here defensively
                    // in case that ever drifts, coerced to a string the same
                    // way `parse.price` below expects.
                    if (p.price && p.price.discounted != null) {
                        product.offers = product.offers || {};
                        product.offers.price = String(p.price.discounted);
                    }

                    script.textContent = JSON.stringify(data);
                    break;
                }

                // Fields with nowhere to go in the fixed product/variants
                // shape — surfaced as hidden spans for `additionalFields`
                // (which can only read DOM text) to pick up.
                const setField = (name, value) => {
                    if (value === null || value === undefined || value === "") return;
                    const el = document.createElement("span");
                    el.setAttribute("data-scraper-field", name);
                    el.style.display = "none";
                    el.textContent = String(value);
                    document.body.appendChild(el);
                };

                // CONFIRMED: `mrp` (3599) is the struck-through original
                // price; `discounts[0]` carries the "(83% OFF)" badge label
                // and a parsed `discountPercent` (83) alongside it.
                setField("mrp", `₹${p.mrp}`);
                const discount = (p.discounts || [])[0];
                setField("discountPercent", discount && discount.discountPercent != null ? `${discount.discountPercent}%` : null);
                setField("discountLabel", discount && discount.label);

                setField("availableSizes", availableSizes.join(", "));
                setField("baseColour", p.baseColour);

                // CONFIRMED: `ratings.averageRating` is a float
                // (4.147...), rounded to 1dp for display; `.totalCount` is
                // the rating count (61); `.reviewInfo.reviewsCount` is a
                // separate, smaller written-review count (14) — kept as two
                // distinct fields, not merged, since Myntra itself shows
                // them separately ("61 Ratings" vs "14 Reviews").
                if (p.ratings) {
                    setField("ratingValue", typeof p.ratings.averageRating === "number" ? p.ratings.averageRating.toFixed(1) : null);
                    setField("ratingsCount", p.ratings.totalCount);
                    setField("reviewsCount", p.ratings.reviewInfo && p.ratings.reviewInfo.reviewsCount);
                }

                setField("manufacturer", p.manufacturer);
                setField("countryOfOrigin", p.countryOfOrigin);
                const seller = (p.sellers || [])[0];
                setField("sellerName", seller && (seller.displayName || seller.sellerName));

                // CONFIRMED: `articleAttributes` is a flat label->value map
                // of the "NA"-padded spec table Myntra shows per category
                // (varies by category — these keys are confirmed present
                // for apparel/t-shirts specifically; a non-apparel category
                // will just come back with these fields empty, not broken).
                const attrs = p.articleAttributes || {};
                setField("fabric", attrs["Fabrics"]);
                setField("fit", attrs["Fit"]);
                setField("pattern", attrs["Patterns"]);
                setField("sleeveLength", attrs["Sleeve Length"]);
                setField("neck", attrs["Neck"]);
                setField("occasion", attrs["Occasions"]);
                setField("washCare", attrs["Wash Care"]);
                setField("netQuantity", attrs["Net Quantity"]);
            } catch {
                // Swallow — falls through to the native (thin) JSON-LD and
                // the DOM `selectors` fallback below.
            }
        });

        // Cookie/consent banner — not observed in the static fetch this
        // config was built from, kept as a harmless no-op for parity with
        // every other config in this repo.
        const consentSelectors = ["#onetrust-accept-btn-handler", 'button[id*="accept" i]'];
        for (const sel of consentSelectors) {
            const el = page.locator(sel).first();
            if ((await el.count().catch(() => 0)) > 0) {
                await el.click({ timeout: 2000 }).catch(() => {});
                break;
            }
        }
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // UNVERIFIED — see module comment. Only reached if the __myx-based
        // JSON-LD patch above didn't run (window.__myx missing/blocked).
        title: ["h1.pdp-title", "h1.pdp-name", "h1"],
        price: [".pdp-price strong", ".pdp-price"],
        description: [".pdp-product-description-content", ".index-productDescriptorsContainer"],
        images: [".image-grid-container img", ".image-grid-imageContainer img", "picture img"],

        // Sizes are patched into JSON-LD (`product.size`) above and read
        // from there first; this is only the last-resort DOM fallback.
        sizes: [".size-buttons-unified-size-buttons .size-buttons-size-button", ".size-buttons-size-button"],

        // Colour is patched into JSON-LD (`product.color`) above from
        // `baseColour`. No DOM fallback: on Myntra each colourway is
        // typically its own separate product listing rather than an
        // in-page swatch picker (confirmed on the sample product —
        // `pdpData.colours` was `null`), so there's no swatch-list
        // selector to reliably fall back to.
    },

    additionalFields: {
        mrp: ['[data-scraper-field="mrp"]'],
        discountPercent: ['[data-scraper-field="discountPercent"]'],
        discountLabel: ['[data-scraper-field="discountLabel"]'],
        availableSizes: ['[data-scraper-field="availableSizes"]'],
        baseColour: ['[data-scraper-field="baseColour"]'],
        ratingValue: ['[data-scraper-field="ratingValue"]'],
        ratingsCount: ['[data-scraper-field="ratingsCount"]'],
        reviewsCount: ['[data-scraper-field="reviewsCount"]'],
        manufacturer: ['[data-scraper-field="manufacturer"]'],
        countryOfOrigin: ['[data-scraper-field="countryOfOrigin"]'],
        sellerName: ['[data-scraper-field="sellerName"]'],
        fabric: ['[data-scraper-field="fabric"]'],
        fit: ['[data-scraper-field="fit"]'],
        pattern: ['[data-scraper-field="pattern"]'],
        sleeveLength: ['[data-scraper-field="sleeveLength"]'],
        neck: ['[data-scraper-field="neck"]'],
        occasion: ['[data-scraper-field="occasion"]'],
        washCare: ['[data-scraper-field="washCare"]'],
        netQuantity: ['[data-scraper-field="netQuantity"]'],
    },

    parse: {
        // Defensive string coercion — `raw` may come from the JSON-LD path
        // (already a string here, since the patch above stringifies it) or
        // a DOM text selector; same convention as nykaa.js in this repo.
        price: (raw) => require("../utils/price").parsePrice(String(raw)),
    },
};
