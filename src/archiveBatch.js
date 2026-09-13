/**
 * Archives the current batch's local state so the workspace can be reset
 * for the next Excel file without losing anything — replaces the manual
 * "delete output/, state/run.json, then repeat" step.
 *
 * Moves (not copies — the whole point is an empty workspace afterward):
 *   - every entry directly inside output/ EXCEPT combine.py/tree.py (those
 *     are hand-written utility scripts that happen to live in output/, not
 *     scrape data — output/ is entirely gitignored, so losing them here
 *     would be unrecoverable, unlike everything else this touches). This
 *     covers both the per-site product folders (output/tatacliq/...) and
 *     any combined_uploads*.json/.manifest.json/.atlas.js files sitting
 *     directly in output/ from a previous `combine-uploads`/`export-mongo`.
 *   - state/run.json, if present. Safe to remove entirely — RunState
 *     (src/runState.js) just starts from `{}` and recreates the file fresh
 *     on its next save() when it's missing, confirmed by reading its
 *     _load()/save().
 *
 * Copies (not moves — it's still today's log, other runs later today keep
 * appending to it):
 *   - logs/YYYY-MM-DD.json (today's date)
 *   - logs/runs/YYYY-MM-DD*.json (today's run summaries)
 *
 * Writes archive/<timestamp>/manifest.json summarizing the batch.
 *
 * Refuses to run (clear error, nothing touched) if output/ has no
 * archivable entries — nothing to archive.
 *
 * Usage:
 *   node src/archiveBatch.js
 *   node src/archiveBatch.js --input=input/products.xlsx    (recorded in the manifest only — not read/validated)
 *   node src/archiveBatch.js --label="September batch 1"     (optional human label, also just recorded)
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output");
const STATE_FILE = path.join(ROOT, "state", "run.json");
const LOGS_DIR = path.join(ROOT, "logs");
const ARCHIVE_DIR = path.join(ROOT, "archive");

// Utility scripts that live in output/ but aren't scrape data — never archived.
const KEEP_IN_OUTPUT = new Set(["combine.py", "tree.py"]);

function parseArgs(argv = process.argv.slice(2)) {
    const args = { input: null, label: null };
    for (const arg of argv) {
        if (arg.startsWith("--input=")) args.input = arg.split("=")[1];
        else if (arg.startsWith("--label=")) args.label = arg.split("=")[1];
    }
    return args;
}

function archivableEntries() {
    if (!fs.existsSync(OUTPUT_DIR)) return [];
    return fs.readdirSync(OUTPUT_DIR).filter(name => !KEEP_IN_OUTPUT.has(name));
}

/** Recursively counts files matching `name` under `dir`. */
function countFiles(dir, name) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) count += countFiles(full, name);
        else if (entry.isFile() && entry.name.toLowerCase() === name) count++;
    }
    return count;
}

function timestampSlug() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Runs the archive and returns a summary. Exported so the Feature 5
 * "Archive & start new batch" button can call this directly. Throws (with a
 * clear message) instead of returning a failure shape when there's nothing
 * to archive — that's a usage error, not a normal outcome to render.
 */
function archiveBatch(args = {}) {
    const entries = archivableEntries();
    if (entries.length === 0) {
        throw new Error(`Nothing to archive — ${OUTPUT_DIR} has no product data (only ${[...KEEP_IN_OUTPUT].join("/")}, if anything).`);
    }

    const stamp = timestampSlug();
    const batchDir = path.join(ARCHIVE_DIR, stamp);
    const archivedOutputDir = path.join(batchDir, "output");
    fs.mkdirSync(archivedOutputDir, { recursive: true });

    const productCount = countFiles(OUTPUT_DIR, "product.json");
    const uploadCount = countFiles(OUTPUT_DIR, "upload.json");

    for (const name of entries) {
        fs.renameSync(path.join(OUTPUT_DIR, name), path.join(archivedOutputDir, name));
    }

    let stateArchived = false;
    if (fs.existsSync(STATE_FILE)) {
        fs.renameSync(STATE_FILE, path.join(batchDir, "run.json"));
        stateArchived = true;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const todayLog = path.join(LOGS_DIR, `${todayIso}.json`);
    let logsArchived = false;
    if (fs.existsSync(todayLog)) {
        fs.copyFileSync(todayLog, path.join(batchDir, `${todayIso}.json`));
        logsArchived = true;
    }

    const runsDir = path.join(LOGS_DIR, "runs");
    let runSummariesArchived = 0;
    if (fs.existsSync(runsDir)) {
        const archivedRunsDir = path.join(batchDir, "runs");
        for (const name of fs.readdirSync(runsDir)) {
            if (!name.startsWith(todayIso)) continue;
            if (runSummariesArchived === 0) fs.mkdirSync(archivedRunsDir, { recursive: true });
            fs.copyFileSync(path.join(runsDir, name), path.join(archivedRunsDir, name));
            runSummariesArchived++;
        }
    }

    const manifest = {
        archivedAt: new Date().toISOString(),
        label: args.label || null,
        inputFile: args.input || null,
        archivedEntries: entries,
        productCount,
        uploadCount,
        stateArchived,
        logsArchived,
        runSummariesArchived,
    };
    fs.writeFileSync(path.join(batchDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    return { batchDir, ...manifest };
}

function main() {
    const args = parseArgs();

    let result;
    try {
        result = archiveBatch(args);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    console.log(`Archived batch -> ${result.batchDir}`);
    console.log(`  output/: ${result.archivedEntries.length} entrie(s) moved (${result.productCount} product.json, ${result.uploadCount} upload.json)`);
    console.log(`  state/run.json: ${result.stateArchived ? "moved" : "not present, nothing to move"}`);
    console.log(`  today's log: ${result.logsArchived ? "copied" : "not present, nothing to copy"}`);
    if (result.runSummariesArchived > 0) console.log(`  ${result.runSummariesArchived} run summary file(s) copied`);
    console.log(`\nWorkspace is clean — output/ and state/run.json are ready for the next Excel file.`);
}

if (require.main === module) main();

module.exports = { archiveBatch, archivableEntries };
