const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(process.cwd(), "logs");

function ensureLogsDir() {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function todayLogPath() {
    const iso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(LOGS_DIR, `${iso}.json`);
}

function appendRecord(record) {
    ensureLogsDir();
    const filePath = todayLogPath();

    let records = [];
    if (fs.existsSync(filePath)) {
        try {
            records = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (!Array.isArray(records)) records = [];
        } catch {
            records = [];
        }
    }

    records.push({ timestamp: new Date().toISOString(), ...record });
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
}

function logSuccess({ url, website, product, imageCount, imagesFound, imagesFiltered, durationMs, engine }) {
    appendRecord({
        url,
        website,
        status: "success",
        product,
        images: imageCount,
        imagesFound,
        imagesFiltered,
        durationMs,
        engine,
    });
}

function logFailure({ url, website, error, engine }) {
    appendRecord({
        url,
        website: website || "unknown",
        status: "failed",
        error: error && error.message ? error.message : String(error),
        engine,
    });
}

function logUnknownWebsite(url) {
    appendRecord({ url, website: "unknown", status: "skipped", error: "No matching website config" });
}

function logUploadSuccess({ site, slug, name, responseId }) {
    appendRecord({ stage: "upload", site, slug, product: name, status: "success", responseId: responseId || null });
}

function logUploadFailure({ site, slug, name, error }) {
    appendRecord({
        stage: "upload",
        site,
        slug,
        product: name,
        status: "failed",
        error: error && error.message ? error.message : String(error),
    });
}

function writeRunSummary(summary) {
    ensureLogsDir();
    const runsDir = path.join(LOGS_DIR, "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    const filePath = path.join(runsDir, `${summary.runId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), "utf8");
    return filePath;
}

module.exports = {
    logSuccess,
    logFailure,
    logUnknownWebsite,
    logUploadSuccess,
    logUploadFailure,
    writeRunSummary,
};
