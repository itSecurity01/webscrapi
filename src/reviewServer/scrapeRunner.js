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
const { archiveBatch } = require("../archiveBatch");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const INDEX_JS = path.join(__dirname, "..", "index.js");
const MAX_LOG_LINES = 500;

let pendingUpload = null; // { inputPath, totalRows, distinctUrls, dupes, dupeRowCount, uploadedAt }
let job = null; // { process, inputPath, startedAt, exitedAt, exitCode, error, log: string[] }

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

/** @param {{ inputPath: string, headed?: boolean }} options - inputPath is resolved (absolute) or cwd-relative to
 * PROJECT_ROOT; headed launches the scraper's browser visibly instead of headless (useful for watching/debugging
 * a run from the Batch page). */
function startScrape({ inputPath, headed = false }) {
    if (isRunning()) {
        throw new Error("A scrape is already running — wait for it to finish (or stop it) before starting another.");
    }

    const relativeInput = path.isAbsolute(inputPath) ? path.relative(PROJECT_ROOT, inputPath) : inputPath;
    const cliArgs = [INDEX_JS, `--input=${relativeInput}`];
    if (headed) cliArgs.push("--headed");
    const child = spawn(process.execPath, cliArgs, {
        cwd: PROJECT_ROOT,
        env: process.env,
    });

    job = {
        process: child,
        inputPath: relativeInput,
        headed,
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

/**
 * For a test/throwaway run: clearJob() alone only resets what the Batch
 * page *shows* — it leaves state/run.json marking those URLs "done" and
 * their scraped files sitting in output/, so a later real run over
 * overlapping URLs would silently skip them as already-done. This instead
 * archives that run's state/run.json + output/ data aside (the same
 * move-not-delete archiveBatch() the dashboard's "Archive this batch"
 * button already uses) before clearing the job, so the test run stops
 * counting against future runs. Nothing is deleted — it all lands in
 * archive/<timestamp>/, same as a normal archive.
 * Refuses while a scrape is running (stop it first).
 */
function discardJob() {
    if (isRunning()) throw new Error("A scrape is still running — stop it first.");
    if (!job) throw new Error("Nothing to discard.");

    let archived = null;
    try {
        archived = archiveBatch({ input: job.inputPath, label: "Discarded test run (Batch page)" });
    } catch (error) {
        // "Nothing to archive" (e.g. the run failed before producing any
        // output) isn't a real failure here — there's just nothing to move
        // aside, so fall through and clear the job anyway.
        if (!/Nothing to archive/.test(error.message)) throw error;
    }

    clearJob();
    return archived;
}

function getStatus() {
    if (!job) return { state: "idle" };

    const base = {
        inputPath: job.inputPath,
        headed: job.headed,
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

module.exports = { setPendingUpload, getPendingUpload, clearPendingUpload, startScrape, stopScrape, clearJob, discardJob, getStatus, isRunning };
