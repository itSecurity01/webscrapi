const path = require("path");
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

    const { productCount, manifestCount, excludedUploaded, warnings, generatedAt, manifestFile, mongoFile } = lastExport;
    const suggestedName = path.basename(mongoFile);

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
          <button type="button" class="secondary" onclick="downloadWithName(${esc(JSON.stringify(suggestedName))})">⬇️ Download file</button>
          <form method="post" action="/mark-uploaded" onsubmit="return confirm('Only confirm this once you\\'ve actually pasted/imported the file above into Mongo successfully. This marks ${manifestCount} product(s) so they won\\'t be re-exported next time.');" style="margin:0;">
            <button type="submit">✅ I pasted this into Mongo — mark ${manifestCount} product(s) as uploaded</button>
          </form>
        </div>
        <p class="muted" style="margin-top:10px;">Manifest: <code>${esc(manifestFile)}</code></p>
      </div>

      <script>
        function downloadWithName(suggested) {
          var validExts = ['txt', 'json', 'js', 'ts'];
          var name = prompt('Save as (a .js extension is added automatically if you leave one off):', suggested);
          if (name === null) return; // cancelled
          name = name.trim();
          if (!name) return;
          var match = name.match(/\\.([a-zA-Z0-9]+)$/);
          var hasValidExt = match && validExts.indexOf(match[1].toLowerCase()) !== -1;
          if (!hasValidExt) name += '.js';
          window.location.href = '/export-mongo/download?filename=' + encodeURIComponent(name);
        }
      </script>`;

    return layout("Export to Mongo", body);
}

module.exports = { exportResultView };
