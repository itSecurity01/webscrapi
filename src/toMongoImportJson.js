/**
 * Transforms a combined-uploads file (plain ObjectId-shaped strings, as
 * produced by `npm run combine-uploads`) into a file that's actually valid
 * for a direct MongoDB import — mongoimport, Compass's "Import Data", or
 * any tool that reads MongoDB Extended JSON.
 *
 * Why this is a separate step: a plain JSON string like
 * "6a71cbd8a2689c1c3b57b74d" imported via mongoimport/Compass stays a
 * *string* in the database — those tools don't know `program`/`categories`
 * are supposed to be ObjectId, because there's no Mongoose schema in the
 * loop to cast it (that casting only happens if something goes through the
 * actual Mongoose model, e.g. src/uploadToMongo.js). To get a real BSON
 * ObjectId out of a schema-less import, the file itself has to say so.
 * There are two ways to say so, picked with --shell:
 *
 *   - default (Extended JSON `{ "$oid": "<24 hex chars>" }`) — for
 *     mongoimport, Compass's "Import Data", or any tool that reads strict
 *     JSON / MongoDB Extended JSON.
 *   - --shell (`ObjectId("<24 hex chars>")`) — for pasting straight into
 *     Atlas's browser-based "mongosh" / Data Explorer shell, or a local
 *     `mongosh`, e.g. as the argument to `db.campaigns.insertMany([...])`.
 *     NOTE: this output is *not* strict JSON (ObjectId(...) is a function
 *     call, JSON.parse can't read it) — it only works pasted into something
 *     that evaluates it as JS/shell syntax, not fed to mongoimport.
 *
 * Either way, every ObjectId-shaped field is also sanitized first (stray
 * quote/bracket characters stripped — see toCampaignDocument.js's
 * sanitizeId for how those creep in) so a dirty upload.json/combined file
 * still converts cleanly instead of silently staying a broken string.
 *
 * Usage:
 *   node src/toMongoImportJson.js
 *   node src/toMongoImportJson.js --file=output/combined_uploads.json
 *   node src/toMongoImportJson.js --out=output/combined_uploads.mongoimport.json
 *   node src/toMongoImportJson.js --shell                                    (ObjectId(...) shell syntax instead of {"$oid": ...})
 *   node src/toMongoImportJson.js --shell --out=output/combined_uploads.atlas.js
 *
 * Then:
 *   mongoimport --uri="<connection string>" --collection=campaigns --jsonArray --file=output/combined_uploads.mongoimport.json
 */
const fs = require("fs");
const path = require("path");
const { OBJECT_ID_RE, sanitizeId } = require("./transform/toCampaignDocument");

// Fields the campaignSchema types as ObjectId (single) or [ObjectId] (array).
// Anything not in these lists is left untouched.
const SINGLE_ID_FIELDS = ["program", "userId"];
const ARRAY_ID_FIELDS = ["categories", "selectedAffiliates"];

// Internal-only sentinel key used to mark "this string is an ObjectId" while
// still going through a normal JSON.stringify — see toShellSyntax() below,
// which turns these into `ObjectId("...")` afterwards. Never appears in the
// actual output.
const RAW_OID_KEY = "__rawObjectId";

function parseArgs(argv = process.argv.slice(2)) {
    const args = { file: "output/combined_uploads.json", out: null, shell: false };
    for (const arg of argv) {
        if (arg.startsWith("--file=")) args.file = arg.split("=")[1];
        else if (arg.startsWith("--out=")) args.out = arg.split("=")[1];
        else if (arg === "--shell") args.shell = true;
    }
    return args;
}

/** Wraps a valid 24-hex-char id string as Extended JSON (or, in --shell
 * mode, a sentinel later rewritten to `ObjectId("...")`); leaves anything
 * still-invalid after sanitizing untouched so a bad value is still visible
 * in the output rather than silently dropped or corrupted. */
function toOid(value, shell) {
    const clean = sanitizeId(value);
    if (typeof clean === "string" && OBJECT_ID_RE.test(clean)) {
        return shell ? { [RAW_OID_KEY]: clean } : { $oid: clean };
    }
    return value;
}

function convertDocument(doc, label, warnings, shell) {
    const out = { ...doc };

    for (const field of SINGLE_ID_FIELDS) {
        if (out[field] == null || out[field] === "") continue;
        const clean = sanitizeId(out[field]);
        if (typeof clean === "string" && !OBJECT_ID_RE.test(clean)) {
            warnings.push(`${label}: "${field}" = "${out[field]}" isn't a valid 24-hex ObjectId — left as a plain string, import will store it wrong (or the field will fail if your collection has a schema validator)`);
        }
        out[field] = toOid(out[field], shell);
    }

    for (const field of ARRAY_ID_FIELDS) {
        if (!Array.isArray(out[field])) continue;
        out[field] = out[field].map(value => {
            const clean = sanitizeId(value);
            if (typeof clean === "string" && !OBJECT_ID_RE.test(clean)) {
                warnings.push(`${label}: "${field}" entry "${value}" isn't a valid 24-hex ObjectId — left as a plain string`);
            }
            return toOid(value, shell);
        });
    }

    return out;
}

/** JSON.stringify(docs) with every {"__rawObjectId": "<hex>"} sentinel
 * rewritten to the shell literal ObjectId("<hex>"). The result is valid
 * mongosh/JS syntax, NOT strict JSON. */
function toShellSyntax(docs) {
    const json = JSON.stringify(docs, null, 2);
    const sentinelRe = new RegExp(`\\{\\s*"${RAW_OID_KEY}":\\s*"([0-9a-fA-F]{24})"\\s*\\}`, "g");
    return json.replace(sentinelRe, 'ObjectId("$1")');
}

/**
 * Core of this script, factored out so src/exportForMongo.js can convert an
 * already-in-memory document array (e.g. straight from
 * combineUploads.js's buildCombinedDocuments()) without round-tripping it
 * through a file first. Pure — no file I/O, nothing printed.
 *
 * @param {object[]} docs
 * @param {{ shell?: boolean }} [options]
 * @returns {{ converted: object[], warnings: string[], fileContents: string }}
 */
function convertForMongoImport(docs, { shell = false } = {}) {
    const warnings = [];
    const converted = docs.map((doc, i) => convertDocument(doc, doc.name || `document #${i + 1}`, warnings, shell));
    const fileContents = shell ? toShellSyntax(converted) : JSON.stringify(converted, null, 2);
    return { converted, warnings, fileContents };
}

function main() {
    const args = parseArgs();
    const inFile = path.resolve(process.cwd(), args.file);
    const outFile = args.out
        ? path.resolve(process.cwd(), args.out)
        : inFile.replace(/\.json$/i, args.shell ? ".atlas.js" : ".mongoimport.json");

    const docs = JSON.parse(fs.readFileSync(inFile, "utf8"));
    if (!Array.isArray(docs)) {
        console.error(`${inFile} doesn't contain a JSON array — nothing to convert.`);
        process.exit(1);
    }

    const { converted, warnings, fileContents } = convertForMongoImport(docs, { shell: args.shell });
    fs.writeFileSync(outFile, fileContents, "utf8");

    console.log(`Converted ${converted.length} document(s) from ${inFile}`);
    if (warnings.length > 0) {
        console.log(`\nWarnings (${warnings.length}):`);
        warnings.forEach(w => console.log(`  ! ${w}`));
    }
    console.log(`\nOutput file: ${outFile}`);
    console.log(args.shell
        ? `Paste into Atlas's Data Explorer ">_MONGOSH" shell (or local mongosh) as: db.campaigns.insertMany(<paste the array from this file>)`
        : `Import with: mongoimport --uri="<connection string>" --collection=campaigns --jsonArray --file="${outFile}"`);
}

if (require.main === module) main();

module.exports = { convertForMongoImport };
