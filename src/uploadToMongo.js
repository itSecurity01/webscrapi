/**
 * Inserts output/combined_uploads.json straight into MongoDB through the
 * real Mongoose `campaign` model (src/models/Campaign.js) — NOT a raw
 * driver/mongoimport insert. This matters: going through the model is what
 * casts a 24-hex-char string like "6a71cbd8a2689c1c3b57b74d" into an actual
 * BSON ObjectId for `program`/`categories`/etc, and runs the schema's
 * required/enum/min/max checks before anything touches the database — a
 * plain JSON string stays a *string* in Mongo if it's inserted through
 * something that skips Mongoose (the native driver, `mongoimport` without
 * Extended JSON `{"$oid": "..."}` syntax), which breaks `ref` population and
 * any later "find by ObjectId" query.
 *
 * Usage:
 *   node src/uploadToMongo.js --dry-run              # validate every document, connect to nothing
 *   node src/uploadToMongo.js                        # validate + insert (needs MONGODB_URI in .env)
 *   node src/uploadToMongo.js --file=output/other.json
 *   node src/uploadToMongo.js --limit=5
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Campaign = require("./models/Campaign");
const store = require("./reviewServer/dataStore");
const logger = require("./utils/logger");

function parseArgs(argv = process.argv.slice(2)) {
    const args = { file: "output/combined_uploads.json", dryRun: false, limit: null };
    for (const arg of argv) {
        if (arg.startsWith("--file=")) args.file = arg.split("=")[1];
        else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1], 10);
        else if (arg === "--dry-run") args.dryRun = true;
    }
    return args;
}

function formatValidationError(error) {
    return Object.values(error.errors).map(e => e.message).join("; ");
}

/** Best-effort: mirrors src/uploader.js's bookkeeping so upload.json stays in
 * sync no matter which of the two upload paths (REST API or direct-to-Mongo)
 * was used — never lets a bookkeeping failure fail the actual insert. */
function markSourceUploaded(doc, insertedId) {
    const details = doc.ThirdPartyCampaignDetails;
    if (!details || !details.website || !details.slug) return;
    try {
        const draft = store.readDraft(details.website, details.slug);
        if (!draft) return;
        draft._meta.status = "uploaded";
        draft._meta.uploadedAt = new Date().toISOString();
        draft._meta.mongoId = String(insertedId);
        store.writeDraft(details.website, details.slug, draft);
    } catch {
        // ignore — bookkeeping only
    }
}

async function main() {
    const args = parseArgs();
    const filePath = path.resolve(process.cwd(), args.file);
    const docs = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const targets = args.limit ? docs.slice(0, args.limit) : docs;

    console.log(`Loaded ${docs.length} document(s) from ${filePath}${args.limit ? `, processing first ${targets.length}` : ""}.`);
    if (args.dryRun) console.log("--dry-run: validating only against the schema — nothing will be connected to or inserted.\n");

    if (!args.dryRun) {
        if (!process.env.MONGODB_URI) {
            console.error(
                "MONGODB_URI is not set in .env — set it to your MongoDB connection string, " +
                "or run with --dry-run to validate documents without connecting."
            );
            process.exit(1);
        }
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB.\n");
    }

    let ok = 0;
    let failed = 0;

    for (const doc of targets) {
        const label = doc.name || "(unnamed)";
        const site = doc.ThirdPartyCampaignDetails && doc.ThirdPartyCampaignDetails.website;
        const slug = doc.ThirdPartyCampaignDetails && doc.ThirdPartyCampaignDetails.slug;

        const instance = new Campaign(doc);
        let validationError = null;
        try {
            await instance.validate();
        } catch (error) {
            validationError = error;
        }

        if (validationError) {
            failed++;
            const message = formatValidationError(validationError);
            console.error(`✗ ${label}: ${message}`);
            logger.logUploadFailure({ site, slug, name: doc.name, error: message });
            continue;
        }

        if (args.dryRun) {
            ok++;
            console.log(`✓ ${label} (valid — program/categories cast to ObjectId cleanly)`);
            continue;
        }

        try {
            await instance.save();
            ok++;
            console.log(`✓ ${label} -> ${instance._id}`);
            logger.logUploadSuccess({ site, slug, name: doc.name, responseId: String(instance._id) });
            markSourceUploaded(doc, instance._id);
        } catch (error) {
            failed++;
            console.error(`✗ ${label}: ${error.message}`);
            logger.logUploadFailure({ site, slug, name: doc.name, error });
        }
    }

    if (!args.dryRun) await mongoose.disconnect();

    console.log(`\nDone. ${args.dryRun ? "valid" : "inserted"}=${ok} failed=${failed}`);
    if (failed > 0) {
        console.log(args.dryRun
            ? "Fix the documents above in the review UI, re-run combine-uploads, then re-check."
            : "Failed documents were not inserted and are safe to retry after fixing (the source upload.json stays \"reviewed\").");
    }
}

if (require.main === module) {
    main().catch(async (error) => {
        console.error("Fatal error:", error);
        try { await mongoose.disconnect(); } catch {}
        process.exit(1);
    });
}
