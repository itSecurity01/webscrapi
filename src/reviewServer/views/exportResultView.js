const path = require("path");
const { layout, esc, icon } = require("./layout");
const { promptedDownload } = require("./batchView");

function exportResultView(lastExport, fileContents) {
    if (!lastExport) {
        return layout("Export", `
          <p class="back-link"><a href="/">${icon("arrow-left")} back to review dashboard</a></p>
          <div class="panel">
            <div class="panel-header">${icon("inbox")}<h2>No export yet</h2></div>
            <p class="muted">Generate one from the "Export to Mongo" panel on the dashboard first.</p>
          </div>`, { active: "export" });
    }

    const { productCount, manifestCount, excludedUploaded, warnings, generatedAt, manifestFile, mongoFile } = lastExport;
    const defaultName = path.basename(mongoFile, path.extname(mongoFile));

    const warningsHtml = warnings && warnings.length > 0
        ? `<div class="notice notice-warn">${icon("triangle-exclamation")}<div>
             <strong>${warnings.length} warning(s)</strong> — these won't stop the file below, but may fail at insert time (e.g. an empty/invalid "program"):
             <ul style="margin:8px 0 0; padding-left:20px;">${warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
           </div></div>`
        : "";

    const body = `
      <p class="back-link"><a href="/">${icon("arrow-left")} back to review dashboard</a></p>
      <div class="panel">
        <div class="panel-header">${icon("circle-check")}<h2>Export generated</h2></div>
        <p><strong>${productCount}</strong> product(s) exported, generated ${esc(generatedAt)}.
        ${excludedUploaded > 0 ? `${excludedUploaded} already-"uploaded" product(s) were skipped.` : ""}</p>
      </div>
      ${warningsHtml}
      <div class="panel">
        <div class="panel-header">${icon("terminal")}<h2>Paste into mongosh (or download)</h2></div>
        <p class="muted" style="margin-top:-6px;">Atlas Data Explorer's "&gt;_MONGOSH" shell (or a local <code>mongosh</code>) as <code>db.campaigns.insertMany(&lt;paste this&gt;)</code>.</p>
        <textarea readonly style="min-height:320px; font-family: ui-monospace, Consolas, monospace; font-size:12.5px;" onclick="this.select()">${esc(fileContents)}</textarea>
        <div style="margin-top:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <a class="btn secondary" href="/export-mongo/download" onclick="${esc(promptedDownload("/export-mongo/download", defaultName))}">${icon("download")} Download file</a>
          <form method="post" action="/mark-uploaded" onsubmit="return confirm('Only confirm this once you\\'ve actually pasted/imported the file above into Mongo successfully. This marks ${manifestCount} product(s) so they won\\'t be re-exported next time.');" style="margin:0;">
            <button type="submit">${icon("cloud-arrow-up")} I pasted this into Mongo — mark ${manifestCount} product(s) as uploaded</button>
          </form>
        </div>
        <p class="muted" style="margin-top:10px;">Manifest: <code>${esc(manifestFile)}</code></p>
      </div>

      <div class="panel">
        <div class="panel-header">${icon("box-archive")}<h2>Archive this batch</h2></div>
        <p class="muted" style="margin-top:-6px;">Once the file above is in Mongo (and marked as uploaded), move every scraped product out of <code>output/</code> into a timestamped <code>archive/</code> folder — nothing is deleted, just moved aside — so the next Excel file starts from a clean workspace.</p>
        <form method="post" action="/archive-batch" onsubmit="return confirm('Archive all ${productCount} product(s) and clear the workspace for a new batch? Nothing is deleted \\u2014 it all moves into archive/.');">
          <button type="submit" class="secondary">${icon("box-archive")} Archive &amp; start new batch</button>
        </form>
      </div>`;

    return layout("Export", body, { active: "export" });
}

module.exports = { exportResultView };
