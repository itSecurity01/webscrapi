const { getHostname } = require("./url");

/**
 * Per-domain politeness pacing. This is deliberately separate from the
 * p-limit *concurrency* caps: concurrency controls how many requests are in
 * flight at once, this controls the minimum spacing between requests that
 * hit the same host, which is what actually keeps a scraper polite.
 */
class DomainRateLimiter {
    constructor({ delayMs = 800, jitterMs = 400 } = {}) {
        this.delayMs = delayMs;
        this.jitterMs = jitterMs;
        this.lastRequestAt = new Map(); // hostname -> timestamp
        this.queues = new Map(); // hostname -> Promise chain, to serialize waits per host
    }

    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Runs `fn` no sooner than `delayMs (+ jitter)` after the last request to
     * the same hostname resolved. Calls to different hosts are unaffected.
     */
    async schedule(url, fn) {
        const hostname = getHostname(url) || "unknown";
        const prevQueue = this.queues.get(hostname) || Promise.resolve();

        const run = prevQueue.then(async () => {
            const last = this.lastRequestAt.get(hostname) || 0;
            const jitter = Math.random() * this.jitterMs;
            const targetGap = this.delayMs + jitter;
            const elapsed = Date.now() - last;
            if (elapsed < targetGap) {
                await this._wait(targetGap - elapsed);
            }
            this.lastRequestAt.set(hostname, Date.now());
        });

        this.queues.set(hostname, run.catch(() => {}));
        await run;
        return fn();
    }
}

module.exports = { DomainRateLimiter };
