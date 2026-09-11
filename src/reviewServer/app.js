const path = require("path");
const express = require("express");

const store = require("./dataStore");
const { dashboardView } = require("./views/dashboard");
const { productView } = require("./views/productView");

function splitList(raw) {
    return String(raw || "")
        .split(/[,\n]/)
        .map(s => s.trim().replace(/^["']+|["']+$/g, "")) // strip stray quotes
        // left over from pasting *inside* a JSON array literal, e.g. an id
        // copied as `a", "b", "c` (see toCampaignDocument.js's sanitizeId
        // for the full story) — this stops it at entry instead of relying
        // on the transform step to clean it up later.
        .map(s => s.trim())
        .filter(Boolean);
}

function parseNum(raw, fallback) {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
}

function createApp() {
    const app = express();
    app.use(express.urlencoded({ extended: false }));

    // Serves downloaded product images for preview. Path segments are
    // per-parameter (not a glob), and resolved paths are checked to stay
    // inside OUTPUT_DIR, so this can't be used to walk outside output/.
    app.get("/media/:site/:slug/:filename", (req, res) => {
        const { site, slug, filename } = req.params;
        const filePath = path.join(store.OUTPUT_DIR, site, slug, filename);
        const relative = path.relative(store.OUTPUT_DIR, filePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            return res.status(400).end();
        }
        res.sendFile(filePath, err => {
            if (err) res.status(404).end();
        });
    });

    app.get("/", (req, res) => {
        const drafts = store.listDrafts({ site: req.query.site || null });
        const resolveThumb = (draft) => {
            const urls = store.resolveImageUrls(draft._meta.site, draft._meta.slug, draft);
            return urls[0] || "";
        };
        const notice = req.query.bulkError === "no-selection"
            ? { type: "error", text: "Nothing was changed — tick the checkbox next to at least one product before clicking Apply." }
            : req.query.bulkApplied
                ? { type: "ok", text: `Applied to ${req.query.bulkApplied} product(s).` }
                : null;
        res.send(dashboardView(drafts, resolveThumb, notice));
    });

    app.get("/product/:site/:slug", (req, res) => {
        const { site, slug } = req.params;
        const draft = store.readDraft(site, slug);
        if (!draft) return res.status(404).send(`No upload.json for ${site}/${slug}. Run "npm run transform" first.`);

        const imageUrls = store.resolveImageUrls(site, slug, draft);
        res.send(productView(draft, imageUrls, { saved: req.query.saved === "1" }));
    });

    app.post("/product/:site/:slug", (req, res) => {
        const { site, slug } = req.params;
        const body = req.body;

        const updates = {
            name: body.name,
            vendorSku: body.vendorSku,
            productPrice: parseNum(body.productPrice, 0),
            mrp: parseNum(body.mrp, 0),
            discount: parseNum(body.discount, 0),
            rating: parseNum(body.rating, 0),
            program: body.program || "",
            gender: body.gender || "",
            categories: splitList(body.categories),
            productSizes: splitList(body.productSizes),
            colour: splitList(body.colour),
            vendorComment: body.vendorComment || "",
            productDescription: body.productDescription || "",
            additionalInformation: body.additionalInformation || "",
            image: body.image || "",
            subImages: splitList(body.subImages),
        };

        const status = body.markReviewed === "1" ? "reviewed" : "draft";

        try {
            store.updateDraft(site, slug, updates, { status });
            res.redirect(`/product/${encodeURIComponent(site)}/${encodeURIComponent(slug)}?saved=1`);
        } catch (error) {
            res.status(400).send(`Save failed: ${error.message}`);
        }
    });

    app.post("/bulk-apply", (req, res) => {
        const body = req.body;
        const selected = [].concat(body.selected || []).filter(Boolean);

        if (selected.length === 0) {
            return res.redirect("/?bulkError=no-selection");
        }

        const items = selected.map(key => {
            const [site, slug] = key.split("::");
            return { site, slug };
        });

        const updates = {};
        if (body.program) updates.program = body.program;
        if (body.gender) updates.gender = body.gender;
        if (body.categories) updates.categories = splitList(body.categories);

        const status = body.markReviewed === "1" ? "reviewed" : undefined;

        store.bulkUpdate(items, updates, { status });
        res.redirect(`/?bulkApplied=${items.length}`);
    });

    return app;
}

module.exports = { createApp };
