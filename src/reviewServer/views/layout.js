function esc(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Escapes a value for safe embedding inside a single-quoted JS string
 * literal that itself sits inside an HTML attribute, e.g.
 * `onsubmit="return confirm('Delete ${jsAttr(name)}?')"`. Apply this
 * instead of esc() whenever the interpolated value (a product name, in
 * practice) isn't a value you control — a stray apostrophe in it would
 * otherwise terminate the confirm('...') string early and, since a thrown
 * JS error in an onsubmit handler doesn't stop the form submitting, that
 * silently skips the confirmation entirely.
 * Escape order matters: JS-escape first (so the browser's JS parser sees a
 * literal quote/backslash), then esc() the result (so the browser's HTML
 * parser hands the attribute value through unmangled) — the two decode in
 * reverse order as the browser processes them.
 */
function jsAttr(value) {
    return esc(String(value == null ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, "\\n"));
}

const STYLE = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f4f5f7; color: #1c1e21; }
    header { background: #1c1e21; color: #fff; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
    header a { color: #fff; text-decoration: none; font-weight: 600; }
    main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; vertical-align: middle; font-size: 14px; }
    th { background: #fafafa; font-size: 12px; text-transform: uppercase; color: #666; letter-spacing: .04em; }
    tr:last-child td { border-bottom: none; }
    img.thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; background: #eee; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .status-draft { background: #fef3c7; color: #92400e; }
    .status-reviewed { background: #d1fae5; color: #065f46; }
    .status-uploaded { background: #dbeafe; color: #1e40af; }
    .panel { background: #fff; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .panel h2 { margin-top: 0; font-size: 15px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #555; margin: 12px 0 4px; }
    input[type=text], input[type=number], textarea, select { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; font-family: inherit; }
    textarea { min-height: 90px; resize: vertical; }
    .row { display: flex; gap: 16px; flex-wrap: wrap; }
    .row > div { flex: 1; min-width: 180px; }
    button, .btn { background: #2563eb; color: #fff; border: none; padding: 9px 16px; border-radius: 6px; font-size: 14px; cursor: pointer; text-decoration: none; display: inline-block; }
    button.secondary, .btn.secondary { background: #6b7280; }
    button.danger, .btn.danger { background: #dc2626; }
    .actions-cell { white-space: nowrap; text-align: right; }
    .icon-btn { display: inline-block; text-decoration: none; background: #eef0f3; color: #1c1e21; border: none; padding: 6px 9px; border-radius: 6px; font-size: 14px; cursor: pointer; margin-left: 4px; line-height: 1; }
    .icon-btn:hover { background: #e2e5ea; }
    .icon-btn.danger { background: #fee2e2; }
    .icon-btn.danger:hover { background: #fecaca; }
    .fab { position: fixed; right: 24px; bottom: 24px; z-index: 60; border-radius: 999px; padding: 13px 20px; box-shadow: 0 6px 20px rgba(0,0,0,.3); font-size: 14px; }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); align-items: center; justify-content: center; z-index: 100; padding: 20px; }
    .modal-backdrop.open { display: flex; }
    .modal-box { background: #f4f5f7; border-radius: 12px; padding: 20px; max-width: 640px; width: 100%; max-height: 85vh; overflow: auto; }
    .modal-box .panel:last-child { margin-bottom: 0; }
    .gallery { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .gallery img { width: 110px; height: 110px; object-fit: cover; border-radius: 8px; border: 1px solid #eee; display: block; }
    .gallery-item { position: relative; cursor: grab; }
    .gallery-item.dragging { opacity: .4; }
    .gallery-item__remove { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; line-height: 20px; text-align: center; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 13px; border: none; cursor: pointer; }
    .gallery-item__remove:hover { background: #dc2626; }
    .price-row { display: flex; align-items: baseline; gap: 10px; }
    .price { font-size: 22px; font-weight: 700; }
    .mrp { text-decoration: line-through; color: #999; }
    .discount { color: #16a34a; font-weight: 600; }
    .rating { color: #b45309; font-weight: 600; }
    .muted { color: #888; font-size: 13px; }
    .back-link { font-size: 13px; }
`;

function layout(title, bodyHtml) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div><a href="/">Upload Review</a> &nbsp;·&nbsp; <a href="/batch">Batch</a></div>
  <span class="muted" style="color:#ccc">${esc(title)}</span>
</header>
<main>${bodyHtml}</main>
</body>
</html>`;
}

module.exports = { layout, esc, jsAttr };
