const boat = require("./configs/boat");
const levis = require("./configs/levis");
const hm = require("./configs/hm");
const shopsy = require("./configs/shopsy");
const tatacliq = require("./configs/tatacliq");
const booksToScrapeDemo = require("./configs/booksToScrapeDemo");

// Adding a new website = one new config file + one new entry here.
// Nothing in domainRouter.js or scraper.js should ever need to change.
module.exports = [
    { test: (hostname) => hostname.includes("boat"), config: boat },
    { test: (hostname) => hostname.includes("levi"), config: levis },
    { test: (hostname) => hostname.includes("hm.com"), config: hm },
    { test: (hostname) => hostname.includes("shopsy"), config: shopsy },
    { test: (hostname) => hostname.includes("tatacliq"), config: tatacliq },
    { test: (hostname) => hostname.includes("books.toscrape.com"), config: booksToScrapeDemo },
];
