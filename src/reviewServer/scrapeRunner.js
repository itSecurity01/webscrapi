/**
 * In-memory state for the review server's "Batch" page (Feature 5a/5b):
 * the Excel file just uploaded but not yet started (`pendingUpload`), and
 * the currently-running (or last-run) scrape child process (`job`).
 *
 * Deliberately in-memory only, not persisted — this mirrors how the
 * scraper already tracks progress durably in its own right place
 * (state/run.json via src/runState.js); this module just needs to know
 * "is a process alive right now" and "what did it print recently", which
 * has no meaning across a server restart anyway.
 *
 * The scrape itself runs as a detached child process (`node src/index.js`),
 * not in-process — src/index.js launches a real Playwright browser and
 * runs for minutes, which has no business blocking (or crashing) the
 * review server's event loop.
 */
const { spawn } = require("child_process");
const path = require("path");
const { runTransform } = require("../transformCli");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const INDEX_JS = path.join(__dirname, "..", "index.js");
const MAX_LOG_LINES = 500;

// The raw workbook the user uploaded, waiting for them to pick which
// sheet(s) to turn into input/products.xlsx (see excelNormalizer.js).
let pendingSource = null; // { sourcePath, originalName, sheets: [{ name, urlCount, hasUrlHeader }], uploadedAt }
let pendingUpload = null; // { inputPath, totalRows, distinctUrls, dupes, dupeRowCount, sourceSheets, duplicatesDropped, uploadedAt }
let job = null; // { process, inputPath, startedAt, exitedAt, exitCode, error, log: string[] }

function setPendingSource(info) {
    pendingSource = { ...info, uploadedAt: new Date().toISOString() };
    return pendingSource;
}

function getPendingSource() {
    return pendingSource;
}

function clearPendingSource() {
    pendingSource = null;
}

function setPendingUpload(info) {
    pendingUpload = { ...info, uploadedAt: new Date().toISOString() };
    return pendingUpload;
}

function getPendingUpload() {
    return pendingUpload;
}

function clearPendingUpload() {
    pendingUpload = null;
}

function isRunning() {
    return !!(job && job.exitCode === undefined && job.exitedAt === null);
}

/** @param {{ inputPath: string }} options - inputPath is resolved (absolute) or cwd-relative to PROJECT_ROOT */
function startScrape({ inputPath }) {
    if (isRunning()) {
        throw new Error("A scrape is already running — wait for it to finish (or stop it) before starting another.");
    }

    const relativeInput = path.isAbsolute(inputPath) ? path.relative(PROJECT_ROOT, inputPath) : inputPath;
    const child = spawn(process.execPath, [INDEX_JS, `--input=${relativeInput}`], {
        cwd: PROJECT_ROOT,
        env: process.env,
    });

    job = {
        process: child,
        inputPath: relativeInput,
        startedAt: new Date().toISOString(),
        exitedAt: null,
        exitCode: undefined,
        error: null,
        log: [],
    };
    const thisJob = job;

    const pushOutput = (buf) => {
        const lines = buf.toString().split(/\r?\n/).filter(Boolean);
        thisJob.log.push(...lines);
        if (thisJob.log.length > MAX_LOG_LINES) thisJob.log.splice(0, thisJob.log.length - MAX_LOG_LINES);
    };
    child.stdout.on("data", pushOutput);
    child.stderr.on("data", pushOutput);

    child.on("exit", (code) => {
        thisJob.exitCode = code;

        // Auto-run the transform step (product.json -> upload.json) right
        // after a successful scrape, so the review dashboard has drafts to
        // show without a separate "npm run transform" in a terminal — that
        // CLI dependency sitting in the middle of an otherwise browser-only
        // flow would defeat the point of this page. Safe to run even if the
        // scrape partially failed (transform only touches folders that
        // already have a product.json); never overwrites an existing
        // upload.json (no --force), so it can't clobber review-UI edits
        // from an earlier batch that's still sitting around.
        if (code === 0) {
            try {
                thisJob.transform = runTransform({});
            } catch (error) {
                thisJob.transform = { error: error.message };
            }
        }

        thisJob.exitedAt = new Date().toISOString();
    });
    child.on("error", (err) => {
        thisJob.error = err.message;
        thisJob.exitCode = -1;
        thisJob.exitedAt = new Date().toISOString();
    });

    // A fresh scrape means whatever was pending is now underway.
    clearPendingUpload();

    return getStatus();
}

/** Kills the running scrape, if any. Returns false if nothing was running. */
function stopScrape() {
    if (!isRunning()) return false;
    job.process.kill();
    return true;
}

/** Clears a finished (done/failed) job so the batch page goes back to the
 * upload form. Refuses while a scrape is actually running (stop it first). */
function clearJob() {
    if (isRunning()) throw new Error("A scrape is still running — stop it first.");
    job = null;
}

function getStatus() {
    if (!job) return { state: "idle" };

    const base = {
        inputPath: job.inputPath,
        startedAt: job.startedAt,
        exitedAt: job.exitedAt,
        exitCode: job.exitCode,
        error: job.error,
        recentLog: job.log.slice(-40),
        transform: job.transform || null,
    };

    if (isRunning()) return { state: "running", ...base };
    if (job.error || job.exitCode !== 0) return { state: "failed", ...base };
    return { state: "done", ...base };
}

module.exports = {
    setPendingSource, getPendingSource, clearPendingSource,
    setPendingUpload, getPendingUpload, clearPendingUpload,
    startScrape, stopScrape, clearJob, getStatus, isRunning,
};
