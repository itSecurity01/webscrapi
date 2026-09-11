// Best-effort config for levi.com. Verify/adjust selectors against a real
// product page before relying on this in production — Levi's markup varies
// by region/locale.
module.exports = {
    name: "levis",

    beforeExtract: async (page) => {
        const consentSelectors = [
            "#onetrust-accept-btn-handler",
            'button[data-testid="cookie-accept"]',
            ".cookie-banner button",
        ];
        for (const sel of consentSelectors) {
            const el = page.locator(sel).first();
            if (await el.count().catch(() => 0) > 0) {
                await el.click({ timeout: 2000 }).catch(() => {});
                break;
            }
        }
        await page.mouse.wheel(0, 2000).catch(() => {});
        await page.waitForTimeout(300);
    },

    selectors: {
        title: ['[data-testid="product-name"]', "h1.product-name", "h1"],
        price: ['[data-testid="product-price"]', ".price", ".product-price"],
        description: ['[data-testid="product-description"]', ".product-description", ".pdp-description"],
        images: [".product-image-gallery img", ".pdp-image img", ".product-images img"],

        // Multi-value fields — every matching element's text is collected, not just the first.
        sizes: ['[data-testid="size-selector"] button', ".size-selector li", 'select[name="size"] option'],
        colors: ['[data-testid="color-selector"] button', ".color-swatch-list li", ".swatch-list li"],
    },

    // Arbitrary extra fields beyond the fixed product shape — add/remove freely.
    // Single value: an array of selectors, same fallback rule as title/price.
    // Multiple values: { selectors: [...], multiple: true } — same rule as sizes/colors.
    additionalFields: {
        fit: ['[data-testid="product-fit"]'],
        material: ['[data-testid="product-fabric"]', ".product-fabric"],
        careInstructions: { selectors: [".care-instructions li", '[data-testid="care-instructions"] li'], multiple: true },
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
