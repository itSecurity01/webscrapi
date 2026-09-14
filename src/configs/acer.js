// Config for acer.com, built against a real product page (Aspire TC
// TC-1775-UR11, /us-en/desktops-and-all-in-ones/aspire-classic-desktops/
// aspire-tc/pdp/DT.BLRAA.001) supplied by the user on 2026-09-14.
//
// CONFIRMED from the supplied markup: acer.com emits real schema.org
// Product JSON-LD (name/image/description/brand/sku/offers) — scraper.js
// tries this before any DOM selector below, so name/brand/sku/price/
// currency should all come from `trace.*.source === "json-ld"` on a live
// run. Two JSON-LD gaps confirmed from this exact product: `description` is
// a genuinely empty string (falls through to DOM — see `description`
// selectors below, best-effort only, nothing confirmed), and `image` only
// ever lists ONE photo even though the page's Scene7 viewer has a full
// 6-shot gallery — see the big beforeExtract fix below for that.
//
// KNOWN GOTCHA (confirmed from the supplied markup): the product gallery is
// an Adobe Scene7 "MixedMediaViewer" widget. Its thumbnail strip
// (#mixedmedia_swatches_listbox) is NOT <img> tags at all — each thumbnail
// is a plain <div class="s7thumb"> with the photo set as an inline CSS
// `background-image: url(...)`. scraper.js's extractImages() only ever
// reads <img> src/srcset/dataset attributes, so it can't see these no
// matter what selector is used, and the JSON-LD `image` array only has the
// single default shot. `beforeExtract` below reads each thumbnail's
// `aria-label` (which is literally the Scene7 asset name, e.g.
// "acer-aspire-tc-1775-sd-odd-01" — confirmed against the supplied markup),
// rebuilds full-size Scene7 image-server URLs from those names, and patches
// them straight into the existing Product JSON-LD's `image` array (same
// "patch JSON-LD in place" technique as muscleblaze.js in this repo) — so
// scraper.js's normal JSON-LD-first image extraction picks up the full
// gallery with no DOM `images` selector even needing to run. The Scene7
// widget builds this thumbnail strip via its own async JS after page load
// (confirmed: it's not present in a raw HTML fetch, only after
// MixedMediaViewer.js runs), so beforeExtract waits for at least one
// thumbnail before patching — non-fatal if that widget ever fails to load;
// extraction then just falls back to JSON-LD's single stock photo.
//
// The full tech-spec table (Processor/Memory/Storage/Display/Network/IO/
// Power/Physical/Misc) sits in a tab panel with class `agw-d-none`
// (display:none until the "Specifications" tab is clicked) — confirmed this
// does NOT block extraction: scraper.js's extractText()/extractList() only
// ever check `element.count() > 0` and read `textContent`, neither of which
// cares about CSS visibility, so the hidden tab's content is still fully
// readable without ever clicking it.
module.exports = {
    name: "acer",

    beforeExtract: async (page) => {
        // Wait for real product content before extracting.
        await page
            .waitForSelector(["h1[data-product-name]", ".pdpv__container"].join(", "), {
                timeout: 15000,
                state: "attached",
            })
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

        // See the big module comment above for *why* this exists. Give the
        // Scene7 viewer's own async JS a real chance to build the thumbnail
        // strip before giving up (it's a third-party widget, not part of
        // the page's own server-rendered HTML).
        await page
            .waitForSelector("#mixedmedia_swatches_listbox .s7thumbcell[aria-label]", { timeout: 10000 })
            .catch(() => {});

        await page.evaluate(() => {
            try {
                const assetNames = new Set();
                document.querySelectorAll("#mixedmedia_swatches_listbox .s7thumbcell[aria-label]").forEach(el => {
                    const label = el.getAttribute("aria-label");
                    if (label) assetNames.add(label);
                });
                if (assetNames.size === 0) return; // no gallery found — JSON-LD's single image stands as-is

                // Scene7's dynamic-imaging URL scheme: dropping the
                // size-constraint query params (wid/hei/fit, only used for
                // the 56x56 thumbnail render) against the same
                // /is/image/acer/<asset-name> path serves the full-size
                // original — same domain/path already visible in the
                // supplied markup's thumbnail background-image URLs.
                const urls = [...assetNames].map(name => `https://images.acer.com/is/image/acer/${name}?fmt=jpg`);

                for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                    try {
                        const data = JSON.parse(script.textContent);
                        const nodes = Array.isArray(data) ? data : Array.isArray(data["@graph"]) ? data["@graph"] : [data];
                        const product = nodes.find(
                            n => n && (n["@type"] === "Product" || (Array.isArray(n["@type"]) && n["@type"].includes("Product")))
                        );
                        if (product) {
                            product.image = urls;
                            script.textContent = JSON.stringify(data);
                            break;
                        }
                    } catch {
                        // Not JSON, or not this block — try the next <script>.
                    }
                }
            } catch {
                // Swallow — falls through to JSON-LD's original single image.
            }
        });
    },

    selectors: {
        // Confirmed, but only as the fallback path — JSON-LD supplies
        // `name` first (see module comment). <h1 data-product-name="...">
        // holds the short marketing name ("Aspire TC"), NOT the full
        // model/part string — that's captured separately below as
        // additionalFields.modelAndPart since it describes the specific
        // configuration, not the product line name.
        title: ["h1[data-product-name]", "h1"],

        // Not confirmed as an actual hit (JSON-LD supplies price on this
        // page — see module comment), kept as the fallback path only. No
        // DOM price node was visible anywhere in the supplied markup (the
        // price is presumably rendered from the same data JSON-LD already
        // carries, with no separate visible DOM price element on this
        // particular page layout) — these are generic last-resort guesses.
        price: ['[itemprop="price"]', '[data-price]', ".price"],

        // NOT confirmed — no dedicated single "product description" block
        // was visible in the supplied markup (JSON-LD's own `description`
        // is a genuine empty string on this product — see module comment).
        // The closest thing on the page is the 3 marketing highlight tiles
        // ("Get a fresh perspective" / "Versatile User Power" / "Ultimate
        // Speed") captured separately below as additionalFields.highlights
        // instead of guessed into this field, since they're closer to
        // feature callouts than a real description. Left empty rather than
        // guessing wrong.
        description: [],

        // Not used in practice — see the beforeExtract module comment
        // above: the real gallery is patched directly into JSON-LD's
        // `image` array before extraction runs, so scraper.js's
        // JSON-LD-first image logic picks up the full set and this DOM
        // selector path is only a fallback for if that patch ever fails
        // (e.g. Scene7 widget doesn't load in time). `.s7thumb` itself
        // can't be used here even as a fallback (they're CSS
        // background-image divs, not <img> tags — extractImages() can't
        // read them), so this just re-lists the one JSON-LD default photo
        // via its raw src.
        images: ['#mixedmedia img[src]', ".pdpv__container img[src]"],

        // NOT present in the supplied markup — no size/color-swatch picker
        // exists on this PDP layout (a desktop tower has no such variant
        // dimension; the Scene7 "color swatches" component in the markup
        // is present but empty/unused — `display: none` and zero rendered
        // swatch children). Both omitted rather than guessed; they'll
        // correctly come back as empty arrays with a "missing" trace.
    },

    additionalFields: {
        // Confirmed: "Model: TC-1775-UR11 / Part: DT.BLRAA.001" — both
        // lines share one <p> separated only by a <br>, with no sub-element
        // to split them apart, so this comes back as one raw combined
        // string (internal whitespace/newlines intact) rather than two
        // separate fields. `sku` (top-level) already gets the clean part
        // number from JSON-LD — this is kept for the model number, which
        // JSON-LD does NOT carry anywhere.
        modelAndPart: ["p.agw-fs-body-m.agw-mb-150"],

        // Confirmed: the 3 marketing highlight tiles' body text (e.g. "Get
        // a fresh perspective" / "Boost your daily performance..."). See
        // the `description` selector comment above for why these live here
        // instead. Scoped to the row directly below the JSON-LD <script> so
        // it doesn't also pick up unrelated body copy further down the
        // page.
        highlights: { selectors: [".agw-row-cols-md-3 .agw-fs-body-m"], multiple: true },

        // Confirmed: the full tech-spec table — each row is a <th> label /
        // <td><p> value pair with no product-specific ID/class to hook, so
        // each is found via Playwright's `:text-is()` EXACT-match
        // pseudo-class on the literal label text (these are Acer's own
        // spec-sheet field names, standardized across their PDP template)
        // paired with the value via the adjacent-sibling `+` combinator —
        // same technique as hamaramall.js's Highlights table in this repo.
        // A future product missing a given spec row (e.g. no discrete GPU)
        // just comes back null for that field, not fatal.
        operatingSystem: ['th:text-is("Operating System") + td p'],
        processorManufacturer: ['th:text-is("Processor Manufacturer") + td p'],
        processorType: ['th:text-is("Processor Type") + td p'],
        processorModel: ['th:text-is("Processor Model") + td p'],
        processorCores: ['th:text-is("Processor Core") + td p'],
        maxTurboSpeed: ['th:text-is("Maximum Turbo Speed") + td p'],
        memoryStandard: ['th:text-is("Standard Memory") + td p'],
        memoryMax: ['th:text-is("Maximum Memory Supported") + td p'],
        memoryTechnology: ['th:text-is("Memory Technology") + td p'],
        storageCapacity: ['th:text-is("Total Solid State Drive Capacity") + td p'],
        storageInterface: ['th:text-is("Solid State Drive Interface") + td p'],
        graphicsManufacturer: ['th:text-is("Graphics Controller Manufacturer") + td p'],
        graphicsModel: ['th:text-is("Graphics Controller Model") + td p'],
        totalUsbPorts: ['th:text-is("Total Number of USB Ports") + td p'],
        powerSupplyWattage: ['th:text-is("Maximum Power Supply Wattage") + td p'],
        dimensionHeight: ['th:text-is("Height") + td p'],
        dimensionWidth: ['th:text-is("Width") + td p'],
        dimensionDepth: ['th:text-is("Depth") + td p'],

        // Confirmed: 3 separate <p> lines inside one value cell ("Aspire
        // TC-1775-UR11 Desktop Computer" / "Wired Keyboard" / "Wired
        // Mouse") — `multiple: true` collects all of them, not just the
        // first.
        packageContents: { selectors: ['th:text-is("Package Contents") + td p'], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
