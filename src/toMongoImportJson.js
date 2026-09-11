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
 * ObjectId out of a schema-less import, the file itself has to say so, using
 * MongoDB Extended JSON's `{ "$oid": "<24 hex chars>" }` form. This script
 * rewrites exactly the fields that need it and leaves everything else alone.
 *
 * Usage:
 *   node src/toMongoImportJson.js
 *   node src/toMongoImportJson.js --file=output/combined_uploads.json
 *   node src/toMongoImportJson.js --out=output/combined_uploads.mongoimport.json
 *
 * Then:
 *   mongoimport --uri="<connection string>" --collection=campaigns --jsonArray --file=output/combined_uploads.mongoimport.json
 */
const fs = require("fs");
const path = require("path");
const { OBJECT_ID_RE } = require("./transform/toCampaignDocument");

// Fields the campaignSchema types as ObjectId (single) or [ObjectId] (array).
// Anything not in these lists is left untouched.
const SINGLE_ID_FIELDS = ["program", "userId"];
const ARRAY_ID_FIELDS = ["categories", "selectedAffiliates"];

function parseArgs(argv = process.argv.slice(2)) {
    const args = { file: "output/combined_uploads.json", out: null };
    for (const arg of argv) {
        if (arg.startsWith("--file=")) args.file = arg.split("=")[1];
        else if (arg.startsWith("--out=")) args.out = arg.split("=")[1];
    }
    return args;
}

/** Wraps a valid 24-hex-char id string as Extended JSON; leaves anything
 * else (empty, malformed, already-wrapped) untouched so a bad value is
 * still visible in the output rather than silently dropped or corrupted. */
function toOid(value) {
    if (typeof value === "string" && OBJECT_ID_RE.test(value)) {
        return { $oid: value };
    }
    return value;
}

function convertDocument(doc, label, warnings) {
    const out = { ...doc };

    for (const field of SINGLE_ID_FIELDS) {
        if (out[field] == null || out[field] === "") continue;
        if (typeof out[field] === "string" && !OBJECT_ID_RE.test(out[field])) {
            warnings.push(`${label}: "${field}" = "${out[field]}" isn't a valid 24-hex ObjectId — left as a plain string, import will store it wrong (or the field will fail if your collection has a schema validator)`);
        }
        out[field] = toOid(out[field]);
    }

    for (const field of ARRAY_ID_FIELDS) {
        if (!Array.isArray(out[field])) continue;
        out[field] = out[field].map(value => {
            if (typeof value === "string" && !OBJECT_ID_RE.test(value)) {
                warnings.push(`${label}: "${field}" entry "${value}" isn't a valid 24-hex ObjectId — left as a plain string`);
            }
            return toOid(value);
        });
    }

    return out;
}

function main() {
    const args = parseArgs();
    const inFile = path.resolve(process.cwd(), args.file);
    const outFile = args.out
        ? path.resolve(process.cwd(), args.out)
        : inFile.replace(/\.json$/i, ".mongoimport.json");

    const docs = JSON.parse(fs.readFileSync(inFile, "utf8"));
    if (!Array.isArray(docs)) {
        console.error(`${inFile} doesn't contain a JSON array — nothing to convert.`);
        process.exit(1);
    }

    const warnings = [];
    const converted = docs.map((doc, i) => convertDocument(doc, doc.name || `document #${i + 1}`, warnings));

    fs.writeFileSync(outFile, JSON.stringify(converted, null, 2), "utf8");

    console.log(`Converted ${converted.length} document(s) from ${inFile}`);
    if (warnings.length > 0) {
        console.log(`\nWarnings (${warnings.length}):`);
        warnings.forEach(w => console.log(`  ! ${w}`));
    }
    console.log(`\nOutput file: ${outFile}`);
    console.log(`Import with: mongoimport --uri="<connection string>" --collection=campaigns --jsonArray --file="${outFile}"`);
}

main();
