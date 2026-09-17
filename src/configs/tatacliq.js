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
        //
        // TEMPLATE FIX (2026-09-17): TataCliq serves at least two different
        // PDP layouts depending on category. Apparel/fashion listings use
        // the "Updated" gallery component (.ProductGalleryDesktopUpdated__*),
        // which is what this file was originally built and confirmed
        // against. Other categories (confirmed here on an electronics
        // accessory — a USB-C cable) render the older/legacy gallery
        // component instead: .ProductGalleryDesktop__image (no "Updated"
        // suffix, singular not plural). Because that class never existed on
        // this page, the gallery half of the wait never matched — it was
        // only resolving via the product-name selector. Harmless for the
        // wait itself (still resolves fine off the title), but it meant the
        // `images` selector below was pointed at a component that doesn't
        // exist on this template and came back empty. Added the legacy
        // gallery container to the wait, and switched `images` below to a
        // selector that matches the shared underlying <img> component used
        // by both templates.
        // TEMPLATE FIX (2026-09-17, round 2): a third PDP layout exists
        // beyond the fashion/electronics ones above — confirmed on a Beauty
        // & Grooming listing (a makeup-fixer spray), which renders under
        // `.PdpBeautyDesktop__container` and has NEITHER of the two gallery
        // classes above nor a Product JSON-LD block (only WebSite/
        // Organization schema — no `offers`/`image`/`description`). Without
        // this selector in the wait list, the wait burned the full 20s
        // timeout on every beauty product (confirmed via live run) and only
        // the generic `h1` fallback in `title` ever resolved — price,
        // description, images and every additionalField came back null.
        await page
            .waitForSelector(
                [
                    ".ProductDetailsMainCard__productName",
                    ".ProductGalleryDesktopUpdated__images",
                    ".ProductGalleryDesktop__content",
                    ".PdpBeautyDesktop__container",
                ].join(", "),
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
        // Shared across fashion/electronics PDP templates.
        // TEMPLATE FIX (2026-09-17, round 2): the Beauty & Grooming template
        // uses <h1 class="ProductAndBrandComponent__product-desc"> instead —
        // added ahead of the generic "h1" catch-all so it's picked
        // specifically rather than relying on there being only one h1.
        title: [".ProductDetailsMainCard__productName", ".ProductAndBrandComponent__product-desc", "h1"],

        // Confirmed: the "MRP: ₹1699" line. NOTE — the same block also
        // carries <meta itemprop="lowPrice" content="1699">, which would be
        // a cleaner numeric source, but extractText() in scraper.js only
        // reads textContent, not attributes, so the <h3> text is used and
        // parse.price below strips the "MRP:" label / ₹ symbol / commas.
        // Shared across fashion/electronics PDP templates.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template has
        // no JSON-LD `offers.price` at all (confirmed — only WebSite/
        // Organization schema on the page), so this DOM fallback is the
        // *only* source of price there. Confirmed markup:
        // <h3 class="PriceComponent__discounted-price">₹551</h3>.
        price: [
            ".ProductDetailsMainCard__price h3",
            ".PriceComponent__discounted-price",
            '[itemprop="lowPrice"]',
            ".price",
        ],

        // Confirmed: short marketing blurb above the spec table. Falls back
        // to the full `itemprop="description"` block, which on this page
        // also contains the trailing Fit/Pattern/Length/... key-value rows
        // as plain nested text (no separator) — fine as a last-resort
        // fallback, but expect it to look a bit run-together. On the
        // electronics template `.Accordion__shortDescription` doesn't
        // exist, so it correctly falls through to `#EPMD` /
        // `[itemprop="description"]`, which is present on both templates.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template has
        // no `itemprop="description"` block either — confirmed the "What it
        // is:" blurb instead lives at
        // `.DetailsComponent__what-it-is-desc`. Added ahead of the other
        // fallbacks since it's the most specific match for that template.
        description: [
            ".Accordion__shortDescription",
            ".DetailsComponent__what-it-is-desc",
            '[itemprop="description"]',
            "#EPMD",
        ],

        // TEMPLATE FIX (2026-09-17): the original selector
        // `.ProductGalleryDesktopUpdated__images` only exists on the
        // fashion template. Confirmed here (electronics/legacy template)
        // that gallery images instead live inside per-thumbnail
        // `.ProductGalleryDesktop__image` wrappers, but every image in both
        // templates — main, thumbs, and zoom — renders through the same
        // shared `<img class="Image__actual">` component. Matching on that
        // directly is template-agnostic and more robust than chasing
        // whichever gallery wrapper class TataCliq ships next. Kept the two
        // wrapper-level selectors first since they scope more tightly
        // (avoids picking up unrelated Image__actual instances elsewhere on
        // the page, e.g. in the "More From Brand" carousel) and fall back
        // to the shared image class only if neither wrapper is present.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template's
        // gallery renders through neither wrapper above nor the shared
        // `Image__actual` component — confirmed its images are
        // `<img class="GalleryImagesComponent__image-gallery-img">`. NOTE:
        // this template's `<img>` also carries a `data-src` attribute set to
        // a React object rather than a URL, which serializes in the DOM as
        // the literal text "[object Object]" — confirmed via live
        // `img.dataset.src` read. scraper.js's extractImages() used to
        // prefer `dataset.src` over `src` unconditionally, which would have
        // silently turned every image on this template into that same
        // broken URL; fixed there to ignore that exact literal instead of
        // special-casing it per-config.
        images: [
            ".ProductGalleryDesktopUpdated__images",
            ".ProductGalleryDesktop__content",
            "img.Image__actual",
            "img.GalleryImagesComponent__image-gallery-img",
        ],

        // Confirmed: size pills (S/M/L/XL/XXL in the supplied markup).
        // Not present on non-apparel listings (e.g. this cable) — that's
        // expected/correct, not a bug; comes back as an empty array.
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
        // isn't the top-level `product.brand`. Shared across fashion/
        // electronics templates.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template
        // renders it as <a class="ProductAndBrandComponent__brand-name">.
        brandName: [
            '#pd-brand-name span[itemprop="name"]',
            ".ProductDetailsMainCard__brandName",
            ".ProductAndBrandComponent__brand-name",
        ],

        // TEMPLATE FIX (2026-09-17): the original comment noted "if a
        // future listing shows a genuine discounted price next to a
        // struck-through MRP, split these into two different selectors" —
        // this cable is exactly that case (price ₹790, MRP ₹1900, 58% off).
        // `.ProductDetailsMainCard__cancelPrice` holds the real crossed-out
        // MRP when a discount is active. Falls back to mirroring `price`
        // (the old behavior) for listings with no separate MRP shown at
        // all, so non-discounted products still resolve to something
        // sensible instead of null.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template's
        // struck-through MRP is <span class="PriceComponent__slash-price">.
        mrp: [
            ".ProductDetailsMainCard__cancelPrice",
            ".PriceComponent__slash-price",
            ".ProductDetailsMainCard__price h3",
        ],

        // Confirmed: "Get this for only ₹1359" coupon-based best price
        // (distinct from MRP — requires applying an offer code at checkout).
        // Shared across fashion/electronics templates. Not applicable to
        // the Beauty & Grooming template (no equivalent coupon-price
        // callout there) — expected to come back empty, not a bug.
        bestOfferPrice: [".ProductDescriptionPage__offerprice"],

        // Confirmed: "Sold By 1 Aditya Birla Fashion And Retail Limited".
        // Raw text kept as-is (the leading "1" looks like a stray
        // icon/count rendered inline) — clean up downstream if needed.
        // TEMPLATE FIX (2026-09-17): `.ProductDescriptionPage__soldByText`
        // doesn't exist on the electronics/legacy template — seller info
        // there renders as "Sold directly by True Accessories" inside
        // `.ProductDescriptionPage__winningSellerTexts`. Added as a
        // fallback.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template
        // uses yet another class for the same "Sold directly by X" line —
        // `.BeautyOtherSellersLink__winningSellerTexts`.
        sellerName: [
            ".ProductDescriptionPage__soldByText",
            ".ProductDescriptionPage__winningSellerTexts",
            ".BeautyOtherSellersLink__winningSellerTexts",
        ],

        // Confirmed: "Viscose, Hand Wash" fabric/care line, second info row
        // under the size selector (first row is the size-chart note). Not
        // applicable to non-apparel listings (e.g. this cable, where
        // `.ModalFit__product_desc_desktop` renders with no children) —
        // expected to come back empty there, not a bug.
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
        //
        // TEMPLATE FIX (2026-09-17): `finerDetailsRaw`'s selector is tied
        // to the Updated gallery and is genuinely absent on the
        // electronics/legacy and Beauty & Grooming templates (no "Finer
        // Details" flyout on either) — left as-is, expected empty there.
        //
        // `productDetailsRaw`'s original selector
        // (.ProductDescriptionPage__contentDetailsPDP) doesn't exist on the
        // electronics/legacy template at all — confirmed the full spec
        // table there (Color Family, Color, Cable Length, In the Box, Net
        // Quantity, Connectivity, Connector, Warranty Description/Summary,
        // Product Depth/Width/Height/Weight, Cord Length) instead renders
        // as repeated `.ProductFeatures__content` blocks (each one a
        // header+value pair) across several Accordion panels (General
        // Features, Technical Features, Connectivity, Warranty,
        // Dimensions). Added as a fallback selector so this template's
        // specs are no longer silently dropped.
        //
        // CONFIRMED (2026-09-17, round 2), via live run: extractList() in
        // scraper.js tries selectors in order and stops at the *first* one
        // with any matches — it does not union across the whole list. That
        // matters here because the electronics-template product's raw spec
        // table came back populated only from `.ProductFeatures__content`,
        // never touching `.ProductDescriptionPage__contentDetailsPDP` (not
        // present on that template anyway, so harmless there) — but it
        // means selector order in this list is a real priority order, not
        // just a wishlist.
        //
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template's
        // spec rows ("Net Quantity: 1", etc.) render as repeated
        // `.DetailsLongComponent__product-details-block` blocks — added as
        // a third fallback.
        finerDetailsRaw: { selectors: [".ProductGalleryDesktopUpdated__productAttributeObject"], multiple: true },
        productDetailsRaw: {
            selectors: [
                ".ProductDescriptionPage__contentDetailsPDP",
                ".ProductFeatures__content",
                ".DetailsLongComponent__product-details-block",
            ],
            multiple: true,
        },

        // Confirmed via itemprop fallback on fashion/electronics templates
        // — the electronics template's rating value renders under a
        // different class (.ProductDetailsMainCard__reviewElectronics) but
        // still carries itemprop="ratingValue"/"reviewCount", so the
        // fallback selectors already handle it correctly.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template has
        // no `itemprop="ratingValue"` at all (confirmed — only
        // `itemprop="reviewCount"`/`"ratingCount"` exist there, which is why
        // reviewCount already worked and rating didn't). Its numeric rating
        // instead renders as
        // <span class="RatingsAndReviewsComponent__rating-value">.
        rating: [
            ".ProductDetailsMainCard__ratingValue",
            '[itemprop="ratingValue"]',
            ".RatingsAndReviewsComponent__rating-value",
        ],
        reviewCount: [".ProductDetailsMainCard__ratingCount", '[itemprop="reviewCount"]'],

        // TEMPLATE FIX (2026-09-17): confirmed on the electronics/legacy
        // template — the discount badge next to price is
        // `.ProductDetailsMainCard__discount` ("58% Off"), not
        // `...discountText`. Reordered so the confirmed class is primary,
        // kept the old guess and the gallery-badge fallback
        // (`.PdpFlags__offer`, "58% off" — confirmed present on this
        // product too) as backups.
        // TEMPLATE FIX (2026-09-17, round 2): Beauty & Grooming template's
        // "(15% OFF)" text sits in
        // <span class="PriceComponent__discount-percentage">.
        discountPercent: [
            ".ProductDetailsMainCard__discount",
            ".ProductDetailsMainCard__discountText",
            ".PriceSection__discount",
            ".PdpFlags__offer",
            ".PriceComponent__discount-percentage",
        ],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};