const { layout, esc } = require("./layout");

function statusBadge(status) {
    return `<span class="status status-${esc(status)}">${esc(status)}</span>`;
}

function row(draft, thumbUrl) {
    const meta = draft._meta;
    const key = `${meta.site}::${meta.slug}`;
    const editHref = `/product/${encodeURIComponent(meta.site)}/${encodeURIComponent(meta.slug)}`;

    return `
    <tr>
      <td><input type="checkbox" name="selected" value="${esc(key)}" form="bulk-form"></td>
      <td><img class="thumb" src="${esc(thumbUrl)}" onerror="this.style.visibility='hidden'"></td>
      <td><a href="${editHref}">${esc(draft.name)}</a><div class="muted">${esc(meta.site)} / ${esc(meta.slug)}</div></td>
      <td>₹${esc(draft.productPrice)} <span class="muted">(MRP ₹${esc(draft.mrp)})</span></td>
      <td>${esc(draft.discount)}%</td>
      <td>${esc(draft.program) || "<span class=\"muted\">—</span>"}</td>
      <td>${esc(draft.gender) || "<span class=\"muted\">—</span>"}</td>
      <td>${draft.categories && draft.categories.length ? esc(draft.categories.join(", ")) : "<span class=\"muted\">—</span>"}</td>
      <td>${statusBadge(meta.status)}</td>
      <td><a class="btn secondary" href="${editHref}">Edit</a></td>
    </tr>`;
}

function exportPanel(lastArchive, draftCount) {
    const archiveNote = lastArchive
        ? `<p class="muted">Last archived: ${lastArchive.productCount} product(s) &rarr; <code>${esc(lastArchive.batchDir)}</code> (${esc(lastArchive.archivedAt)})</p>`
        : "";

    return `
      <div class="panel">
        <h2>Export to Mongo</h2>
        <p class="muted" style="margin-top:-6px;">Combines every reviewed draft, converts <code>program</code>/<code>categories</code>/<code>userId</code> to real ObjectIds, and gives you a paste-into-mongosh file. Drafts already marked "uploaded" are skipped automatically.</p>
        <form method="post" action="/export-mongo">
          <div class="row">
            <div>
              <label>Site filter (optional)</label>
              <input type="text" name="site" placeholder="leave blank for all sites">
            </div>
            <div>
              <label>Format</label>
              <select name="format">
                <option value="shell">mongosh paste (ObjectId syntax)</option>
                <option value="json">Extended JSON (for mongoimport/Compass)</option>
              </select>
            </div>
          </div>
          <label style="margin-top:14px;">
            <input type="checkbox" name="includeUploaded" value="1" style="width:auto;display:inline-block;vertical-align:middle;">
            Include already-"uploaded" drafts too
          </label>
          <div style="margin-top:14px;">
            <button type="submit">Generate Mongo import</button>
          </div>
        </form>
      </div>
      <div class="panel">
        <h2>Archive this batch</h2>
        <p class="muted" style="margin-top:-6px;">Moves every scraped product out of <code>output/</code> (and resets <code>state/run.json</code>) into a timestamped <code>archive/</code> folder — nothing is deleted, just moved aside — so the next Excel file starts from a clean workspace.</p>
        ${archiveNote}
        <form method="post" action="/archive-batch" onsubmit="return confirm('Archive all ${draftCount} product(s) and clear the workspace for a new batch? Nothing is deleted \\u2014 it all moves into archive/.');">
          <button type="submit" class="secondary">Archive &amp; start new batch</button>
        </form>
      </div>`;
}

function dashboardView(drafts, resolveThumb, notice, lastArchive) {
    if (drafts.length === 0) {
        const noticeHtml = notice
            ? `<div class="panel" style="background:${notice.type === "error" ? "#fee2e2" : "#d1fae5"}; color:${notice.type === "error" ? "#991b1b" : "#065f46"};">${esc(notice.text)}</div>`
            : "";
        return layout("Upload Review", `
          ${noticeHtml}
          <div class="panel">
            <h2>No drafts found</h2>
            <p class="muted">Upload an Excel file and run a scrape from the <a href="/batch">Batch</a> page, then run <code>npm run transform</code> to generate upload.json drafts, then reload this page.</p>
          </div>`);
    }

    const rows = drafts.map(d => row(d, resolveThumb(d))).join("\n");

    const noticeHtml = notice
        ? `<div class="panel" style="background:${notice.type === "error" ? "#fee2e2" : "#d1fae5"}; color:${notice.type === "error" ? "#991b1b" : "#065f46"};">${esc(notice.text)}</div>`
        : "";

    const body = `
      ${noticeHtml}
      <div class="panel">
        <h2>Bulk-apply to selected</h2>
        <p class="muted" style="margin-top:-6px;">1. Tick the checkbox next to each product in the table below &nbsp;→&nbsp; 2. Fill in the field(s) to change &nbsp;→&nbsp; 3. Apply.</p>
        <form id="bulk-form" method="post" action="/bulk-apply" onsubmit="return validateBulkForm(this)">
          <div class="row">
            <div>
              <label>Program (id)</label>
              <input type="text" name="program" placeholder="leave blank to not change">
            </div>
            <div>
              <label>Gender</label>
              <input type="text" name="gender" placeholder="men / women / kids (only these 3 are valid)">
            </div>
            <div>
              <label>Categories (comma-separated ids)</label>
              <input type="text" name="categories" placeholder="cat_123, cat_456">
            </div>
          </div>
          <label style="margin-top:14px;">
            <input type="checkbox" name="markReviewed" value="1" checked style="width:auto;display:inline-block;vertical-align:middle;">
            Mark selected products as "reviewed" (ready to upload)
          </label>
          <div style="margin-top:14px; display:flex; align-items:center; gap:12px;">
            <button type="submit">Apply to selected</button>
            <span id="selected-count" class="muted">0 selected</span>
          </div>
        </form>
      </div>

      <div class="panel" style="padding:0;">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" onclick="document.querySelectorAll('input[name=selected]').forEach(c=>c.checked=this.checked); updateSelectedCount();"></th>
              <th></th>
              <th>Product</th>
              <th>Price</th>
              <th>Discount</th>
              <th>Program</th>
              <th>Gender</th>
              <th>Categories</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      ${exportPanel(lastArchive, drafts.length)}

      <script>
        function updateSelectedCount() {
          var n = document.querySelectorAll('input[name=selected]:checked').length;
          document.getElementById('selected-count').textContent = n + ' selected';
        }
        document.querySelectorAll('input[name=selected]').forEach(function (c) {
          c.addEventListener('change', updateSelectedCount);
        });
        updateSelectedCount();

        function validateBulkForm(form) {
          var n = document.querySelectorAll('input[name=selected]:checked').length;
          if (n === 0) {
            alert('Tick the checkbox next to at least one product before clicking Apply.');
            return false;
          }
          return true;
        }
      </script>`;

    return layout("Upload Review", body);
}

module.exports = { dashboardView };
