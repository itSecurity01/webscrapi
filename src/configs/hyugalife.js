// Config for hyugalife.com, built AND live-verified (direct Playwright
// navigation + DOM/JSON-LD inspection, no markup was pasted — the element
// given in the request was cross-checked against, not copied from) against
// a real product page (Hyuga One Bio Impact Whey Blend, /product/hyuga-
// one-bio-impact-whey-yeast-protein-blend-...-1kg) on 2026-09-15.
//
// A Next.js storefront. Unlike most configs in this repo, the native
// Product JSON-LD here is genuinely solid for most fields — confirmed live
// it carries a correct `name`/`sku`/`brand`(a proper object)/a COMPLETE,
// already-deduplicated 10-photo `image` array/`offers`(price+currency)/
// `aggregateRating` — so name/brand/price/currency/sku/images all come
// through with NO fix needed, a nice change of pace from most configs in
// this repo.
//
// ONE confirmed gap: no `description` field at all on the JSON-LD Product
// node (confirmed live — the key is simply absent, not empty/wrong).
// Because it's falsy either way, scraper.js's existing `jsonLd?.description
// || null` check already falls back to `selectors.description` on its
// own — no injection trick needed, just a real DOM selector (below) and
// making sure the section is actually open when scraper.js reads it (see
// beforeExtract).
//
// CONFIRMED ACCORDION GOTCHA: Description/Highlights/Ingredients/
// "Manufacture Info"/"Additional Information"/"Product Information" are
// all HeadlessUI `<Disclosure>` panels — confirmed live that everything
// except Description starts COLLAPSED (`aria-expanded="false"`), and
// (unlike a CSS-hidden accordion) HeadlessUI's default Disclosure.Panel
// simply isn't in the DOM at all until opened, confirmed live (0 matches
// for any of their selectors pre-click, exactly 1 each post-click).
// beforeExtract below clicks every currently-collapsed accordion button
// before scraper.js reads anything. Each panel is targeted by walking
// from its own heading's exact text via XPath, not a class (HeadlessUI's
// only other hooks are auto-generated ids like
// `headlessui-disclosure-panel-:rg:`, which are not guaranteed stable
// across renders).
//
// CONFIRMED: no real price-trap here, just a harmless mobile/desktop
// responsive duplicate — `.font-bold.text-4xl` / `del.original-price-
// strikethrough` / `.bg-hyugagreen-50` (discount badge) each match twice,
// both instances always carrying the identical real value, confirmed live
// — safe to use `.first()` (what extractText already does) without extra
// scoping.
//
// NOT `sizes`/`colors`: this product's variant axis is FLAVOUR (e.g.
// "Café Mocha" vs. "Real Dutch Chocolate" for this exact whey blend), not
// a size or a colour — same reasoning as muscleblaze.js elsewhere in this
// repo for the same reason (a protein-powder PDP). Captured instead as
// `additionalFields.flavourOptions`, confirmed to list every option
// (unlike muscleblaze.js's page, this theme keeps the full flavour list in
// the initial DOM, not hidden behind a "Change" toggle) — `sizes`/`colors`
// are correctly left to come back empty rather than force-fit flavour into
// either.
module.exports = {
    name: "hyugalife",

    beforeExtract: async (page) => {
        await page.waitForSelector(["h1", ".font-bold.text-4xl"].join(", "), { timeout: 15000, state: "attached" }).catch(() => {});

        // See the big module comment above ("ACCORDION GOTCHA") for why
        // this exists — without it, every additionalFields selector below
        // (and the description DOM-fallback) would come back empty.
        await page
            .evaluate(() => {
                document.querySelectorAll('button[aria-expanded="false"]').forEach(btn => btn.click());
            })
            .catch(() => {});
        await page.waitForTimeout(500);
    },

    selectors: {
        // Confirmed, fallback only — the JSON-LD `name` is preferred and
        // there's only one <h1> on the page.
        title: ["h1"],

        // Confirmed, fallback only.
        price: [".font-bold.text-4xl"],

        // Confirmed: this is the PRIMARY path for description (JSON-LD has
        // no description field at all — see module comment), not just a
        // fallback. Requires the beforeExtract accordion-open step above;
        // "Description" itself happens to start already-expanded, but
        // waiting costs nothing and protects against that changing.
        description: ['xpath=//h2[normalize-space(.)="Description"]/following-sibling::div[1]'],

        // Confirmed, fallback only — JSON-LD's `image` array already
        // carries the complete, deduplicated 10-photo gallery. This raw
        // DOM path would include the slick carousel's cloned/duplicate
        // slide nodes, but scraper.js's extractImages() already
        // de-duplicates by URL, so that's harmless if it's ever needed.
        images: [".slick-slide .gallery-original"],

        // NOT applicable — see module comment on why this is a flavour
        // axis, not a size/colour one.
    },

    additionalFields: {
        // Confirmed: struck-through MRP (e.g. "₹2999") — an authored,
        // purpose-named class (not a generic Tailwind utility), unusually
        // stable for this kind of selector.
        mrp: ["del.original-price-strikethrough"],

        // Confirmed: "28% OFF" badge next to the price.
        discountPercent: [".bg-hyugagreen-50"],

        // Confirmed: bullet-style highlight claims (e.g. "24g Protein per
        // Serving"). Requires the accordion-open step above.
        highlights: ['xpath=//h2[normalize-space(.)="Highlights"]/following-sibling::div[1]'],

        // Confirmed: full ingredients list. Requires the accordion-open
        // step above.
        ingredients: ['xpath=//h2[normalize-space(.)="Ingredients"]/following-sibling::div[1]'],

        // Confirmed: manufacturer name alone (e.g. "Netsurf Research
        // Labs") — also repeated inside additionalInfoBlock below, kept as
        // its own field since it's cleaner there.
        manufactureInfo: ['xpath=//h2[normalize-space(.)="Manufacture Info"]/following-sibling::div[1]'],

        // Confirmed: country of origin / FSSAI number / manufacturer /
        // packaging type, concatenated with no separators in the raw
        // textContent (e.g. "Country of Origin: IndiaFSSAI Number:
        // 10913077000025Manufacturer: ..."). Left as one raw blob rather
        // than guessing a split — a reviewer can still read it.
        additionalInfoBlock: ['xpath=//h2[normalize-space(.)="Additional Information"]/following-sibling::div[1]'],

        // Confirmed: dietary preference / form / shelf life, same
        // concatenated-blob shape as additionalInfoBlock above.
        productInfoBlock: ['xpath=//h2[normalize-space(.)="Product Information"]/following-sibling::div[1]'],

        // Confirmed: every flavour option's label (e.g. "Café Mocha",
        // "Real Dutch Chocolate") — see module comment on why this isn't
        // `sizes`/`colors`.
        flavourOptions: { selectors: [".variant-selection-container label span"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
