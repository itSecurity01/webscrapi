const { layout, esc } = require("./layout");

function productView(draft, imageUrls, { saved = false } = {}) {
    const meta = draft._meta;
    const gallery = imageUrls.map(u => `<img src="${esc(u)}" onerror="this.style.display='none'">`).join("");

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
            <p class="muted">SKU: ${esc(draft.vendorSku)} · Source: <a href="${esc(meta.sourceUrl)}" target="_blank" rel="noopener">${esc(meta.site)}</a></p>
            <div class="gallery">${gallery || '<span class="muted">No images</span>'}</div>
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
              <input type="text" name="gender" value="${esc(draft.gender)}" placeholder="Men / Women / Unisex">
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
          <input type="text" name="image" value="${esc(draft.image)}">

          <label>Sub images (one URL per line)</label>
          <textarea name="subImages" style="min-height:120px;">${esc((draft.subImages || []).join("\n"))}</textarea>

          <div style="margin-top:16px; display:flex; gap:10px; align-items:center;">
            <button type="submit" name="markReviewed" value="1">Save &amp; mark reviewed</button>
            <button type="submit" name="markReviewed" value="0" class="secondary">Save as draft</button>
            <span class="status status-${esc(meta.status)}">${esc(meta.status)}</span>
          </div>
        </form>
      </div>`;

    return layout(draft.name, body);
}

module.exports = { productView };
