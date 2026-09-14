// Config for digihaat.in, built AND live-verified (direct Playwright
// navigation + DOM inspection, no markup was pasted) against a real product
// page (Bharat Organics Natural Sweetener Combo Pack,
// /en/p/grocery/bharat-organics/natural-sweetener-combo-pack) on
// 2026-09-14.
//
// DigiHaat is an ONDC (Open Network for Digital Commerce) buyer-app
// storefront — a single product page can represent DIFFERENT sellers'
// listings of the "same" item, distinguished entirely by the URL's query
// string (`provider_id`, `bpp_id`, `domain`, `item_id`, `digilink`). DO NOT
// strip these query params when queuing URLs for this site — confirmed the
// page's actual product data (price/seller/stock) is keyed off them, not
// just the path; a bare `/en/p/.../<slug>` with no query string is a
// different (probably invalid/generic) request.
//
// Emits real schema.org Product JSON-LD (name/brand/sku/price/currency/
// image/description) — confirmed live, TWO "Product" blocks exist on the
// page (a fuller one with `offers`, and a sparser duplicate without) —
// scraper.js's extractJsonLd() takes the FIRST matching block it finds
// across all script tags, confirmed to correctly be the fuller one here,
// so name/brand/sku/price/currency should come from
// `trace.*.source === "json-ld"`. One confirmed quirk worth knowing, not a
// bug in this config: the JSON-LD `image` array itself contains the SAME
// url twice (the site's own markup, confirmed identical entries) —
// scraper.js's JSON-LD image path has no dedup step (unlike its DOM
// fallback path, which does), so `imageUrls` legitimately comes back with
// that one photo listed twice. Downstream consumers should dedupe if that
// matters to them.
//
// NOT used here despite being tempting: this is a Next.js App Router site
// and ships a MUCH richer raw ONDC payload (full compliance data,
// provider/location details, back-of-pack image, per-attribute key/values)
// embedded inside a `self.__next_f.push([1, "..."])` React Server
// Components streaming script — confirmed present and parseable in
// principle, but deliberately NOT parsed here: that flight-protocol
// encoding is an internal Next.js implementation detail (escaped JS, not
// plain JSON, wrapped in React-tree array literals), not a stable public
// data format, and could break silently on any Next.js upgrade with no
// visible symptom other than a field quietly going null. Everything that
// payload carries is ALSO rendered as plain visible text in the DOM
// (confirmed: the exact same 11 compliance lines appear in a real `<ul>`),
// so `additionalFields.detailsList` below reads it from there instead —
// slower to write, but reading the page's own rendered output rather than
// its internal data-fetching plumbing.
module.exports = {
    name: "digihaat",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1", ".line-through"].join(", "), {
                timeout: 15000,
                state: "attached",
            })
            .catch(() => {});

        // No consent banner was visible on the live page; harmless no-op
        // if absent, kept for parity with the other configs.
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

        // The compliance/description list and "Similar Products" section
        // can lazy-render on scroll.
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        // Confirmed, but only as a fallback — JSON-LD supplies `name`
        // first. Two <h1>s exist on the page (mobile sticky header +
        // main content), both with identical text — `.first()` is fine
        // either way.
        title: ["h1"],

        // Confirmed, but only as a fallback — JSON-LD supplies `price`
        // first. Hooked via `:has()` off the immediately-following
        // struck-through MRP span (same "span right before the MRP" trick
        // as milton.js's price selector in this repo), rather than the
        // price span's own class list, which is a long, unremarkable
        // Tailwind utility combo with nothing unique to grab onto.
        price: ["span:has(+ .line-through)", ".price"],

        // Confirmed, but only as a fallback — JSON-LD's own `description`
        // is already present (a short one-liner matching the product
        // name). The richer, itemized compliance/description text is
        // captured separately below as additionalFields.detailsList.
        description: ["h1 + div p"],

        // Confirmed, but only used as a fallback in practice — JSON-LD's
        // image array already supplies the (single) product photo.
        // Deliberately scoped to the thumbnail rail's `alt="Product N"`
        // pattern rather than a bare `img`, since the page also has
        // unrelated "Similar Products" thumbnails further down sharing
        // generic image classes.
        images: ['button img[alt^="Product"]'],

        // NOT present — confirmed no size/color variant picker anywhere on
        // this product (a single fixed grocery combo pack). Both omitted
        // rather than guessed; they'll correctly come back as empty arrays
        // with a "missing" trace on a product that genuinely has none.
    },

    additionalFields: {
        // Confirmed: struck-through MRP ("₹225"), hooked via the
        // theme's real `line-through` utility class. `.first()` is
        // required — confirmed 4 `.line-through` nodes exist on the full
        // page (other product cards further down reuse the same class),
        // but the first is reliably this product's own MRP. Raw text, not
        // parsed to a number (matches how `mrp` is kept raw in the other
        // configs in this repo).
        mrp: [".line-through"],

        // Confirmed: "(12% OFF)" badge, hooked via the theme's semantic
        // `text-success` color utility — confirmed unique on the page (1
        // match).
        discountPercent: [".text-success"],

        // Confirmed: the short pack-contents line right under the title
        // (e.g. "Includes: Brown Sugar 500 gms, Khandsari Sugar 500 gms,
        // Jaggery Powder 500gms") — scoped via `:has()` to the <div> that
        // directly wraps the <h1>, then its next-sibling <div>, since
        // neither element has its own distinguishing class.
        packContents: ["div:has(> h1) + div p"],

        // Confirmed: the full itemized compliance/description list (11
        // lines on this product — pack contents, product name, commodity
        // name, manufacturer name/address, and several FSSAI/nutrition
        // disclosures) as one entry per `<li>`. See the big module comment
        // above for why this is read from the DOM's own rendered list
        // rather than the richer-but-fragile Next.js flight payload that
        // backs it.
        detailsList: { selectors: ["ul.list-disc.pl-5.space-y-2 li"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
