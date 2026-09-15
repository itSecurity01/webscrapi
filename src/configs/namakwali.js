// Config for namakwali.com, built against a real product page (A2 Badri
// Cow Ghee, 1L — /products/namakwali-a2-badri-cow-ghee-1l) inspected live
// on 2026-09-15. Shopify store on the Dawn theme (v11.0.0), with Judge.me
// reviews and a third-party swatch app for the size options.
//
// The Product JSON-LD here is minimal: it carries ONLY `name` and Judge.me's
// `aggregateRating` — no offers, images, sku, brand or description — so
// scraper.js takes `name` from JSON-LD and everything else from the DOM
// selectors below. Two consequences worth knowing:
//   * `product.brand` will be null: scraper.js reads brand from JSON-LD only
//     and there is none. The vendor line ("Namakwali") is captured as
//     `additionalInfo.brandName` instead.
//   * `product.sku` will also be null for the same reason. The real SKU
//     (e.g. "NMK-GH-1000") only exists inside Dawn's <variant-radios> JSON
//     blob, so `beforeExtract` lifts it out of there and is exposed as
//     `additionalInfo.sku`.
//
// Sizes: each size is a *separate product* on this store (250ml / 500ml /
// 1L / 5L each have their own URL and price); the swatch app just links
// them together on the page. `sizes` therefore lists the whole linked
// group, and `additionalInfo.selectedSize` says which one THIS url is.
//
// Images: the gallery mixes real product photos with marketing slides
// ("Slide-1-testimonials", "Slide-2-Report", ...) — on the sampled page it
// was 1 product photo + 8 slides. That's what the store publishes; nothing
// in the markup distinguishes them, so they all come through.
module.exports = {
    name: "namakwali",

    beforeExtract: async (page) => {
        // Price/title/gallery are in the initial HTML. The swatch app renders
        // the size group client-side (it was present ~1s after
        // domcontentloaded in a polling run); wait briefly for it, but don't
        // fail the row if it never shows — sizes would just fall back to
        // Dawn's native single-variant radio.
        await page
            .waitForSelector(".swatch-view-item", { timeout: 8000, state: "attached" })
            .catch(() => {});

        // Dawn's native variant <label>s each contain a visually-hidden
        // "Variant sold out or unavailable" <span>; extractList() reads
        // textContent so it would be glued onto the size name ("6 Flavour
        // ComboVariant sold out..."). Drop those spans up front so the native
        // radios are a clean fallback for products with no swatch group.
        await page.evaluate(() => {
            document.querySelectorAll("variant-radios label .visually-hidden, variant-selects label .visually-hidden")
                .forEach(el => el.remove());
        }).catch(() => {});

        // Dawn ships the variant list as JSON inside <variant-radios>; it's
        // the only place the SKU appears. extractText() reads DOM text, so
        // surface it as a hidden element the additionalFields selector can
        // hit. Idempotent, never throws.
        await page.evaluate(() => {
            if (document.querySelector("[data-scraper-sku]")) return;
            try {
                const script = document.querySelector('variant-radios script[type="application/json"], variant-selects script[type="application/json"]');
                if (!script) return;
                const variants = JSON.parse(script.textContent);
                const first = Array.isArray(variants) ? variants[0] : null;
                if (!first || !first.sku) return;
                const el = document.createElement("div");
                el.setAttribute("data-scraper-sku", "");
                el.hidden = true;
                el.textContent = first.sku;
                document.body.appendChild(el);
            } catch {
                // malformed JSON — leave sku missing rather than break extraction
            }
        }).catch(() => {});
    },

    selectors: {
        // Confirmed: bare <h1>A2 Badri Cow Ghee, 1L</h1>. Fallback only;
        // JSON-LD carries name.
        title: ["h1"],

        // Confirmed (Dawn price block): on-sale products show the current
        // price in .price__sale .price-item--sale ("Rs. 2,800.00") with the
        // struck-through MRP beside it; products not on sale only render
        // .price__regular. Both listed so either state resolves.
        price: [
            ".price--large .price__sale .price-item--sale",
            ".price--large .price__regular .price-item--regular",
            ".price .price-item--sale",
            ".price .price-item--regular",
        ],

        // Confirmed: the store's own description block (.pdw__inner.rte).
        // Starts with a trust-badge <img> and a couple of &nbsp; paragraphs
        // before the copy — cosmetic, textContent trims them.
        description: [".pdw__inner.rte", ".product__description", ".product__description.rte"],

        // Confirmed: Dawn media gallery. Scoped to the main list (not the
        // thumbnail strip) so each media item appears once, at the large
        // srcset candidate. See header re: marketing slides.
        images: [".product__media-list .product__media-item img", ".product__media img"],

        // Confirmed: <p>250ml Jar</p> inside each swatch tile. The tile also
        // carries a price <span>, so the selector targets the <p> only. The
        // current product is listed twice on the page (group + own option)
        // and de-duplicates. Products with no linked group (e.g. the salt
        // combos) have no swatch tiles and fall through to Dawn's native
        // radio labels, cleaned up in beforeExtract.
        sizes: [".swatch-view-item p", "variant-radios .product-form__input label"],
    },

    additionalFields: {
        // Confirmed: <p class="product__text ... caption-with-letter-spacing">Namakwali</p>
        // — see header for why this isn't product.brand.
        brandName: [".product__text.caption-with-letter-spacing"],

        // Injected by beforeExtract from the variant JSON (see header).
        sku: ["[data-scraper-sku]"],

        // Confirmed: struck-through "Rs. 3,000.00" next to the sale price.
        // Absent when the product isn't on sale.
        mrp: [".price--large .price__sale s.price-item--regular", ".price s.price-item--regular"],

        // Confirmed: the swatch tile marked aria-checked="true" is this URL's
        // own size; native checked radio as the no-swatch-group fallback.
        selectedSize: ['.swatch-view-item[aria-checked="true"] p', "variant-radios input:checked + label"],

        // Confirmed: Judge.me preview badge — "4.8 (544 reviews)". The badge
        // element is display:none but its text is in the DOM. JSON-LD also
        // has aggregateRating (4.83 / 544) but scraper.js doesn't read it.
        rating: [".jdgm-prev-badge__text"],

        // Confirmed: "MRP (Incl. of all taxes)".
        taxNote: [".price__tax-note"],
    },

    parse: {
        // Dawn renders "Rs. 2,800.00" — the "Rs." prefix isn't a symbol or
        // ISO code parsePrice knows, so currency comes back null; this is an
        // Indian store, default it to INR.
        price: (raw) => {
            const parsed = require("../utils/price").parsePrice(raw);
            if (!parsed.currency && /\bRs\.?/i.test(parsed.raw || "")) parsed.currency = "INR";
            return parsed;
        },
    },
};
