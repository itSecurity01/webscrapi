const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const store = require("./dataStore");
const scrapeRunner = require("./scrapeRunner");
const pipelineState = require("./pipelineState");
const { dashboardView } = require("./views/dashboard");
const { productView } = require("./views/productView");
const { batchView } = require("./views/batchView");
const { exportResultView } = require("./views/exportResultView");
const { readExcel } = require("../excelReader");
const { inspectWorkbook, collectRows, writeInputWorkbook } = require("../excelNormalizer");
const { findDuplicates } = require("../checkDuplicates");
const { RunState } = require("../runState");
const { exportForMongo } = require("../exportForMongo");
const { markUploaded } = require("../markUploaded");
const { archiveBatch } = require("../archiveBatch");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const INPUT_XLSX_PATH = path.join(PROJECT_ROOT, "input", "products.xlsx");
// The workbook exactly as uploaded — kept so the user can go back and pick a
// different sheet without re-uploading. input/products.xlsx is generated from it.
const SOURCE_XLSX_PATH = path.join(PROJECT_ROOT, "input", "source.xlsx");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/** Turns a user-typed download name into a safe "<name><ext>" filename. */
function downloadName(raw, fallback, ext) {
    let name = String(raw || "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ");
    if (name.toLowerCase().endsWith(ext)) name = name.slice(0, -ext.length);
    return `${name || fallback}${ext}`;
}

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
                : req.query.marked
                    ? { type: "ok", text: `Marked ${req.query.marked} product(s) as uploaded.${req.query.markFailed > 0 ? ` (${req.query.markFailed} failed — see terminal/logs.)` : ""}` }
                    : req.query.markError
                        ? { type: "error", text: req.query.markError }
                        : req.query.archived
                            ? { type: "ok", text: `Archived ${req.query.archived} product(s) — workspace is clean for the next batch.` }
                            : req.query.archiveError
                                ? { type: "error", text: req.query.archiveError }
                                : req.query.deleted
                                    ? { type: "ok", text: "Product deleted." }
                                    : req.query.deleteError
                                        ? { type: "error", text: req.query.deleteError }
                                        : null;
        res.send(dashboardView(drafts, resolveThumb, notice, pipelineState.getLastArchive()));
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

    // Drops a product's entire output/<site>/<slug> folder — for when the
    // source site has delisted/removed the product but a stale scrape of it
    // is still sitting in the review queue.
    app.post("/product/:site/:slug/delete", (req, res) => {
        const { site, slug } = req.params;
        try {
            const removed = store.deleteDraft(site, slug);
            res.redirect(removed ? "/?deleted=1" : "/?deleteError=" + encodeURIComponent("Already gone — nothing to delete."));
        } catch (error) {
            res.redirect("/?deleteError=" + encodeURIComponent(error.message));
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

    // --- Batch: upload an Excel file and run the scrape from the browser (Feature 5a/5b) ---

    app.get("/batch", (req, res) => {
        const status = scrapeRunner.getStatus();
        let runSummary = null;
        if (status.state === "running" || status.state === "done" || status.state === "failed") {
            runSummary = new RunState().summary();
        }
        const notice = req.query.uploadError
            ? { type: "error", text: req.query.uploadError }
            : req.query.startError
                ? { type: "error", text: req.query.startError }
                : req.query.discarded
                    ? { type: "ok", text: `Discarded — ${req.query.discarded} product(s)' worth of state/output moved into archive/. Those URLs are free to be re-scraped.` }
                    : req.query.discardError
                        ? { type: "error", text: req.query.discardError }
                        : null;

        res.send(batchView({
            status,
            pendingSource: scrapeRunner.getPendingSource(),
            pendingUpload: scrapeRunner.getPendingUpload(),
            runSummary,
            notice,
        }));
    });

    // Step 1: stash the raw workbook and list its sheets. The file the user
    // hands over is rarely already in url/website/status shape (it's usually
    // a per-category workbook with URLs scattered across columns), so
    // nothing is written to input/products.xlsx yet — that happens in
    // /batch/build once they've picked which sheet(s) to use.
    app.post("/batch/upload", upload.single("excel"), async (req, res) => {
        if (!req.file) {
            return res.redirect("/batch?uploadError=" + encodeURIComponent("No file was received — pick a .xlsx file first."));
        }

        try {
            fs.mkdirSync(path.dirname(SOURCE_XLSX_PATH), { recursive: true });
            fs.writeFileSync(SOURCE_XLSX_PATH, req.file.buffer);

            const sheets = await inspectWorkbook(SOURCE_XLSX_PATH);
            const totalUrls = sheets.reduce((sum, s) => sum + s.urlCount, 0);
            if (totalUrls === 0) {
                return res.redirect("/batch?uploadError=" + encodeURIComponent("No URLs found on any sheet — nothing that looks like a product link (https://... or domain.com/...) in the file."));
            }

            scrapeRunner.setPendingSource({
                sourcePath: "input/source.xlsx",
                originalName: req.file.originalname,
                sheets,
            });

            // Only one sheet — nothing to choose, build the input file straight away.
            if (sheets.length === 1) {
                await buildInputFromSource([sheets[0].name]);
            }
            res.redirect("/batch");
        } catch (error) {
            scrapeRunner.clearPendingSource();
            res.redirect("/batch?uploadError=" + encodeURIComponent(error.message));
        }
    });

    // Step 2: pick sheet(s) -> generate input/products.xlsx (url | website | status).
    app.post("/batch/build", async (req, res) => {
        if (!scrapeRunner.getPendingSource()) {
            return res.redirect("/batch?uploadError=" + encodeURIComponent("Nothing to build — upload a file first."));
        }

        const picked = [].concat(req.body.sheets || []).filter(Boolean);
        if (picked.length === 0) {
            return res.redirect("/batch?uploadError=" + encodeURIComponent("Pick at least one sheet."));
        }

        try {
            await buildInputFromSource(picked);
            res.redirect("/batch");
        } catch (error) {
            res.redirect("/batch?uploadError=" + encodeURIComponent(error.message));
        }
    });

    // Back to the sheet picker without re-uploading (e.g. picked the wrong tab).
    app.post("/batch/repick", (req, res) => {
        scrapeRunner.clearPendingUpload();
        res.redirect("/batch");
    });

    // Start over from step 1 (a different workbook entirely) — clears both
    // the generated input and the stashed raw source. Named "upload-reset"
    // (not "/batch/discard") to avoid colliding with the unrelated
    // "/batch/discard" route further below, which discards a *finished test
    // scrape run*, not the upload wizard's pending state.
    app.post("/batch/upload-reset", (req, res) => {
        scrapeRunner.clearPendingUpload();
        scrapeRunner.clearPendingSource();
        res.redirect("/batch");
    });

    // The generated url/website/status file, saved under whatever name the
    // user typed in the browser prompt (see batchView).
    app.get("/batch/input-download", (req, res) => {
        if (!fs.existsSync(INPUT_XLSX_PATH)) return res.status(404).send("No input file generated yet.");
        res.download(INPUT_XLSX_PATH, downloadName(req.query.name, "products", ".xlsx"));
    });

    async function buildInputFromSource(sheetNames) {
        const { rows, perSheet, duplicatesDropped } = await collectRows(SOURCE_XLSX_PATH, sheetNames);
        if (rows.length === 0) {
            throw new Error(`No URLs found on ${sheetNames.map(n => `"${n}"`).join(", ")}.`);
        }

        await writeInputWorkbook(rows, INPUT_XLSX_PATH);

        // Re-read through the scraper's own reader so the numbers shown are
        // exactly what src/index.js will see.
        const readBack = await readExcel(INPUT_XLSX_PATH);
        const { totalRows, distinctUrls, dupes, dupeRowCount } = findDuplicates(readBack);
        scrapeRunner.setPendingUpload({
            inputPath: "input/products.xlsx",
            totalRows,
            distinctUrls,
            dupes,
            dupeRowCount,
            sourceSheets: perSheet,
            duplicatesDropped,
        });
    }

    app.post("/batch/start", (req, res) => {
        const pending = scrapeRunner.getPendingUpload();
        if (!pending) {
            return res.redirect("/batch?startError=" + encodeURIComponent("Nothing to start — upload a file first."));
        }

        try {
            scrapeRunner.startScrape({ inputPath: pending.inputPath, headed: req.body.headed === "on" });
            res.redirect("/batch");
        } catch (error) {
            res.redirect("/batch?startError=" + encodeURIComponent(error.message));
        }
    });

    app.post("/batch/stop", (req, res) => {
        scrapeRunner.stopScrape();
        res.redirect("/batch");
    });

    app.post("/batch/reset", (req, res) => {
        try {
            scrapeRunner.clearJob();
        } catch {
            // still running — ignore, /batch will just show the running state again
        }
        res.redirect("/batch");
    });

    // Discards a finished test run: archives its state/run.json + output/
    // data aside (nothing deleted) and clears the job, so those URLs stop
    // being remembered as "already done" for a future real run.
    app.post("/batch/discard", (req, res) => {
        try {
            const archived = scrapeRunner.discardJob();
            res.redirect("/batch?discarded=" + (archived ? archived.productCount : 0));
        } catch (error) {
            res.redirect("/batch?discardError=" + encodeURIComponent(error.message));
        }
    });

    // --- Export to Mongo / mark uploaded / archive (Feature 5c/5d/5e) ---

    app.post("/export-mongo", (req, res) => {
        const body = req.body;
        const args = {
            site: body.site ? body.site.trim() : null,
            json: body.format === "json",
            includeUploaded: body.includeUploaded === "1",
        };

        try {
            const result = exportForMongo(args);
            pipelineState.setLastExport(result);
            res.redirect("/export-mongo");
        } catch (error) {
            res.status(500).send(`Export failed: ${error.message}`);
        }
    });

    app.get("/export-mongo", (req, res) => {
        const lastExport = pipelineState.getLastExport();
        const fileContents = lastExport && fs.existsSync(lastExport.mongoFile)
            ? fs.readFileSync(lastExport.mongoFile, "utf8")
            : "";
        res.send(exportResultView(lastExport, fileContents));
    });

    app.get("/export-mongo/download", (req, res) => {
        const lastExport = pipelineState.getLastExport();
        if (!lastExport || !fs.existsSync(lastExport.mongoFile)) return res.status(404).send("No export available — generate one first.");
        // ?name= comes from the "Download file" button's save-as prompt (see
        // exportResultView.js) — downloadName() sanitizes it and re-attaches
        // the real extension, same convention as /batch/input-download above.
        const ext = path.extname(lastExport.mongoFile);
        const fallback = path.basename(lastExport.mongoFile, ext);
        res.download(lastExport.mongoFile, downloadName(req.query.name, fallback, ext));
    });

    app.post("/mark-uploaded", (req, res) => {
        const lastExport = pipelineState.getLastExport();
        if (!lastExport) {
            return res.redirect("/?markError=" + encodeURIComponent("No export to mark — generate a Mongo import first."));
        }

        try {
            const result = markUploaded(lastExport.manifestFile);
            res.redirect(`/?marked=${result.marked}&markFailed=${result.failed}`);
        } catch (error) {
            res.redirect("/?markError=" + encodeURIComponent(error.message));
        }
    });

    app.post("/archive-batch", (req, res) => {
        try {
            const result = archiveBatch({ input: "input/products.xlsx" });
            pipelineState.setLastArchive(result);
            res.redirect(`/?archived=${result.productCount}`);
        } catch (error) {
            res.redirect("/?archiveError=" + encodeURIComponent(error.message));
        }
    });

    return app;
}

module.exports = { createApp };
