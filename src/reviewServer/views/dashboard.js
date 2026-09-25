const { layout, esc, jsAttr, icon, noticeBanner } = require("./layout");

const STATUS_ICON = { draft: "pen", reviewed: "check", uploaded: "cloud-arrow-up", missing: "triangle-exclamation" };

function statusBadge(status) {
    const iconName = STATUS_ICON[status] || "circle";
    return `<span class="status status-${esc(status)}">${icon(iconName)} ${esc(status)}</span>`;
}

/**
 * Payload for the row's on-hover preview card — kept small (capped image
 * list, truncated description) since it's inlined into every row's
 * data-preview attribute rather than fetched on demand.
 */
function buildPreview(draft, images) {
    return {
        name: draft.name || "",
        price: draft.productPrice,
        mrp: draft.mrp,
        discount: draft.discount,
        rating: draft.rating,
        sizes: draft.productSizes || [],
        colour: draft.colour || [],
        description: (draft.productDescription || "").slice(0, 220),
        images: images.slice(0, 4),
    };
}

function row(draft, images) {
    const meta = draft._meta;
    const key = `${meta.site}::${meta.slug}`;
    const editHref = `/product/${encodeURIComponent(meta.site)}/${encodeURIComponent(meta.slug)}`;
    const deleteAction = `${editHref}/delete`;
    const sourceUrl = meta.sourceUrl || "";
    const confirmMsg = `Delete “${jsAttr(draft.name)}”? This permanently removes its scraped data (images, product.json, upload.json) from output/. This cannot be undone.`;
    const thumbUrl = images[0] || "";
    const hasImage = Boolean(thumbUrl);
    const previewAttr = esc(JSON.stringify(buildPreview(draft, images)));

    return `
    <tr class="hoverable" data-preview="${previewAttr}">
      <td><input type="checkbox" name="selected" value="${esc(key)}" form="bulk-form" data-has-image="${hasImage ? "1" : "0"}"></td>
      <td>${hasImage
            ? `<img class="thumb" src="${esc(thumbUrl)}" onerror="markThumbMissing(this)">`
            : `<span class="status status-missing">${icon("triangle-exclamation")} no image</span>`}</td>
      <td><a href="${editHref}">${esc(draft.name)}</a><div class="muted">${esc(meta.site)} / ${esc(meta.slug)}</div></td>
      <td>₹${esc(draft.productPrice)} <span class="muted">(MRP ₹${esc(draft.mrp)})</span></td>
      <td>${esc(draft.discount)}%</td>
      <td>${esc(draft.program) || "<span class=\"muted\">—</span>"}</td>
      <td>${esc(draft.gender) || "<span class=\"muted\">—</span>"}</td>
      <td>${draft.categories && draft.categories.length ? esc(draft.categories.join(", ")) : "<span class=\"muted\">—</span>"}</td>
      <td>${statusBadge(meta.status)}</td>
      <td class="actions-cell">
        ${sourceUrl ? `<a class="icon-btn" href="${esc(sourceUrl)}" target="_blank" rel="noopener" title="Open original product page">${icon("arrow-up-right-from-square")}</a>` : ""}
        <a class="icon-btn" href="${editHref}" title="Edit">${icon("pen")}</a>
        <form method="post" action="${deleteAction}" style="display:inline;" onsubmit="return confirm('${confirmMsg}');">
          <button type="submit" class="icon-btn danger" title="Delete this product">${icon("trash")}</button>
        </form>
      </td>
    </tr>`;
}

function exportPanel(lastArchive, draftCount) {
    const archiveNote = lastArchive
        ? `<p class="muted">Last archived: ${lastArchive.productCount} product(s) &rarr; <code>${esc(lastArchive.batchDir)}</code> (${esc(lastArchive.archivedAt)})</p>`
        : "";

    return `
      <div class="panel">
        <div class="panel-header">${icon("database")}<h2>Export to Mongo</h2></div>
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
          <label class="checkbox-line" style="margin-top:14px;">
            <input type="checkbox" name="includeUploaded" value="1">
            Include already-"uploaded" drafts too
          </label>
          <div style="margin-top:14px;">
            <button type="submit">${icon("file-export")} Generate Mongo import</button>
          </div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-header">${icon("box-archive")}<h2>Archive this batch</h2></div>
        <p class="muted" style="margin-top:-6px;">Moves every scraped product out of <code>output/</code> (and resets <code>state/run.json</code>) into a timestamped <code>archive/</code> folder — nothing is deleted, just moved aside — so the next Excel file starts from a clean workspace.</p>
        ${archiveNote}
        <form method="post" action="/archive-batch" onsubmit="return confirm('Archive all ${draftCount} product(s) and clear the workspace for a new batch? Nothing is deleted \\u2014 it all moves into archive/.');">
          <button type="submit" class="secondary">${icon("box-archive")} Archive &amp; start new batch</button>
        </form>
      </div>`;
}

function dashboardView(drafts, resolveImages, notice, lastArchive) {
    if (drafts.length === 0) {
        return layout("Review", `
          ${noticeBanner(notice)}
          <div class="panel">
            <div class="panel-header">${icon("inbox")}<h2>No drafts found</h2></div>
            <p class="muted">Upload an Excel file and run a scrape from the <a href="/batch">Batch</a> page, then run <code>npm run transform</code> to generate upload.json drafts, then reload this page.</p>
          </div>`, { active: "dashboard" });
    }

    const rows = drafts.map(d => row(d, resolveImages(d))).join("\n");

    const body = `
      ${noticeBanner(notice)}
      <div class="panel">
        <div class="panel-header">${icon("list-check")}<h2>Bulk-apply / delete selected</h2></div>
        <p class="muted" style="margin-top:-6px;">1. Tick the checkbox next to each product in the table below (or use a quick-select button) &nbsp;→&nbsp; 2. Fill in field(s) and Apply, or just Delete the selection.</p>
        <div style="margin-bottom:14px;">
          <button type="button" class="secondary" onclick="selectMissingImages()">${icon("image")} Select products missing images</button>
        </div>
        <form id="bulk-form" method="post" action="/bulk-apply" onsubmit="return validateBulkForm(this)">
          <div class="field-group-label">Apply to selected</div>
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
          <label class="checkbox-line" style="margin-top:14px;">
            <input type="checkbox" name="markReviewed" value="1" checked>
            Mark selected products as "reviewed" (ready to upload)
          </label>
          <div style="margin-top:14px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <button type="submit">${icon("check")} Apply to selected</button>
            <button type="submit" formaction="/bulk-delete" formnovalidate class="danger" onclick="return confirmBulkDelete()">${icon("trash")} Delete selected</button>
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

      <button type="button" class="fab" onclick="document.getElementById('exportModal').classList.add('open')" title="Export to Mongo, or archive this batch">${icon("box-archive")} Export &amp; Archive</button>

      <div id="exportModal" class="modal-backdrop" onclick="if (event.target === this) this.classList.remove('open')">
        <div class="modal-box">
          <div class="modal-title-row">
            <h2>${icon("box-archive")} Export &amp; Archive</h2>
            <button type="button" class="secondary" onclick="document.getElementById('exportModal').classList.remove('open')">${icon("xmark")} Close</button>
          </div>
          ${exportPanel(lastArchive, drafts.length)}
        </div>
      </div>

      <div id="hoverCard" class="hover-card"></div>

      <script>
        function markThumbMissing(img) {
          img.parentElement.innerHTML = '<span class="status status-missing"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> no image</span>';
        }

        // ---- row hover-preview card ----
        // Populated from each <tr>'s data-preview JSON (embedded at render
        // time, see buildPreview() server-side) rather than fetched on
        // hover, so the preview appears instantly with no request.
        var hoverCard = document.getElementById('hoverCard');

        function escHtml(s) {
          var d = document.createElement('div');
          d.textContent = s == null ? '' : String(s);
          return d.innerHTML;
        }

        function renderHoverCard(data) {
          var imagesHtml = data.images && data.images.length
            ? '<div class="hover-card-images">' + data.images.map(function (u) {
                return '<img src="' + escHtml(u) + '" onerror="this.style.display=\\'none\\'">';
              }).join('') + '</div>'
            : '<div class="hover-card-noimg"><i class="fa-solid fa-image" aria-hidden="true"></i>&nbsp;No image</div>';

          var priceHtml = '<div class="price-row">'
            + '<span class="price">₹' + escHtml(data.price) + '</span>'
            + (data.mrp ? '<span class="mrp">₹' + escHtml(data.mrp) + '</span>' : '')
            + (data.discount ? '<span class="discount">' + escHtml(data.discount) + '% off</span>' : '')
            + (data.rating ? '<span class="rating"><i class="fa-solid fa-star" aria-hidden="true"></i> ' + escHtml(data.rating) + '</span>' : '')
            + '</div>';

          var chips = [].concat(data.sizes || [], data.colour || []);
          var chipsHtml = chips.length
            ? '<div class="chips">' + chips.map(function (c) { return '<span class="chip">' + escHtml(c) + '</span>'; }).join('') + '</div>'
            : '';

          var descHtml = data.description ? '<div class="desc">' + escHtml(data.description) + '</div>' : '';

          hoverCard.innerHTML = imagesHtml + '<h3>' + escHtml(data.name) + '</h3>' + priceHtml + chipsHtml + descHtml;
        }

        function positionHoverCard(e) {
          var pad = 14;
          var x = e.clientX + 20;
          var y = e.clientY + 20;
          var maxX = window.innerWidth - hoverCard.offsetWidth - pad;
          var maxY = window.innerHeight - hoverCard.offsetHeight - pad;
          if (x > maxX) x = e.clientX - hoverCard.offsetWidth - 20;
          if (y > maxY) y = e.clientY - hoverCard.offsetHeight - 20;
          hoverCard.style.left = Math.max(pad, x) + 'px';
          hoverCard.style.top = Math.max(pad, y) + 'px';
        }

        document.querySelectorAll('tr.hoverable').forEach(function (tr) {
          tr.addEventListener('mouseenter', function (e) {
            var data;
            try { data = JSON.parse(tr.dataset.preview); } catch (err) { return; }
            renderHoverCard(data);
            hoverCard.style.display = 'block';
            positionHoverCard(e);
          });
          tr.addEventListener('mousemove', positionHoverCard);
          tr.addEventListener('mouseleave', function () {
            hoverCard.style.display = 'none';
          });
        });

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
            alert('Tick the checkbox next to at least one product first.');
            return false;
          }
          return true;
        }

        function selectMissingImages() {
          var found = 0;
          document.querySelectorAll('input[name=selected]').forEach(function (c) {
            var missing = c.dataset.hasImage === '0';
            c.checked = missing;
            if (missing) found++;
          });
          updateSelectedCount();
          if (found === 0) alert('No products are currently missing images.');
        }

        function confirmBulkDelete() {
          var n = document.querySelectorAll('input[name=selected]:checked').length;
          if (n === 0) {
            alert('Tick the checkbox next to at least one product first.');
            return false;
          }
          return confirm('Delete ' + n + ' selected product(s)? This permanently removes their scraped data (images, product.json, upload.json) from output/. This cannot be undone.');
        }

        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') document.getElementById('exportModal').classList.remove('open');
        });
      </script>`;

    return layout("Review", body, { active: "dashboard" });
}

module.exports = { dashboardView };
