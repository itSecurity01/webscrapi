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

module.exports = {
    OUTPUT_DIR,
    EDITABLE_FIELDS,
    readDraft,
    writeDraft,
    listDrafts,
    listLocalImages,
    updateDraft,
    bulkUpdate,
    folderPath,
    resolveImageUrls,
};
