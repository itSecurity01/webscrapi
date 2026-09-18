const boat = require("./configs/boat");
const levis = require("./configs/levis");
const hm = require("./configs/hm");
const shopsy = require("./configs/shopsy");
const tatacliq = require("./configs/tatacliq");
const wishluck = require("./configs/wishluck");
const muscleblaze = require("./configs/muscleblaze");
const booksToScrapeDemo = require("./configs/booksToScrapeDemo");
const hamaramall = require("./configs/hamaramall");
const asus = require("./configs/asus");
const acer = require("./configs/acer");
const oppo = require("./configs/oppo");
const nykaafashion = require("./configs/nykaafashion");
const moglix = require("./configs/moglix");
const milton = require("./configs/milton");
const lenovo = require("./configs/lenovo");
const dotandkey = require("./configs/dotandkey");
const controlz = require("./configs/controlz");
const sangeetha = require("./configs/sangeetha");
const digihaat = require("./configs/digihaat");
const plumgoodness = require("./configs/plumgoodness");
const bellavita = require("./configs/bellavita");
const firstcry = require("./configs/firstcry");
const namakwali = require("./configs/namakwali");
const nykaa = require("./configs/nykaa");
const adventuras = require('./configs/adventuras')
const letstryfoods = require("./configs/letstryfoods");
const floweraura = require("./configs/floweraura");
const hyugalife = require("./configs/hyugalife");
const agaro = require("./configs/agaro");
const columbia = require("./configs/columbia");
const pepperfry = require('./configs/pepperfry')
const zebronics = require('./configs/zebronics')
const vijaysales = require("./configs/vijaysales")

// Adding a new website = one new config file + one new entry here.
// Nothing in domainRouter.js or scraper.js should ever need to change.
module.exports = [
    { test: (hostname) => hostname.includes("adventuras.in"), config: adventuras },
    { test: (hostname) => hostname.includes("boat"), config: boat },
    { test: (hostname) => hostname.includes("levi"), config: levis },
    { test: (hostname) => hostname.includes("hm.com"), config: hm },
    { test: (hostname) => hostname.includes("shopsy"), config: shopsy },
    { test: (hostname) => hostname.includes("tatacliq"), config: tatacliq },
    { test: (hostname) => hostname.includes("wishluck"), config: wishluck },
    { test: (hostname) => hostname.includes("muscleblaze"), config: muscleblaze },
    { test: (hostname) => hostname.includes("books.toscrape.com"), config: booksToScrapeDemo },
    { test: (hostname) => hostname.includes("hamaramall"), config: hamaramall },
    { test: (hostname) => hostname.includes("asus"), config: asus },
    { test: (hostname) => hostname.includes("acer.com"), config: acer },
    { test: (hostname) => hostname.includes("oppo.com"), config: oppo },
    { test: (hostname) => hostname.includes("nykaafashion"), config: nykaafashion },
    { test: (hostname) => hostname.includes("moglix"), config: moglix },
    { test: (hostname) => hostname.includes("milton.in"), config: milton },
    { test: (hostname) => hostname.includes("lenovo.com"), config: lenovo },
    { test: (hostname) => hostname.includes("dotandkey.com"), config: dotandkey },
    { test: (hostname) => hostname.includes("controlz.world"), config: controlz },
    { test: (hostname) => hostname.includes("sangeetha.com"), config: sangeetha },
    { test: (hostname) => hostname.includes("digihaat.in"), config: digihaat },
    { test: (hostname) => hostname.includes("plumgoodness.com"), config: plumgoodness },
    { test: (hostname) => hostname.includes("bellavitaorganic.com"), config: bellavita },
    { test: (hostname) => hostname.includes("firstcry"), config: firstcry },
    { test: (hostname) => hostname.includes("namakwali"), config: namakwali },
    // Must stay AFTER the "nykaafashion" entry above — nykaafashion.com's
    // hostname also contains "nykaa", so ordering (registry.find() takes
    // the first match) is what keeps that site on its own config instead
    // of falling into this one.
    { test: (hostname) => hostname.includes("nykaa"), config: nykaa },
    { test: (hostname) => hostname.includes("letstryfoods.com"), config: letstryfoods },
    { test: (hostname) => hostname.includes("floweraura.com"), config: floweraura },
    { test: (hostname) => hostname.includes("hyugalife.com"), config: hyugalife },
    { test: (hostname) => hostname.includes("agarolifestyle.com"), config: agaro },
    { test: (hostname) => hostname.includes("columbiasportswear.co.in"), config: columbia },
    { test: (hostname) => hostname.includes("pepperfry.com"), config: pepperfry },
    { test: (hostname) => hostname.includes("shop.zebronics.com"), config: zebronics },
    { test: (hostname) => hostname.includes("vijaysales.com"), config: vijaysales },
];
