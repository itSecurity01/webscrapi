/**
 * Adapts one upload.json draft into a document matching the Mongoose
 * `campaignSchema` (toolType/campaignType/name/.../isThirdParty/...) so
 * output/combined_uploads.json can be inserted straight into that
 * collection (e.g. Campaign.insertMany(...)).
 *
 * Pure — takes a draft object, returns a plain object + a list of warning
 * strings (missing/invalid required-ish fields the caller should surface,
 * rather than silently failing at insert time).
 */

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// Schema only allows these three — "Unisex" (a common scrape/manual value)
// has no equivalent, so it's dropped rather than sent as an invalid enum value.
const GENDER_MAP = {
    men: "men", man: "men", male: "men", boy: "men", boys: "men",
    women: "women", woman: "women", female: "women", girl: "women", girls: "women",
    kids: "kids", kid: "kids", child: "kids", children: "kids",
};

function clampNumber(value, min, max, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function normalizeGender(raw, warnings) {
    if (!raw) return undefined;
    const key = String(raw).trim().toLowerCase();
    if (GENDER_MAP[key]) return GENDER_MAP[key];
    warnings.push(`gender "${raw}" is not one of men/women/kids — left unset`);
    return undefined;
}

function checkObjectId(value, label, warnings) {
    if (!value) return;
    if (!OBJECT_ID_RE.test(value)) {
        warnings.push(`${label} "${value}" doesn't look like a Mongo ObjectId (24 hex chars)`);
    }
}

/**
 * Strips stray quote/bracket characters that sometimes creep into a pasted
 * ObjectId — e.g. copy-pasting from *inside* a JSON array literal
 * (`["a", "b", "c"]`) starting just after the opening `"` and ending just
 * before the closing `"` leaves the middle items quoted but the first/last
 * one only half-quoted (`a", "b", "c` split on "," -> `a"`, `"b"`, `"c`).
 * `splitList` in reviewServer/app.js only trims whitespace, so this is the
 * backstop that actually cleans it up before it reaches Mongo. Safe no-op on
 * an already-clean id.
 */
function sanitizeId(value) {
    if (typeof value !== "string") return value;
    return value.replace(/["'[\]]/g, "").trim();
}

/**
 * @param {object} draft - an upload.json draft (as produced by toUploadSchema + review edits)
 * @param {object} [options]
 * @param {string} [options.status] - explicit campaignSchema `status` to set
 *   ("in review" | "draft" | "public"). Omitted by default so Mongoose's own
 *   schema default ("public") applies — set this explicitly if scraped
 *   imports should land as drafts pending review instead of going live.
 * @returns {{ document: object, warnings: string[] }}
 */
function toCampaignDocument(draft, { status } = {}) {
    const meta = draft._meta || {};
    const warnings = [];

    // Sanitize every ObjectId-shaped field up front — see sanitizeId() for
    // why stray quotes show up here in the first place. Everything below
    // reads from these cleaned values, not draft.program/draft.categories
    // directly, so a dirty upload.json (old or new) always combines clean.
    const program = sanitizeId(draft.program || "");
    const categories = (draft.categories || []).map(sanitizeId);
    const selectedAffiliates = (draft.selectedAffiliates || []).map(sanitizeId);

    if (!draft.name) warnings.push("name is empty (required by the schema)");
    if (!program) warnings.push("program is empty (required by the schema — insert will fail without it)");
    checkObjectId(program, "program", warnings);
    categories.forEach(id => checkObjectId(id, "categories entry", warnings));

    // Not product data — the account these shared/store campaigns should be
    // attributed to. Not required by the schema (no `required: true` on
    // userId). Normally already set on the draft (toUploadSchema.js's
    // DEFAULT_USER_ID); DEFAULT_CAMPAIGN_USER_ID is a batch-wide override/
    // fallback for drafts that don't have one (e.g. hand-built ones).
    const userId = sanitizeId(draft.userId || process.env.DEFAULT_CAMPAIGN_USER_ID || "");
    if (!userId) warnings.push("userId is empty — set DEFAULT_CAMPAIGN_USER_ID in .env (or fill in draft.userId) if this campaign should be attributed to a specific user");
    checkObjectId(userId, "userId", warnings);

    const document = {
        toolType: draft.toolType || "storeIntegration",
        campaignType: draft.campaignType || "storeCampaign",
        userId: userId || undefined,
        name: draft.name || "",
        mrp: clampNumber(draft.mrp, 0, Infinity),
        productPrice: clampNumber(draft.productPrice, 0, Infinity),
        // linkCopy/linkOpen/allowForAffiliate/selectedAffiliates/status/stock
        // all have Mongoose `default`s on campaignSchema, but those defaults
        // only apply when a document is created *through* Mongoose (e.g.
        // src/uploadToMongo.js). A raw `mongoimport` of this file (the
        // to-mongo-import / to-mongo-import.json path) writes exactly the
        // bytes in the file and never sees the schema, so every one of
        // these has to be written out explicitly here or it's simply absent
        // in Mongo afterwards.
        linkCopy: clampNumber(draft.linkCopy, 0, Infinity),
        linkOpen: clampNumber(draft.linkOpen, 0, Infinity),
        discount: clampNumber(draft.discount, 0, 100),
        rating: clampNumber(draft.rating, 0, 5),
        vendorComment: draft.vendorComment || "",
        program: program || "",
        categories,
        allowForAffiliate: draft.allowForAffiliate || "all",
        selectedAffiliates,
        productSizes: draft.productSizes || [],
        colour: draft.colour || [],
        image: draft.image || "",
        subImages: draft.subImages || [],
        gender: normalizeGender(draft.gender, warnings),
        productDescription: draft.productDescription || "",
        additionalInformation: draft.additionalInformation || "",
        vendorSku: draft.vendorSku || "",
        stock: draft.stock !== undefined ? !!draft.stock : true,
        url: meta.sourceUrl || "",
        // These came from a marketplace, not a direct vendor integration — the
        // schema has dedicated fields for exactly that; sourceUrl/site/slug
        // preserved for traceability back to the original scrape.
        isThirdParty: true,
        ThirdPartyCampaignDetails: {
            website: meta.site || null,
            slug: meta.slug || null,
            sourceUrl: meta.sourceUrl || null,
        },
    };

    if (document.gender === undefined) delete document.gender;
    if (document.userId === undefined) delete document.userId;
    document.status = status || draft.status || "public";

    return { document, warnings };
}

module.exports = { toCampaignDocument, normalizeGender, clampNumber, sanitizeId, OBJECT_ID_RE };
