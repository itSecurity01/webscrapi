const { layout, esc } = require("./layout");

function uploadForm(notice) {
    const noticeHtml = notice
        ? `<div class="panel" style="background:${notice.type === "error" ? "#fee2e2" : "#d1fae5"}; color:${notice.type === "error" ? "#991b1b" : "#065f46"};">${esc(notice.text)}</div>`
        : "";

    return `
      ${noticeHtml}
      <div class="panel">
        <h2>1. Upload your product Excel file</h2>
        <p class="muted" style="margin-top:-6px;">Needs a "url" column on the first sheet (see the sample: <code>npm run sample-excel</code>). Real hyperlinks and plain-text URLs both work.</p>
        <form method="post" action="/batch/upload" enctype="multipart/form-data">
          <input type="file" name="excel" accept=".xlsx,.xls" required>
          <div style="margin-top:14px;">
            <button type="submit">Upload &amp; check</button>
          </div>
        </form>
      </div>`;
}

function pendingUploadPanel(pendingUpload) {
    const { totalRows, distinctUrls, dupes, dupeRowCount, inputPath } = pendingUpload;

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
        <h2>2. Review &amp; start</h2>
        <p><strong>${totalRows}</strong> row(s), <strong>${distinctUrls}</strong> distinct URL(s) — from <code>${esc(inputPath)}</code>.</p>
      </div>
      ${dupeHtml}
      <div class="panel">
        <form method="post" action="/batch/start" style="display:inline;">
          <button type="submit">Start scrape (${distinctUrls} product${distinctUrls === 1 ? "" : "s"})</button>
        </form>
        <a class="btn secondary" href="/batch">Upload a different file instead</a>
      </div>`;
}

function statusPanel(status, runSummary) {
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
             <button type="submit" class="secondary">Stop scrape</button>
           </form>`
        : `<a class="btn" href="/">Go to the review dashboard &rarr;</a>
           <form method="post" action="/batch/reset" style="display:inline;">
             <button type="submit" class="secondary">Start a new upload</button>
           </form>`;

    return `
      <div class="panel">
        <h2>Scrape — <span style="color:${stateColor}">${stateLabel}</span></h2>
        <p class="muted">Input: <code>${esc(status.inputPath)}</code> — ${elapsedNote}${status.exitCode != null ? ` (exit code ${status.exitCode})` : ""}</p>
        ${countsHtml}
        ${status.error ? `<p style="color:#991b1b;">Error: ${esc(status.error)}</p>` : ""}
        ${transformHtml}
        ${logHtml}
      </div>
      <div class="panel">${actions}</div>
      ${status.state === "running" ? '<meta http-equiv="refresh" content="3">' : ""}`;
}

function batchView({ status, pendingUpload, runSummary, notice }) {
    let body;
    if (status.state === "running" || status.state === "done" || status.state === "failed") {
        body = statusPanel(status, runSummary);
    } else if (pendingUpload) {
        body = pendingUploadPanel(pendingUpload);
    } else {
        body = uploadForm(notice);
    }

    return layout("Batch", `<p class="back-link"><a href="/">&larr; back to review dashboard</a></p>${body}`);
}

module.exports = { batchView };
