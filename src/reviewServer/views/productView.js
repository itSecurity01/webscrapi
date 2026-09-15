const { layout, esc, jsAttr } = require("./layout");

function productView(draft, imageEntries, { saved = false } = {}) {
    const meta = draft._meta;
    // draggable="true" is wired up to actually reorder in the script block
    // below; each item's own source-of-truth value lives in data-url (the
    // real URL that gets saved), while the <img> shows displayUrl (the
    // locally-cached copy when one exists, see resolveImageEntries()).
    const gallery = imageEntries.map(entry => `
        <div class="gallery-item" draggable="true" data-url="${esc(entry.url)}">
          <img src="${esc(entry.displayUrl)}" onerror="this.style.display='none'">
          <button type="button" class="gallery-item__remove" title="Remove image" onclick="removeGalleryImage(this)">✕</button>
        </div>`).join("");
    const deleteAction = `/product/${encodeURIComponent(meta.site)}/${encodeURIComponent(meta.slug)}/delete`;
    const confirmMsg = `Delete “${jsAttr(draft.name)}”? This permanently removes its scraped data (images, product.json, upload.json) from output/. This cannot be undone.`;

    const body = `
      <p class="back-link"><a href="/">&larr; back to all products</a></p>

      <div class="panel">
        <div class="row">
          <div style="flex:2;">
            <h2 style="margin-top:0;">${esc(draft.name)}</h2>
            <div class="price-row">
              <span class="price">₹${esc(draft.productPrice)}</span>
              <span class="mrp">₹${esc(draft.mrp)}</span>
              <span class="discount">${esc(draft.discount)}% off</span>
              <span class="rating">★ ${esc(draft.rating)}</span>
            </div>
            <p class="muted">SKU: ${esc(draft.vendorSku)} · Source: <a href="${esc(meta.sourceUrl)}" target="_blank" rel="noopener">👁️ ${esc(meta.site)}</a></p>
            <div class="gallery" id="gallery">${gallery}</div>
            <p class="muted" id="gallery-empty" ${imageEntries.length > 0 ? 'hidden' : ""}>No images. Drag to reorder, ✕ to remove — changes are saved when you click Save below.</p>
          </div>
          <div>
            <form method="post" action="${deleteAction}" onsubmit="return confirm('${confirmMsg}');">
              <button type="submit" class="danger">🗑️ Delete this product</button>
            </form>
          </div>
        </div>
      </div>

      ${saved ? '<div class="panel" style="background:#d1fae5;">Saved.</div>' : ""}

      <div class="panel">
        <h2>Edit before upload</h2>
        <form method="post" action="/product/${encodeURIComponent(meta.site)}/${encodeURIComponent(meta.slug)}">
          <div class="row">
            <div>
              <label>Name</label>
              <input type="text" name="name" value="${esc(draft.name)}">
            </div>
            <div>
              <label>Vendor SKU</label>
              <input type="text" name="vendorSku" value="${esc(draft.vendorSku)}">
            </div>
          </div>

          <div class="row">
            <div>
              <label>Price</label>
              <input type="number" step="0.01" name="productPrice" value="${esc(draft.productPrice)}">
            </div>
            <div>
              <label>MRP</label>
              <input type="number" step="0.01" name="mrp" value="${esc(draft.mrp)}">
            </div>
            <div>
              <label>Discount %</label>
              <input type="number" step="0.01" name="discount" value="${esc(draft.discount)}">
            </div>
            <div>
              <label>Rating</label>
              <input type="number" step="0.1" min="0" max="5" name="rating" value="${esc(draft.rating)}">
            </div>
          </div>

          <div class="row">
            <div>
              <label>Program (id)</label>
              <input type="text" name="program" value="${esc(draft.program)}" placeholder="program id">
            </div>
            <div>
              <label>Gender</label>
              <input type="text" name="gender" value="${esc(draft.gender)}" placeholder="men / women / kids (only these 3 are valid)">
            </div>
            <div>
              <label>Categories (comma-separated ids)</label>
              <input type="text" name="categories" value="${esc((draft.categories || []).join(", "))}" placeholder="cat_123, cat_456">
            </div>
          </div>

          <div class="row">
            <div>
              <label>Sizes (comma-separated)</label>
              <input type="text" name="productSizes" value="${esc((draft.productSizes || []).join(", "))}">
            </div>
            <div>
              <label>Colour (comma-separated)</label>
              <input type="text" name="colour" value="${esc((draft.colour || []).join(", "))}">
            </div>
          </div>

          <label>Vendor comment</label>
          <textarea name="vendorComment">${esc(draft.vendorComment)}</textarea>

          <label>Product description</label>
          <textarea name="productDescription">${esc(draft.productDescription)}</textarea>

          <label>Additional information</label>
          <textarea name="additionalInformation">${esc(draft.additionalInformation)}</textarea>

          <label>Main image URL</label>
          <input type="text" name="image" id="image-input" value="${esc(draft.image)}">

          <label>Sub images (one URL per line)</label>
          <textarea name="subImages" id="subimages-input" style="min-height:120px;">${esc((draft.subImages || []).join("\n"))}</textarea>
          <p class="muted" style="margin-top:4px;">Kept in sync with the gallery above (✕ to remove, drag to reorder) — or edit this list directly, e.g. to add a brand-new image URL.</p>

          <div style="margin-top:16px; display:flex; gap:10px; align-items:center;">
            <button type="submit" name="markReviewed" value="1">Save &amp; mark reviewed</button>
            <button type="submit" name="markReviewed" value="0" class="secondary">Save as draft</button>
            <span class="status status-${esc(meta.status)}">${esc(meta.status)}</span>
          </div>
        </form>
      </div>

      <script>
        var gallery = document.getElementById('gallery');
        var galleryEmpty = document.getElementById('gallery-empty');
        var imageInput = document.getElementById('image-input');
        var subImagesInput = document.getElementById('subimages-input');

        // Rewrites the existing Main image URL / Sub images fields from
        // whatever .gallery-item elements remain, in their current DOM
        // order — the same two fields the Save button already POSTs, so
        // removing/reordering here needs no new backend route; it's staged
        // until Save like every other field on this page.
        function syncImageFields() {
          var items = gallery.querySelectorAll('.gallery-item');
          var urls = Array.prototype.map.call(items, function (el) { return el.getAttribute('data-url'); });
          imageInput.value = urls[0] || '';
          subImagesInput.value = urls.slice(1).join('\\n');
          galleryEmpty.hidden = items.length > 0;
        }

        function removeGalleryImage(btn) {
          var item = btn.closest('.gallery-item');
          item.parentNode.removeChild(item);
          syncImageFields();
        }

        // Drag-and-drop reorder (desktop/mouse only — HTML5 DnD has no
        // native touch support). Dragging one .gallery-item over another
        // swaps it into that position; drop just commits the new order.
        var dragEl = null;

        gallery.addEventListener('dragstart', function (e) {
          var item = e.target.closest('.gallery-item');
          if (!item) return;
          dragEl = item;
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        gallery.addEventListener('dragover', function (e) {
          if (!dragEl) return;
          e.preventDefault();
          var target = e.target.closest('.gallery-item');
          if (!target || target === dragEl) return;

          var items = Array.prototype.slice.call(gallery.children);
          var dragIdx = items.indexOf(dragEl);
          var targetIdx = items.indexOf(target);
          gallery.insertBefore(dragEl, dragIdx < targetIdx ? target.nextSibling : target);
        });

        gallery.addEventListener('dragend', function () {
          if (!dragEl) return;
          dragEl.classList.remove('dragging');
          dragEl = null;
          syncImageFields();
        });
      </script>`;

    return layout(draft.name, body);
}

module.exports = { productView };
