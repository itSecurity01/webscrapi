/**
 * Filters out non-product "junk" images that broad image selectors or a
 * site's own JSON-LD gallery sometimes sweep up alongside real product
 * photos — decorative UI assets like star.png (rating widgets), mask.png
 * (image-crop masks), menu/cart/search icons, payment badges, social-share
 * icons, etc. None of that belongs in a product's photo gallery.
 *
 * Matches against the URL's filename only (basename, query string
 * stripped), never the full URL — a legitimate CDN host or path segment
 * that happens to contain one of these words (e.g. a "/logos-collection/"
 * folder) shouldn't false-positive a real product photo.
 *
 * Two tiers, because a handful of these words are also completely normal
 * product nouns:
 *  - UNAMBIGUOUS words (icon, sprite, spinner, payment/social brand names,
 *    ...) are matched anywhere a filename uses them as a distinct token
 *    (boundary-anchored — "closet.jpg" is safe, "close-icon.jpg" isn't).
 *  - AMBIGUOUS words (star, mask, badge, logo, sparkle, arrow — all real
 *    jewelry/apparel/accessory product nouns too) are matched ONLY when
 *    the word (plus an optional trailing number) is the *entire* filename
 *    — i.e. "star.png"/"mask-2.jpg" are junk, but "star-earrings.jpg" and
 *    "red-mask-costume.jpg" are left alone as the real products they are.
 */

// Matched anywhere in the filename as a distinct token — see module
// comment. Extend via the IMAGE_JUNK_PATTERNS env var (comma-separated,
// merged in below) instead of editing this file for a one-off site.
const UNAMBIGUOUS_WORDS = [
    "watermark", "placeholder", "blank", "transparent", "pixel",
    "icon", "sprite", "spinner", "loader", "loading", "favicon",
    "swatch", "chevron", "hamburger", "menu", "close", "search", "cart", "wishlist",
    "zoom", "magnify", "magnifying",
    "visa", "mastercard", "paypal", "razorpay", "rupay", "upi",
    "facebook", "twitter", "instagram", "pinterest", "whatsapp", "youtube",
];

// Only flagged when they make up the *whole* filename (optionally with a
// trailing number, e.g. "star-2.png") — real products are commonly named
// with these words too (a star pendant, a costume mask, a logo-print tee),
// so a bare substring match would wrongly strip real product photos.
const WHOLE_FILENAME_ONLY_WORDS = ["star", "sparkle", "mask", "arrow", "badge", "logo"];

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readEnvExtras() {
    return String(process.env.IMAGE_JUNK_PATTERNS || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

function buildPatterns() {
    const unambiguous = [...UNAMBIGUOUS_WORDS, ...readEnvExtras()].map(escapeRegExp);
    // (^|[/_.-]) — start of filename, or right after a path/word separator
    // — then the word, then either another separator/digit or the end of
    // the filename. Keeps e.g. "closet.jpg" from matching "close".
    const anywhere = new RegExp(`(^|[/_.\\-])(${unambiguous.join("|")})([/_.\\-]|\\d|$)`, "i");

    const wholeStem = WHOLE_FILENAME_ONLY_WORDS.map(escapeRegExp);
    const whole = new RegExp(`^(${wholeStem.join("|")})[-_]?\\d*$`, "i");

    return { anywhere, whole };
}

const PATTERNS = buildPatterns();

/** Basename of a URL's path, without the query string — e.g.
 * "https://cdn.example.com/img/star.png?v=2" -> "star.png". */
function basename(url) {
    let clean;
    try {
        clean = new URL(url).pathname;
    } catch {
        // Not a parseable absolute URL — fall back to the raw string so a
        // relative path still gets checked instead of silently passing.
        clean = String(url || "").split(/[?#]/)[0];
    }
    return clean.slice(clean.lastIndexOf("/") + 1);
}

function stripExtension(filename) {
    const dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(0, dot) : filename;
}

function isJunkImageUrl(url) {
    if (!url) return false;
    const name = basename(url);
    if (PATTERNS.anywhere.test(name)) return true;
    return PATTERNS.whole.test(stripExtension(name));
}

/** Drops junk-asset URLs from a list, preserving order. */
function filterProductImages(urls) {
    return (urls || []).filter(url => !isJunkImageUrl(url));
}

module.exports = { isJunkImageUrl, filterProductImages };
