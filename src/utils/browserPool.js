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
    constructor({ headless = true, engines = null } = {}) {
        this.headless = headless;
        this.wanted = engines && engines.length ? engines : ENGINE_PROFILES.map(p => p.name);
        this.browsers = new Map(); // name -> Browser
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

    async closeAll() {
        await Promise.all([...this.browsers.values()].map(b => b.close().catch(() => {})));
    }
}

module.exports = { BrowserPool };
