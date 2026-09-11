const fs = require("fs");
const path = require("path");

/**
 * Turn a product name into a filesystem-safe, Windows-path-length-aware slug.
 */
function slugify(name, maxLength = 80) {
    let slug = String(name || "untitled")
        .trim()
        .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") // strip Windows-illegal characters
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();

    if (!slug) slug = "untitled";
    if (slug.length > maxLength) slug = slug.slice(0, maxLength).replace(/-+$/g, "");

    return slug;
}

/**
 * Given a desired folder path, return a path that doesn't collide with an
 * existing folder that belongs to a *different* product (appends -2, -3, ...).
 * If the folder already exists AND already belongs to the same source URL
 * (tracked via a marker file), the same path is reused so re-runs don't pile
 * up "-2", "-3" copies of the same product.
 */
function resolveUniqueFolder(basePath, sourceUrl) {
    const markerName = ".source-url";

    function ownedBySameUrl(folder) {
        const markerPath = path.join(folder, markerName);
        if (!fs.existsSync(markerPath)) return false;
        try {
            return fs.readFileSync(markerPath, "utf8").trim() === sourceUrl;
        } catch {
            return false;
        }
    }

    let candidate = basePath;
    let n = 2;
    while (fs.existsSync(candidate) && !ownedBySameUrl(candidate)) {
        candidate = `${basePath}-${n}`;
        n++;
    }

    fs.mkdirSync(candidate, { recursive: true });
    if (sourceUrl) {
        fs.writeFileSync(path.join(candidate, markerName), sourceUrl, "utf8");
    }

    return candidate;
}

module.exports = { slugify, resolveUniqueFolder };
