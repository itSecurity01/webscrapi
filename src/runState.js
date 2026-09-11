const fs = require("fs");
const path = require("path");

const DEFAULT_STATE_PATH = path.join(process.cwd(), "state", "run.json");

/**
 * Tracks per-URL scrape status across runs so a crash or interruption can be
 * resumed without re-scraping already-completed products.
 * Shape on disk: { [url]: { status: "done"|"failed", scrapedAt, error?, retries } }
 */
class RunState {
    constructor(statePath = DEFAULT_STATE_PATH) {
        this.statePath = statePath;
        this.data = {};
        this._load();
    }

    _load() {
        if (fs.existsSync(this.statePath)) {
            try {
                this.data = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
            } catch {
                this.data = {};
            }
        }
    }

    save() {
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        fs.writeFileSync(this.statePath, JSON.stringify(this.data, null, 2), "utf8");
    }

    isDone(url) {
        return this.data[url]?.status === "done";
    }

    getRetryCount(url) {
        return this.data[url]?.retries || 0;
    }

    markDone(url) {
        this.data[url] = { status: "done", scrapedAt: new Date().toISOString(), retries: this.getRetryCount(url) };
        this.save();
    }

    markFailed(url, error) {
        const retries = this.getRetryCount(url) + 1;
        this.data[url] = {
            status: "failed",
            scrapedAt: new Date().toISOString(),
            error: error && error.message ? error.message : String(error),
            retries,
        };
        this.save();
    }

    summary() {
        const values = Object.values(this.data);
        return {
            done: values.filter(v => v.status === "done").length,
            failed: values.filter(v => v.status === "failed").length,
        };
    }
}

module.exports = { RunState, DEFAULT_STATE_PATH };
