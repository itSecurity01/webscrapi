const { chromium, firefox } = require("playwright");

// A handful of common desktop viewport sizes to vary alongside the
// engine swap — cheap extra diversity, not an attempt at full fingerprint
// randomization.
const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
];

// Each profile launches a *real* browser build (Chrome, Edge or Firefox)
// rather than pasting a fake User-Agent string onto one Chromium instance.
// A spoofed UA on the wrong engine is easy for bot detection to catch —
// Client Hints, the JS API surface, and TLS/HTTP2 fingerprints still say
// "this is Chromium" underneath — whereas a genuine Edge or Firefox binary
// reports its own consistent, correct fingerprint everywhere a site might
// look, and its User-Agent rotates for free as a side effect of switching
// engines.
const ENGINE_PROFILES = [
    { name: "chrome", launch: (opts) => chromium.launch({ ...opts, channel: "chrome" }) },
    { name: "msedge", launch: (opts) => chromium.launch({ ...opts, channel: "msedge" }) },
    { name: "firefox", launch: (opts) => firefox.launch(opts) },
];

/**
 * Launches one browser per requested engine and hands out fresh contexts
 * picked at random from whichever engines launched successfully. Call
 * newContext() once per request/product (not once for the whole run) so the
 * effective User-Agent — and the rest of the fingerprint — actually rotates
 * between Chrome, Edge and Firefox as the scraper works through a list.
 */
class BrowserPool {
    constructor({ headless = true, engines = null, maxDomainContexts = 8 } = {}) {
        this.headless = headless;
        this.wanted = engines && engines.length ? engines : ENGINE_PROFILES.map(p => p.name);
        this.browsers = new Map(); // name -> Browser
        // hostname -> { context, engine }, in least-to-most-recently-used
        // order (a Map preserves insertion order, and contextForDomain()
        // re-inserts on every hit to keep it that way) — see contextForDomain()
        this.domainContexts = new Map();
        this.maxDomainContexts = maxDomainContexts;
    }

    async init() {
        for (const profile of ENGINE_PROFILES) {
            if (!this.wanted.includes(profile.name)) continue;
            try {
                const browser = await profile.launch({ headless: this.headless });
                this.browsers.set(profile.name, browser);
            } catch (error) {
                console.warn(`[browserPool] Could not launch "${profile.name}", skipping it: ${String(error.message || error).split("\n")[0]}`);
            }
        }

        if (this.browsers.size === 0) {
            // Last-resort fallback so a run never hard-fails just because
            // none of Chrome/Edge/Firefox are installed on this machine.
            console.warn("[browserPool] None of the requested engines launched — falling back to plain Chromium.");
            const browser = await chromium.launch({ headless: this.headless });
            this.browsers.set("chromium", browser);
        }

        this.names = [...this.browsers.keys()];
        return this.names;
    }

    _pickName() {
        return this.names[Math.floor(Math.random() * this.names.length)];
    }

    /** Fresh context on a randomly chosen engine, plus the engine's name (for logging). */
    async newContext() {
        const engine = this._pickName();
        const browser = this.browsers.get(engine);
        const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
        const context = await browser.newContext({ viewport });
        return { context, engine };
    }

    /**
     * Like newContext(), but reused across every call for the same hostname
     * instead of creating a fresh one each time. A brand-new context (the
     * default newContext() behaviour) starts with an empty cache, empty
     * cookie jar and no warm TLS/HTTP2 connection — fine the first time a
     * domain is hit in a run, wasteful every time after, since a site's
     * shared theme JS/CSS/fonts/header images then get re-downloaded from
     * scratch for every single product on that site. Reusing one context per
     * domain lets the browser's own HTTP cache do its job across products,
     * which is also just how a real visitor's session actually behaves
     * (one browser identity per site, not a fresh incognito window per page).
     *
     * Capped at `maxDomainContexts` (LRU-evicted) so a batch spanning many
     * different sites doesn't leave dozens of contexts open for the whole
     * run — each one holds real browser-process memory.
     */
    async contextForDomain(hostname) {
        const key = hostname || "unknown";
        const existing = this.domainContexts.get(key);
        if (existing) {
            // Re-insert to move this key to the most-recently-used end —
            // a Map preserves insertion order, so delete+set is enough to
            // keep the whole map in LRU order with no timestamps needed
            // (and no tie-breaking bugs when two calls land in the same ms).
            this.domainContexts.delete(key);
            this.domainContexts.set(key, existing);
            return { context: existing.context, engine: existing.engine };
        }

        if (this.domainContexts.size >= this.maxDomainContexts) {
            const oldestKey = this.domainContexts.keys().next().value;
            const evicted = this.domainContexts.get(oldestKey);
            this.domainContexts.delete(oldestKey);
            await evicted.context.close().catch(() => {});
        }

        const { context, engine } = await this.newContext();
        this.domainContexts.set(key, { context, engine });
        return { context, engine };
    }

    async closeAll() {
        await Promise.all([...this.domainContexts.values()].map(v => v.context.close().catch(() => {})));
        this.domainContexts.clear();
        await Promise.all([...this.browsers.values()].map(b => b.close().catch(() => {})));
    }
}

module.exports = { BrowserPool };
