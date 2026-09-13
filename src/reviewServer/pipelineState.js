/**
 * In-memory bookkeeping for the review server's export/mark-uploaded/
 * archive actions (Feature 5c/5d/5e) — just enough to let "Mark as
 * uploaded" default to the manifest the last "Generate Mongo Import" click
 * actually produced, and to show a "last archived to ..." note. Not
 * persisted, same reasoning as scrapeRunner.js: this is convenience state
 * for the current server session, not data of record (the manifest/archive
 * files on disk are the actual source of truth).
 */
let lastExport = null; // { outFile, manifestFile, mongoFile, productCount, manifestCount, warnings, excludedUploaded, generatedAt }
let lastArchive = null; // { batchDir, ...archiveBatch() result, archivedAt }

function setLastExport(result) {
    lastExport = { ...result, generatedAt: new Date().toISOString() };
    return lastExport;
}

function getLastExport() {
    return lastExport;
}

function setLastArchive(result) {
    lastArchive = { ...result, archivedAt: new Date().toISOString() };
    // A fresh archive empties output/, so any manifest an export pointed at
    // no longer describes anything real -- keep the UI from offering to
    // "mark as uploaded" against a batch that's already been archived away.
    lastExport = null;
    return lastArchive;
}

function getLastArchive() {
    return lastArchive;
}

module.exports = { setLastExport, getLastExport, setLastArchive, getLastArchive };
