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
        this.pausedUntil = new Map(); // hostname -> timestamp; set after a 429 / 503
    }

    /**
     * Holds every future request to this hostname until now + `ms`. Used when
     * a site answers 429: continuing to send (or retrying) only keeps the
     * throttle tripped, so the whole domain waits it out instead. Other
     * hostnames are unaffected. Never shortens an existing pause.
     */
    pauseDomain(url, ms) {
        const hostname = getHostname(url) || "unknown";
        const until = Date.now() + ms;
        if (until > (this.pausedUntil.get(hostname) || 0)) this.pausedUntil.set(hostname, until);
        return until;
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
            // Loop, not a single wait: a 429 elsewhere may extend the pause meanwhile.
            let pausedFor;
            while ((pausedFor = (this.pausedUntil.get(hostname) || 0) - Date.now()) > 0) {
                await this._wait(pausedFor);
            }
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
