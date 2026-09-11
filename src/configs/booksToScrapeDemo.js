// Demo/test config for books.toscrape.com — a public sandbox site built
// specifically for practicing scrapers ("We love being scraped!"). It has no
// JSON-LD, so this config exercises the pure-DOM fallback path end-to-end.
// Use it to verify the engine (extraction, image download, folder creation,
// trace, validation) works before pointing real configs at real store pages.
module.exports = {
    name: "books-demo",

    selectors: {
        title: ["h1"],
        price: [".product_main .price_color", ".price_color"],
        description: ["#product_description + p"],
        images: ["#product_gallery img"],
        // books.toscrape.com has no size/color variants — sizes/colors
        // selectors are simply omitted, which is fine: they'll show up in
        // product.json as empty arrays with trace source "missing".
    },

    // Demonstrates the additionalFields mechanism against real markup:
    // single value ("availability") and multi-value ("specRows").
    additionalFields: {
        availability: [".availability"],
        specRows: { selectors: [".table.table-striped tr"], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
