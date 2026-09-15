const { layout, esc } = require("./layout");

function uploadForm(notice) {
    const noticeHtml = notice
        ? `<div class="panel" style="background:${notice.type === "error" ? "#fee2e2" : "#d1fae5"}; color:${notice.type === "error" ? "#991b1b" : "#065f46"};">${esc(notice.text)}</div>`
        : "";

    return `
      ${noticeHtml}
      <div class="panel">
        <h2>1. Upload your product Excel file</h2>
        <p class="muted" style="margin-top:-6px;">Any workbook works — product URLs are picked out of every cell automatically (real hyperlinks and plain "tatacliq.com/..." text both count), so you don't need to build a url/website/status sheet by hand. If the file has several sheets you'll be asked which one(s) to use next.</p>
        <form method="post" action="/batch/upload" enctype="multipart/form-data">
          <input type="file" name="excel" accept=".xlsx,.xls" required>
          <div style="margin-top:14px;">
            <button type="submit">Upload &amp; check</button>
          </div>
        </form>
      </div>`;
}

/** The onclick for a download link: ask for a file name, then send it along. */
function promptedDownload(href, defaultName) {
    return `var n=prompt('Save file as:', ${JSON.stringify(defaultName)}); if(n===null) return false; this.href=${JSON.stringify(href)}+'?name='+encodeURIComponent(n);`;
}

function sheetPickerPanel(pendingSource, notice) {
    const { originalName, sheets } = pendingSource;
    const noticeHtml = notice
        ? `<div class="panel" style="background:${notice.type === "error" ? "#fee2e2" : "#d1fae5"}; color:${notice.type === "error" ? "#991b1b" : "#065f46"};">${esc(notice.text)}</div>`
        : "";

    const rowsHtml = sheets.map((s, i) => `
        <tr>
          <td style="width:40px;"><input type="checkbox" name="sheets" value="${esc(s.name)}" id="sheet-${i}" ${s.urlCount === 0 ? "disabled" : ""} style="width:auto;"></td>
          <td><label for="sheet-${i}" style="margin:0; font-size:14px; font-weight:500; color:inherit; cursor:pointer;">${esc(s.name)}</label></td>
          <td>${s.urlCount} URL${s.urlCount === 1 ? "" : "s"}${s.hasUrlHeader ? ' <span class="muted">(already has a "url" column)</span>' : ""}</td>
        </tr>`).join("");

    return `
      ${noticeHtml}
      <div class="panel">
        <h2>2. Which sheet(s) do you want to generate from?</h2>
        <p class="muted" style="margin-top:-6px;">From <code>${esc(originalName)}</code>. Tick one sheet, or several to merge them into a single input file. Only the URLs are kept — website and status are left blank, which is fine for the scraper.</p>
        <form method="post" action="/batch/build" id="sheet-form">
          <table style="margin-bottom:14px;">
            <thead><tr><th></th><th>Sheet</th><th>Found</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <label style="display:inline-flex; align-items:center; gap:6px; margin:0 0 14px; cursor:pointer;">
            <input type="checkbox" style="width:auto;" onchange="document.querySelectorAll('#sheet-form input[name=sheets]:not(:disabled)').forEach(function(c){c.checked=this.checked}, this)"> Select all
          </label>
          <div>
            <button type="submit" onclick="if(!document.querySelector('#sheet-form input[name=sheets]:checked')){alert('Pick at least one sheet.');return false;}">Generate input Excel</button>
            <button type="submit" formaction="/batch/upload-reset" class="secondary" formnovalidate>Upload a different file instead</button>
          </div>
        </form>
      </div>`;
}

function pendingUploadPanel(pendingUpload, pendingSource) {
    const { totalRows, distinctUrls, dupes, dupeRowCount, inputPath, sourceSheets, duplicatesDropped } = pendingUpload;

    const sourceHtml = sourceSheets && sourceSheets.length > 0
        ? `<p class="muted">Generated from ${sourceSheets.map(s => `<strong>${esc(s.name)}</strong> (${s.found})`).join(" + ")}${duplicatesDropped > 0 ? ` — ${duplicatesDropped} repeated URL(s) dropped while merging.` : "."}</p>`
        : "";

    const defaultName = sourceSheets && sourceSheets.length > 0
        ? sourceSheets.map(s => s.name).join(" + ")
        : "products";

    const repickHtml = pendingSource && pendingSource.sheets.length > 1
        ? `<form method="post" action="/batch/repick" style="display:inline;"><button type="submit" class="secondary">Pick different sheet(s)</button></form>`
        : "";

    const dupeHtml = dupes.length > 0
        ? `<div class="panel" style="background:#fef3c7; color:#92400e;">
             <strong>${dupes.length} duplicate URL(s)</strong> — ${dupeRowCount} row(s) total, ${dupeRowCount - dupes.length} of them wasted re-scrapes. Harmless (each re-scrape just overwrites the same product folder) but worth cleaning up in the sheet if you have time.
             <ul style="margin:8px 0 0; padding-left:20px;">
               ${dupes.slice(0, 15).map(d => `<li>x${d.count} — ${esc(d.url)}</li>`).join("")}
               ${dupes.length > 15 ? `<li class="muted">...and ${dupes.length - 15} more</li>` : ""}
             </ul>
           </div>`
        : `<div class="panel" style="background:#d1fae5; color:#065f46;">No duplicate URLs found.</div>`;

    return `
      <div class="panel">
        <h2>3. Review &amp; start</h2>
        <p><strong>${totalRows}</strong> row(s), <strong>${distinctUrls}</strong> distinct URL(s) — written to <code>${esc(inputPath)}</code> as <code>url | website | status</code>.</p>
        ${sourceHtml}
        <a class="btn secondary" href="/batch/input-download" onclick="${esc(promptedDownload("/batch/input-download", defaultName))}">Download generated Excel</a>
      </div>
      ${dupeHtml}
      <div class="panel" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <form method="post" action="/batch/start" style="display:inline;">
          <label style="display:block; margin-bottom:12px; font-weight:normal;">
            <input type="checkbox" name="headed" style="margin-right:6px;">
            Run in headed mode (visible browser window — useful for watching/debugging a run)
          </label>
          <button type="submit">Start scrape (${distinctUrls} product${distinctUrls === 1 ? "" : "s"})</button>
        </form>
        ${repickHtml}
        <form method="post" action="/batch/upload-reset" style="display:inline;">
          <button type="submit" class="secondary">Upload a different file instead</button>
        </form>
      </div>`;
}

function statusPanel(status, runSummary, notice) {
    const noticeHtml = notice
        ? `<div class="panel" style="background:${notice.type === "error" ? "#fee2e2" : "#d1fae5"}; color:${notice.type === "error" ? "#991b1b" : "#065f46"};">${esc(notice.text)}</div>`
        : "";

    const elapsedNote = status.exitedAt
        ? `finished ${esc(status.exitedAt)}`
        : `started ${esc(status.startedAt)}`;

    const countsHtml = runSummary
        ? `<p><strong>${runSummary.done}</strong> done, <strong>${runSummary.failed}</strong> failed so far.</p>`
        : "";

    const stateLabel = { running: "Running", done: "Done", failed: "Failed" }[status.state] || status.state;
    const stateColor = { running: "#1e40af", done: "#065f46", failed: "#991b1b" }[status.state] || "#555";

    const logHtml = status.recentLog && status.recentLog.length > 0
        ? `<pre style="background:#0b0f19; color:#d1d5db; padding:14px; border-radius:8px; max-height:280px; overflow:auto; font-size:12px; line-height:1.5;">${esc(status.recentLog.join("\n"))}</pre>`
        : `<p class="muted">No output yet.</p>`;

    const transformHtml = status.transform
        ? status.transform.error
            ? `<p style="color:#991b1b;">Auto-transform failed: ${esc(status.transform.error)}</p>`
            : `<p class="muted">Transformed into review drafts: ${status.transform.created} created, ${status.transform.skipped} skipped${status.transform.failed ? `, ${status.transform.failed} failed` : ""}.</p>`
        : "";

    const actions = status.state === "running"
        ? `<form method="post" action="/batch/stop" onsubmit="return confirm('Stop the running scrape? Progress so far is safe (state/run.json), but this run won\\'t finish.');">
             <button type="submit" class="secondary">⏹️ Stop scrape</button>
           </form>`
        : `<a class="btn" href="/">📊 Go to the review dashboard &rarr;</a>
           <form method="post" action="/batch/reset" style="display:inline;">
             <button type="submit" class="secondary">🔄 Start a new upload</button>
           </form>
           <form method="post" action="/batch/discard" style="display:inline;" onsubmit="return confirm('Discard this test run? Its output/ data and state/run.json entries move into archive/ (nothing is deleted), so these URLs stop counting as already-scraped. Only do this for a throwaway test run \\u2014 not a real batch you still need to review.');">
             <button type="submit" class="danger">🗑️ Discard this test run</button>
           </form>`;

    return `
      ${noticeHtml}
      <div class="panel">
        <h2>Scrape — <span style="color:${stateColor}">${stateLabel}</span></h2>
        <p class="muted">Input: <code>${esc(status.inputPath)}</code>${status.headed ? " — headed (visible browser)" : ""} — ${elapsedNote}${status.exitCode != null ? ` (exit code ${status.exitCode})` : ""}</p>
        ${countsHtml}
        ${status.error ? `<p style="color:#991b1b;">Error: ${esc(status.error)}</p>` : ""}
        ${transformHtml}
        ${logHtml}
      </div>
      <div class="panel">${actions}</div>
      ${status.state === "running" ? '<meta http-equiv="refresh" content="3">' : ""}`;
}

function batchView({ status, pendingSource, pendingUpload, runSummary, notice }) {
    let body;
    if (status.state === "running" || status.state === "done" || status.state === "failed") {
        body = statusPanel(status, runSummary, notice);
    } else if (pendingUpload) {
        body = pendingUploadPanel(pendingUpload, pendingSource);
    } else if (pendingSource) {
        body = sheetPickerPanel(pendingSource, notice);
    } else {
        body = uploadForm(notice);
    }

    return layout("Batch", `<p class="back-link"><a href="/">&larr; back to review dashboard</a></p>${body}`);
}

module.exports = { batchView, promptedDownload };
