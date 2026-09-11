const SYMBOL_TO_CURRENCY = {
    "₹": "INR",
    "$": "USD",
    "£": "GBP",
    "€": "EUR",
    "¥": "JPY",
};

const CODE_PATTERN = /\b(INR|USD|GBP|EUR|JPY|AUD|CAD)\b/i;

/**
 * Parse a raw price string like "₹1,499.00", "$24.99", "1499 INR" into
 * { value: number|null, currency: string|null, raw: string }.
 */
function parsePrice(raw) {
    if (raw == null) return { value: null, currency: null, raw: null };

    const str = String(raw).trim();
    if (!str) return { value: null, currency: null, raw: str };

    let currency = null;

    for (const [symbol, code] of Object.entries(SYMBOL_TO_CURRENCY)) {
        if (str.includes(symbol)) {
            currency = code;
            break;
        }
    }

    if (!currency) {
        const codeMatch = str.match(CODE_PATTERN);
        if (codeMatch) currency = codeMatch[1].toUpperCase();
    }

    const numMatch = str.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    const value = numMatch ? parseFloat(numMatch[0]) : null;

    return { value: Number.isFinite(value) ? value : null, currency, raw: str };
}

module.exports = { parsePrice };
