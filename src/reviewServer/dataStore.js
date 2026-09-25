/**
 * Filesystem-backed data access for the review server. Every "record" is
 * just the upload.json draft sitting next to a scraped product.json —
 * there's no database, so reads/writes go straight to disk.
 */
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(process.cwd(), "output");
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

// Fields the review UI is allowed to write. Keeps a stray/renamed field in a
// POST body from silently corrupting the upload-schema shape.
const EDITABLE_FIELDS = [
    "name", "mrp", "productPrice", "rating", "discount", "vendorComment",
    "program", "gender", "productDescription", "additionalInformation",
    "vendorSku", "categories", "productSizes", "colour",
    "image", "subImages",
];

function draftPath(site, slug) {
    return path.join(OUTPUT_DIR, site, slug, "upload.json");
}

function folderPath(site, slug) {
    return path.join(OUTPUT_DIR, site, slug);
}

function readDraft(site, slug) {
    const filePath = draftPath(site, slug);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/** Raw product.json sitting next to upload.json — the download manifest
 * (images[].url/.path/.success) that resolveImageEntries() below uses to
 * find a local cached copy of a remote image URL. `null` if missing. */
function readProductJson(site, slug) {
    const filePath = path.join(folderPath(site, slug), "product.json");
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

function writeDraft(site, slug, draft) {
    fs.writeFileSync(draftPath(site, slug), JSON.stringify(draft, null, 2), "utf8");
}

/** Lists every product that has an upload.json draft, optionally filtered by site. */
function listDrafts({ site } = {}) {
    if (!fs.existsSync(OUTPUT_DIR)) return [];

    const siteDirs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(s => !site || s === site);

    const drafts = [];
    for (const s of siteDirs) {
        const siteDir = path.join(OUTPUT_DIR, s);
        const slugDirs = fs.readdirSync(siteDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const slug of slugDirs) {
            const draft = readDraft(s, slug);
            if (draft) drafts.push(draft);
        }
    }

    return drafts.sort((a, b) => (a._meta.site + a._meta.slug).localeCompare(b._meta.site + b._meta.slug));
}

/** Local image filenames present on disk for a product (empty if --skip-images was used). */
function listLocalImages(site, slug) {
    const folder = folderPath(site, slug);
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder)
        .filter(name => IMAGE_EXT_RE.test(name))
        .sort();
}

/** Merges `updates` (only EDITABLE_FIELDS) into one draft, bumps status/updatedAt. */
function updateDraft(site, slug, updates, { status } = {}) {
    const draft = readDraft(site, slug);
    if (!draft) throw new Error(`No upload.json for ${site}/${slug} — run the transform step first`);

    for (const field of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(updates, field)) {
            draft[field] = updates[field];
        }
    }

    draft._meta.updatedAt = new Date().toISOString();
    if (status) draft._meta.status = status;

    writeDraft(site, slug, draft);
    return draft;
}

/** Applies the same partial updates to many products at once (the dashboard's bulk-apply). */
function bulkUpdate(items, updates, { status } = {}) {
    const results = [];
    for (const { site, slug } of items) {
        try {
            results.push({ site, slug, ok: true, draft: updateDraft(site, slug, updates, { status }) });
        } catch (error) {
            results.push({ site, slug, ok: false, error: error.message });
        }
    }
    return results;
}

/**
 * Permanently deletes a product's entire output folder (product.json,
 * upload.json, downloaded images, screenshot). Used from the review
 * dashboard to drop products the source site has since delisted — the
 * scraper has no way to know a URL went dead, so this is the manual escape
 * hatch. Returns false (no-op) if the folder was already gone.
 */
function deleteDraft(site, slug) {
    const folder = folderPath(site, slug);

    // site/slug come straight from URL params — guard against a crafted
    // "../.." segment walking the delete outside output/, same check the
    // /media route already applies to read paths.
    const relative = path.relative(OUTPUT_DIR, folder);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Invalid site/slug");
    }

    if (!fs.existsSync(folder)) return false;
    fs.rmSync(folder, { recursive: true, force: true });
    return true;
}

/** Deletes many products' output folders at once (the dashboard's bulk-delete). */
function bulkDelete(items) {
    const results = [];
    for (const { site, slug } of items) {
        try {
            results.push({ site, slug, ok: true, removed: deleteDraft(site, slug) });
        } catch (error) {
            results.push({ site, slug, ok: false, error: error.message });
        }
    }
    return results;
}

/**
 * Preview image URLs for a product: local files served through /media if
 * they were downloaded, otherwise the remote CDN URLs stored on the draft
 * itself (e.g. when the scrape ran with --skip-images).
 */
function resolveImageUrls(site, slug, draft) {
    const local = listLocalImages(site, slug);
    if (local.length > 0) {
        return local.map(name => `/media/${encodeURIComponent(site)}/${encodeURIComponent(slug)}/${encodeURIComponent(name)}`);
    }
    return [draft.image, ...(draft.subImages || [])].filter(Boolean);
}

/**
 * Editable gallery for the product page: `draft.image`/`draft.subImages`
 * (in that order) are the actual export source of truth — what a reviewer
 * removes or reorders here is what ends up in the upload payload — so
 * unlike resolveImageUrls() above (which just lists whatever's on disk,
 * for the dashboard's read-only thumbnail), this builds its list FROM
 * those two fields and only uses the local download as a nicer `displayUrl`
 * when one exists, via product.json's own url->path manifest. Falls back to
 * hotlinking the original url when there's no local copy (e.g.
 * --skip-images, or a URL a reviewer pasted in by hand).
 *
 * Returns [{ url, displayUrl }], one per image, in draft order.
 */
function resolveImageEntries(site, slug, draft) {
    const orderedUrls = [draft.image, ...(draft.subImages || [])].filter(Boolean);
    if (orderedUrls.length === 0) return [];

    const productJson = readProductJson(site, slug);
    const localPathByUrl = new Map();
    if (productJson && Array.isArray(productJson.images)) {
        for (const img of productJson.images) {
            if (img && img.url && img.success && img.path) {
                localPathByUrl.set(img.url, img.path);
            }
        }
    }

    return orderedUrls.map(url => {
        const localPath = localPathByUrl.get(url);
        const displayUrl = localPath
            ? `/media/${encodeURIComponent(site)}/${encodeURIComponent(slug)}/${encodeURIComponent(path.basename(localPath))}`
            : url;
        return { url, displayUrl };
    });
}

module.exports = {
    OUTPUT_DIR,
    EDITABLE_FIELDS,
    readDraft,
    readProductJson,
    writeDraft,
    listDrafts,
    listLocalImages,
    updateDraft,
    bulkUpdate,
    deleteDraft,
    bulkDelete,
    folderPath,
    resolveImageUrls,
    resolveImageEntries,
};
