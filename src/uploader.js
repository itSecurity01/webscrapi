/**
 * Sends "reviewed" upload.json drafts to the real upload API.
 *
 * Requires UPLOAD_API_URL (+ UPLOAD_API_KEY) in .env — see .env.example.
 * Until you have those, use --dry-run to see exactly what payload each
 * product would send.
 *
 * Usage:
 *   node src/uploader.js --dry-run
 *   node src/uploader.js --site=shopsy --limit=5
 *   node src/uploader.js --force        (also re-send drafts already marked "uploaded")
 */
require("dotenv").config();
const axios = require("axios");

const store = require("./reviewServer/dataStore");
const logger = require("./utils/logger");

const UPLOAD_API_URL = process.env.UPLOAD_API_URL || null;
const UPLOAD_API_KEY = process.env.UPLOAD_API_KEY || null;
const UPLOAD_AUTH_HEADER = process.env.UPLOAD_AUTH_HEADER || "Authorization";
const UPLOAD_AUTH_SCHEME = process.env.UPLOAD_AUTH_SCHEME != null ? process.env.UPLOAD_AUTH_SCHEME : "Bearer";

function parseArgs(argv = process.argv.slice(2)) {
    const args = { site: null, limit: null, force: false, dryRun: false };
    for (const arg of argv) {
        if (arg.startsWith("--site=")) args.site = arg.split("=")[1];
        else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1], 10);
        else if (arg === "--force") args.force = true;
        else if (arg === "--dry-run") args.dryRun = true;
    }
    return args;
}

function isEligible(draft, force) {
    const status = draft._meta.status;
    if (status === "reviewed") return true;
    if (status === "uploaded" && force) return true;
    return false;
}

function buildPayload(draft) {
    const { _meta, ...payload } = draft;
    return payload;
}

async function sendPayload(payload) {
    const headers = { "Content-Type": "application/json" };
    if (UPLOAD_API_KEY) {
        headers[UPLOAD_AUTH_HEADER] = UPLOAD_AUTH_SCHEME ? `${UPLOAD_AUTH_SCHEME} ${UPLOAD_API_KEY}` : UPLOAD_API_KEY;
    }

    const response = await axios.post(UPLOAD_API_URL, payload, { headers, timeout: 30000 });
    return response.data;
}

async function main() {
    const args = parseArgs();

    if (!args.dryRun && !UPLOAD_API_URL) {
        console.error(
            "UPLOAD_API_URL is not set in .env — nothing to send to.\n" +
            "Set UPLOAD_API_URL (and UPLOAD_API_KEY if the endpoint needs auth) in .env, " +
            "or run with --dry-run to preview payloads without sending them."
        );
        process.exit(1);
    }

    const drafts = store.listDrafts({ site: args.site });
    const eligible = drafts.filter(d => isEligible(d, args.force));
    const targets = args.limit ? eligible.slice(0, args.limit) : eligible;

    console.log(`${drafts.length} draft(s) found, ${eligible.length} eligible ("reviewed"${args.force ? ' or "uploaded" (--force)' : ""}), sending ${targets.length}.`);
    if (args.dryRun) console.log("--dry-run: no requests will be sent.\n");

    let sent = 0;
    let failed = 0;

    for (const draft of targets) {
        const { site, slug } = draft._meta;
        const payload = buildPayload(draft);

        if (args.dryRun) {
            console.log(`\n--- ${site}/${slug} ---`);
            console.log(JSON.stringify(payload, null, 2));
            continue;
        }

        try {
            const response = await sendPayload(payload);
            store.updateDraft(site, slug, {}, { status: "uploaded" });
            const fresh = store.readDraft(site, slug);
            fresh._meta.uploadedAt = new Date().toISOString();
            fresh._meta.lastError = null;
            fresh._meta.lastResponse = response && typeof response === "object" ? response : null;
            store.writeDraft(site, slug, fresh);

            logger.logUploadSuccess({ site, slug, name: draft.name, responseId: response && response.id });
            console.log(`✓ ${site}/${slug}`);
            sent++;
        } catch (error) {
            const message = error.response
                ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
                : error.message;

            const fresh = store.readDraft(site, slug);
            fresh._meta.lastError = message;
            fresh._meta.lastAttemptAt = new Date().toISOString();
            store.writeDraft(site, slug, fresh);

            logger.logUploadFailure({ site, slug, name: draft.name, error: message });
            console.error(`✗ ${site}/${slug}: ${message}`);
            failed++;
        }
    }

    if (!args.dryRun) {
        console.log(`\nDone. uploaded=${sent} failed=${failed} (drafts left un-uploaded stay "reviewed" for retry)`);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
