/**
 * Retroactively strips known junk-asset images (star.png, mask.png, menu
 * icons, payment badges, ... — see utils/imageFilter.js) out of products
 * that ALREADY have an upload.json draft — drafted or already reviewed.
 *
 * Re-running `node src/transformCli.js --force` would also apply the same
 * filter, but it fully regenerates upload.json from product.json, which
 * blows away anything a reviewer already edited (program/gender/
 * vendorComment/status/...). This script instead only touches `image`/
 * `subImages` on the existing draft, via dataStore.updateDraft() (which
 * only ever writes EDITABLE_FIELDS), leaving every other field and the
 * review status exactly as it was.
 *
 * Usage:
 *   node src/cleanJunkImages.js               (applies to every product)
 *   node src/cleanJunkImages.js --dry-run      (report only, writes nothing)
 *   node src/cleanJunkImages.js --site=boat    (limit to one site)
 */
const store = require("./reviewServer/dataStore");
const { filterProductImages } = require("./utils/imageFilter");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { site: null, dryRun: false };
    for (const arg of argv) {
        if (arg.startsWith("--site=")) args.site = arg.split("=")[1];
        else if (arg === "--dry-run") args.dryRun = true;
    }
    return args;
}

/**
 * Core of this script, factored out the same way runTransform()/
 * findDuplicates() are in this repo, so it stays testable/reusable without
 * needing to shell out. Pure aside from the (optional) writes it makes via
 * dataStore.updateDraft().
 *
 * @returns {{ checked:number, changed:number, removed: {site:string, slug:string, name:string, removedUrls:string[]}[] }}
 */
function cleanJunkImages({ site = null, dryRun = false } = {}) {
    const drafts = store.listDrafts({ site });
    let changed = 0;
    const removed = [];

    for (const draft of drafts) {
        const { site: s, slug } = draft._meta;
        const before = [draft.image, ...(draft.subImages || [])].filter(Boolean);
        const after = filterProductImages(before);

        if (after.length === before.length) continue; // nothing to do

        const removedUrls = before.filter(url => !after.includes(url));
        removed.push({ site: s, slug, name: draft.name, removedUrls });
        changed++;

        if (!dryRun) {
            store.updateDraft(s, slug, { image: after[0] || "", subImages: after.slice(1) });
        }
    }

    return { checked: drafts.length, changed, removed };
}

function main() {
    const args = parseArgs();
    const result = cleanJunkImages(args);

    console.log(`Checked ${result.checked} product(s)${args.site ? ` (site=${args.site})` : ""}.`);
    if (result.removed.length === 0) {
        console.log("No junk images found — nothing to change.");
        return;
    }

    result.removed.forEach(({ site, slug, name, removedUrls }) => {
        console.log(`${args.dryRun ? "[dry-run] would clean" : "✓ cleaned"} ${site}/${slug} (${name || "unnamed"}):`);
        removedUrls.forEach(url => console.log(`    - ${url}`));
    });

    console.log(`\n${args.dryRun ? "Would change" : "Changed"} ${result.changed}/${result.checked} product(s).`);
    if (args.dryRun) console.log("(dry run — nothing was written; drop --dry-run to apply.)");
}

if (require.main === module) main();

module.exports = { cleanJunkImages };
