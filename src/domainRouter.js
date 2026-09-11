const registry = require("./configRegistry");
const { getHostname } = require("./utils/url");

/**
 * Resolve a website config for a URL.
 * `explicitWebsite` (from the Excel `website` column) wins over hostname
 * auto-detection when present and non-empty.
 */
function getConfig(url, explicitWebsite) {
    if (explicitWebsite) {
        const match = registry.find(r => r.config.name === explicitWebsite);
        if (match) return match.config;
    }

    const hostname = getHostname(url);
    if (!hostname) return null;

    const match = registry.find(r => r.test(hostname));
    return match ? match.config : null;
}

module.exports = { getConfig };
