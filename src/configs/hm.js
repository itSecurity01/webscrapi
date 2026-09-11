// Best-effort config for hm.com. Verify/adjust selectors against a real
// product page before relying on this in production — H&M markup varies
// by region/locale, and the EU sites show a mandatory cookie banner.
module.exports = {
    name: "hm",

    beforeExtract: async (page) => {
        const consentSelectors = [
            "#onetrust-accept-btn-handler",
            'button[id*="accept"]',
            ".cookie-consent button",
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
        title: ['[data-testid="product-title"]', "h1.product-item-headline", "h1"],
        price: ['[data-testid="product-price"]', ".product-item-price", ".price"],
        description: ['[data-testid="product-description"]', ".product-description", ".pdp-description-list"],
        images: [".product-detail-main-image-container img", ".pdp-image img", "picture img"],

        sizes: ['[data-testid="size-picker"] button', ".size-selector li"],
        colors: ['[data-testid="color-picker"] a', ".product-colors li"],
    },

    additionalFields: {
        material: ['[data-testid="product-composition"]', ".pdp-composition"],
        availability: ['[data-testid="availability"]', ".availability-message"],
    },

    parse: {
        price: (raw) => require("../utils/price").parsePrice(raw),
    },
};
