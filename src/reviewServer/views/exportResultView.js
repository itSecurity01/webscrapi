const { layout, esc } = require("./layout");

function exportResultView(lastExport, fileContents) {
    if (!lastExport) {
        return layout("Export to Mongo", `
          <p class="back-link"><a href="/">&larr; back to review dashboard</a></p>
          <div class="panel">
            <h2>No export yet</h2>
            <p class="muted">Generate one from the "Export to Mongo" panel on the dashboard first.</p>
          </div>`);
    }

    const { productCount, manifestCount, excludedUploaded, warnings, generatedAt, manifestFile } = lastExport;

    const warningsHtml = warnings && warnings.length > 0
        ? `<div class="panel" style="background:#fef3c7; color:#92400e;">
             <strong>${warnings.length} warning(s)</strong> — these won't stop the file below, but may fail at insert time (e.g. an empty/invalid "program"):
             <ul style="margin:8px 0 0; padding-left:20px;">${warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
           </div>`
        : "";

    const body = `
      <p class="back-link"><a href="/">&larr; back to review dashboard</a></p>
      <div class="panel">
        <h2>Export generated</h2>
        <p><strong>${productCount}</strong> product(s) exported, generated ${esc(generatedAt)}.
        ${excludedUploaded > 0 ? `${excludedUploaded} already-"uploaded" product(s) were skipped.` : ""}</p>
      </div>
      ${warningsHtml}
      <div class="panel">
        <h2>Paste into mongosh (or download)</h2>
        <p class="muted" style="margin-top:-6px;">Atlas Data Explorer's "&gt;_MONGOSH" shell (or a local <code>mongosh</code>) as <code>db.campaigns.insertMany(&lt;paste this&gt;)</code>.</p>
        <textarea readonly style="min-height:320px; font-family: ui-monospace, Consolas, monospace; font-size:12.5px;" onclick="this.select()">${esc(fileContents)}</textarea>
        <div style="margin-top:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <a class="btn secondary" href="/export-mongo/download">Download file</a>
          <form method="post" action="/mark-uploaded" onsubmit="return confirm('Only confirm this once you\\'ve actually pasted/imported the file above into Mongo successfully. This marks ${manifestCount} product(s) so they won\\'t be re-exported next time.');" style="margin:0;">
            <button type="submit">I pasted this into Mongo — mark ${manifestCount} product(s) as uploaded</button>
          </form>
        </div>
        <p class="muted" style="margin-top:10px;">Manifest: <code>${esc(manifestFile)}</code></p>
      </div>`;

    return layout("Export to Mongo", body);
}

module.exports = { exportResultView };
