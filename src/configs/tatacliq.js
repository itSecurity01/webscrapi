// Config for tatacliq.com, built against a real product page (Rangmanch by
// Pantaloons Calypso Coral Embroidered Regular Fit Kurta,
// /p-mp000000032018703) supplied by the user on 2026-09-11.
//
// TataCliq's core PDP fields (name/price/images/description) render server-
// side with real class names (not atomic/hashed like Shopsy), so these are
// more stable than the Shopsy config — but re-verify against a live page
// before production use, same as every config in this repo.
//
// TataCliq emits schema.org Product JSON-LD, and (confirmed via a real
// --headed run) it covers name/brand/price/description/images/colors —
// scraper.js tries JSON-LD before any DOM selector below, so check
// `trace.*.source === "json-ld"` first; most of the DOM selectors here only
// end up used for `sizes` (no JSON-LD equivalent found) and the
// `additionalFields` below (mrp/offers/seller/spec-table, none of which
// JSON-LD carries). NOTE: scraper.js's `brand` field only ever reads
// JSON-LD (`jsonLd.brand.name`), no DOM fallback exists in scraper.js
// itself — that's fine here since JSON-LD does carry it, but the DOM brand
// name is *also* captured as `additionalInfo.brandName` as a backup in case
// a future page render omits it from JSON-LD.
//
// IMPORTANT: the page is client-side rendered — on first navigation the DOM
// only has header/footer chrome, no product content (confirmed via
// failure screenshot). `beforeExtract` below waits for real product markup
// or JSON-LD to appear before extracting; don't remove that wait or you'll
// get `product.name: null` validation failures again.
module.exports = {
    name: "tatacliq",

    beforeExtract: async (page) => {
        // TataCliq's PDP is client-side rendered — scraper.js navigates with
        // waitUntil: "domcontentloaded", which resolves as soon as the HTML
        // shell loads, well before React fetches/renders the product block.
        // Without this wait, title/price/images/gallery are all still blank
        // (confirmed via screenshot: header+footer painted, entire middle
        // of the page white) and extraction fails with `product.name` null.
        // Wait for real product content to actually appear before touching
        // anything else.
        //
        // PERF FIX (2026-09-11): this used to be a single waitForSelector()
        // over a comma-joined list that mixed the two DOM elements *and*
        // 'script[type="application/ld+json"]', with the default
        // state: "visible". A <script> tag can never be visible, and
        // Playwright's combined-selector matching resolves to the first
        // DOM-order match across the whole list — on this page the JSON-LD
        // script sits earlier in the DOM than the product content, so the
        // wait kept re-resolving to that permanently-invisible node and
        // burned the *entire* 20s timeout on every single product, even
        // though the real content was ready in a few seconds (confirmed by
        // instrumented timing runs against live product pages). That's why
        // skipping image downloads didn't speed anything up — the cost was
        // this dead wait, not images.
        //
        // The obvious fix (race the DOM wait against a plain "script tag
        // attached" wait) turned out to be its own trap: TataCliq already
        // has 1-2 *non-product* ld+json scripts (tracking/breadcrumb
        // schema) attached within ~1s of navigation, well before the real
        // product data exists — so that race just resolved instantly every
        // time and extraction ran too early, coming back with nulls. An
        // instrumented poll confirmed the DOM element becoming visible and
        // the actual Product JSON-LD landing happen together, ~4-8s in, so
        // the DOM selector alone is the correct — and sufficient — readiness
        // signal; no need to special-case the script tag at all.
        await page
            .waitForSelector(
                [".ProductDetailsMainCard__productName", ".ProductGalleryDesktopUpdated__images"].join(", "),
                { timeout: 20000, state: "visible" }
            )
            .catch(() => {});

        // No consent banner was visible in the supplied markup; harmless
        // no-op if absent, kept for parity with the other configs.
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
        // The gallery (ProductGalleryDesktopUpdated) and size/offer blocks
        // can lazy-render extra content on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(500);
    },

    selectors: {
        // Confirmed: <h1 class="ProductDetailsMainCard__productName">
        title: [".ProductDetailsMainCard__productName", "h1"],

        // Confirmed: the "MRP: ₹1699" line. NOTE — the same block also
        // carries <meta itemprop="lowPrice" content="1699">, which would be
        // a cleaner numeric source, but extractText() in scraper.js only
        // reads textContent, not attributes, so the <h3> text is used and
        // parse.price below strips the "MRP:" label / ₹ symbol / commas.
        price: [".ProductDetailsMainCard__price h3", '[itemprop="lowPrice"]', ".price"],

        // Confirmed: short marketing blurb above the spec table. Falls back
        // to the full `itemprop="description"` block, which on this page
        // also contains the trailing Fit/Pattern/Length/... key-value rows
        // as plain nested text (no separator) — fine as a last-resort
        // fallback, but expect it to look a bit run-together.
        description: [".Accordion__shortDescription", '[itemprop="description"]', "#EPMD"],

        // Confirmed: gallery <img> tags. extractImages() picks the largest
        // srcset candidate automatically; these are plain `src` (protocol-
        // relative, e.g. "//img.tatacliq.com/..."), which normalizeUrl()
        // resolves fine against the page URL.
        images: [".ProductGalleryDesktopUpdated__images"],

        // Confirmed: size pills (S/M/L/XL/XXL in the supplied markup).
        sizes: [".SizeSelectNewPdp__sizeTexts", '[id^="pdpSize-"]'],

        // NOT present in the supplied markup — this product has no color-
        // swatch picker (single-colorway listing), so `colors` is omitted
        // entirely rather than guessed; it'll correctly come back as an
        // empty array with a "missing" trace. The one color name for this
        // product ("CALYPSO CORAL") only appears as plain text inside the
        // generic spec table — see `additionalFields.productDetailsRaw`
        // below, since it has no selector of its own to hook.
    },

    // Arbitrary extra fields beyond the fixed product shape.
    additionalFields: {
        // Confirmed: brand name — see module comment above for why this
        // isn't the top-level `product.brand`.
        brandName: ['#pd-brand-name span[itemprop="name"]', ".ProductDetailsMainCard__brandName"],

        // Confirmed: same node as `price` above — on this page "MRP" *is*
        // the only price shown (no separate struck-through original next to
        // it), so mrp mirrors price here. If a future listing shows a
        // genuine discounted price next to a struck-through MRP, split
        // these into two different selectors.
        mrp: [".ProductDetailsMainCard__price h3"],

        // Confirmed: "Get this for only ₹1359" coupon-based best price
        // (distinct from MRP — requires applying an offer code at checkout).
        bestOfferPrice: [".ProductDescriptionPage__offerprice"],

        // Confirmed: "Sold By 1 Aditya Birla Fashion And Retail Limited".
        // Raw text kept as-is (the leading "1" looks like a stray
        // icon/count rendered inline) — clean up downstream if needed.
        sellerName: [".ProductDescriptionPage__soldByText"],

        // Confirmed: "Viscose, Hand Wash" fabric/care line, second info row
        // under the size selector (first row is the size-chart note).
        fabricCare: [".ModalFit__product_desc_desktop > div:nth-child(2)"],

        // Confirmed but deliberately raw/positional: every "Fabric:",
        // "Pattern:" key/value pair from the gallery's "Finer Details"
        // flyout, and every "Fit"/"Pattern"/"Length"/"Color"/... row from
        // the full spec table at the bottom of the description. Both use
        // generic label/value classes shared across every row, so there's
        // no stable per-field selector (e.g. "Color" alone) — these come
        // back as one string per row/pair (label+value concatenated, no
        // separator) for a reviewer to read, rather than guessing brittle
        // :nth-of-type(N) positions that will silently misalign on any
        // product with a different attribute set.
        finerDetailsRaw: { selectors: [".ProductGalleryDesktopUpdated__productAttributeObject"], multiple: true },
        productDetailsRaw: { selectors: [".ProductDescriptionPage__contentDetailsPDP"], multiple: true },

        // NOT confirmed — no rating/review UI was visible for this specific
        // product (page showed "Share your opinion", i.e. zero reviews).
        // Best-effort guesses for products that do have ratings.
        rating: [".ProductDetailsMainCard__ratingValue", '[itemprop="ratingValue"]'],
        reviewCount: [".ProductDetailsMainCard__ratingCount", '[itemprop="reviewCount"]'],

        // NOT confirmed — no "% off" badge was visible near the price in
        // the supplied markup (only the flat-off coupon codes in the Offers
        // section, which are conditional on applying a code). Best-effort
        // guesses only.
        discountPercent: [".ProductDetailsMainCard__discountText", ".PriceSection__discount"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
