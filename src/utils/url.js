/**
 * Resolve a possibly-relative URL (src, data-src, srcset entry) against the
 * page URL, and strip common tracking query params so near-duplicate CDN
 * URLs are easier to compare.
 */
function normalizeUrl(rawUrl, baseUrl) {
    if (!rawUrl) return null;

    let absolute;
    try {
        absolute = new URL(rawUrl, baseUrl).toString();
    } catch {
        return null;
    }

    try {
        const u = new URL(absolute);
        const stripParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
        stripParams.forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch {
        return absolute;
    }
}

/**
 * Pick the largest candidate out of a `srcset` string, e.g.
 * "a.jpg 480w, b.jpg 1024w" -> "b.jpg"
 */
function largestFromSrcset(srcset) {
    if (!srcset) return null;
    const candidates = srcset.split(",").map(entry => entry.trim()).filter(Boolean);
    if (candidates.length === 0) return null;

    let best = null;
    let bestWidth = -1;
    for (const candidate of candidates) {
        const [url, size] = candidate.split(/\s+/);
        const width = size && size.endsWith("w") ? parseInt(size, 10) : 0;
        if (width >= bestWidth) {
            bestWidth = width;
            best = url;
        }
    }
    return best;
}

function getHostname(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
}

module.exports = { normalizeUrl, largestFromSrcset, getHostname };
