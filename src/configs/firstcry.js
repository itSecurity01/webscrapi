// Config for firstcry.com, built against a real product page (Babyhug 100%
// Cotton Woven Full Sleeves Checked Shirt and Joggers Set - Olive Green,
// /24280566/product-detail) inspected live on 2026-09-15.
//
// FirstCry emits schema.org JSON-LD as an `@graph` (Organization, WebPage,
// BreadcrumbList, Product). The Product node carries name / brand.name /
// sku / offers.price+priceCurrency / image[] — so scraper.js takes all of
// those from JSON-LD and most DOM selectors below are fallbacks only.
// Two things JSON-LD does NOT do well here:
//   * `description` is the SEO blurb ("Buy ... online in India at best
//     price from FirstCry.com ✓ Get up to 19% discount...") — the real copy
//     lives in #pdpproductfulldesc and is captured as
//     `additionalInfo.productDescription`.
//   * `image[]` entries are ImageObject ({url,width,height}) rather than
//     plain strings; scraper.js unwraps those (see extractJsonLd image
//     handling), yielding the 1600x1939 /zoom/ renders — the best available.
//
// The page is mostly server-rendered (h1, gallery, sizes, full description
// are in the initial HTML) but the *price block* and the Product JSON-LD are
// injected by a follow-up script ~1.4s after domcontentloaded (measured with
// a polling run; an empty .prod-price shell exists from the start, so that
// is NOT a usable signal). `beforeExtract` waits for the hidden #seoprice
// span, which lands in the same batch as the JSON-LD, MRP and discount.
// Sizes have no JSON-LD equivalent (no hasVariant) and come from the DOM.
// This product has no colour swatches — `colors` is omitted, not guessed.
module.exports = {
    name: "firstcry",

    beforeExtract: async (page) => {
        // #seoprice is display:none, hence state: "attached" (a "visible"
        // wait would burn the full timeout every time). If it never shows
        // up, extraction still proceeds and the trace marks price/sku as
        // missing rather than failing the row outright.
        await page
            .waitForSelector("#seoprice span", { timeout: 15000, state: "attached" })
            .catch(() => {});

        // No consent banner seen; kept for parity with the other configs.
        const consentSelectors = ["#onetrust-accept-btn-handler", 'button[aria-label="Accept"]'];
        for (const sel of consentSelectors) {
            const el = page.locator(sel).first();
            if (await el.count().catch(() => 0) > 0) {
                await el.click({ timeout: 2000 }).catch(() => {});
                break;
            }
        }
    },

    selectors: {
        // Confirmed: <h1 class="J14M_42 cl_21 page_margin">. The J14M_42-style
        // classes are typography tokens shared across the site, so plain h1
        // is the stable hook.
        title: ["h1"],

        // Confirmed: the visible price is split into rupees + <sup>paise
        // ("971" + "19" reads as "97119" via textContent), so prefer the
        // hidden #seoprice span, which holds the clean "971.19". The visible
        // .prod-price also carries data-price="971.19" but extractText only
        // reads text, so it's a last-resort fallback that parse.price will
        // mis-read as 97119 — hence it's listed last.
        price: ["#seoprice span", "#seoprice", ".prod-price"],

        // DOM fallback only — JSON-LD description is present (see header).
        description: ["#pdpproductfulldesc", ".sec-description"],

        // Confirmed: <img class="swiper-lazy prodbig-img"> — first slide has
        // src, the rest data-src (583x720). extractImages() prefers dataSrc.
        // Fallback only; JSON-LD image[] wins with the larger /zoom/ renders.
        images: [".prodbig-img"],

        // Confirmed: size pills. Scoped under .euro-size because the "Size"
        // <label> also carries class .sizetxt. Out-of-stock sizes are still
        // listed (the page greys them rather than removing them); the
        // selected one gets .acivesizeBorder (sic).
        sizes: [".euro-size .prdSize span.sizetxt"],
    },

    additionalFields: {
        // Confirmed: the real marketing description (see header for why this
        // isn't the top-level `product.description`). Starts with the literal
        // "Product Description:" heading text.
        productDescription: ["#pdpproductfulldesc"],

        // Confirmed: <del>1199</del> inside the price paragraph.
        mrp: [".mProdprice del", ".th-discounted-price del"],

        // Confirmed: "19% OFF".
        discountPercent: [".newmrp", ".th-discounted-price .newmrp"],

        // Confirmed: "Price : 947.21 Join Now" — FirstCry Club member price.
        // Raw text incl. the "Join Now" CTA; the digits are again rupees+paise
        // concatenated ("94721"), so treat as informational only.
        clubPriceRaw: [".clubjoinprice"],

        // Confirmed: the size the URL's product id maps to (this listing is
        // one size of a size-set; siblings have their own ids, e.g.
        // 24280565 = 9-12M).
        selectedSize: [".euro-size .prdSize.acivesizeBorder span.sizetxt"],

        // NOT confirmed — this product had zero reviews ("Tap on the stars to
        // Rate & Review"). Best-effort hooks for products that do.
        rating: ['[itemprop="ratingValue"]', ".rating_review_tittle + * .avgrating"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
