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

/** <i class="fa-solid fa-xxx"></i> — the one place the FA class prefix lives. */
function icon(name, extraClass) {
    return `<i class="fa-solid fa-${name}${extraClass ? ` ${extraClass}` : ""}" aria-hidden="true"></i>`;
}

const FA_CDN = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";

const STYLE = `
    :root {
        color-scheme: light;
        --bg: #eef1f5;
        --surface: #ffffff;
        --surface-sunken: #f8fafc;
        --border: #d0d7e2;
        --border-strong: #aab4c4;
        --text: #101828;
        --text-muted: #5b6472;
        --text-faint: #8a93a3;

        --brand: #0f766e;
        --brand-hover: #0b5c56;
        --brand-soft: #e3f3f1;

        --secondary: #43495a;
        --secondary-hover: #2f3444;

        --danger: #c0362c;
        --danger-hover: #9d2c24;
        --danger-soft: #fbeae8;

        --amber: #b45309;
        --amber-soft: #fdf1dc;
        --amber-border: #f0c988;

        --green: #166534;
        --green-soft: #e4f5e9;
        --green-border: #9bd8ae;

        --blue: #1d4ed8;
        --blue-soft: #e6edfc;
        --blue-border: #a9c0f5;

        --radius: 10px;
        --radius-sm: 6px;
    }
    * { box-sizing: border-box; }
    body {
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        margin: 0;
        background: var(--bg);
        color: var(--text);
        line-height: 1.45;
    }
    code {
        background: var(--surface-sunken);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 1px 5px;
        font-size: .92em;
    }

    /* ---------- header / nav ---------- */
    header {
        background: #101828;
        color: #fff;
        padding: 0 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 58px;
        border-bottom: 3px solid var(--brand);
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; color: #fff; text-decoration: none; }
    .brand .fa-spider { color: var(--brand); font-size: 19px; }
    nav.tabs { display: flex; align-items: center; gap: 4px; height: 100%; margin-left: 28px; }
    nav.tabs a {
        display: flex; align-items: center; gap: 8px;
        color: #b7bfcc; text-decoration: none; font-size: 14px; font-weight: 600;
        padding: 0 14px; height: 100%; border-bottom: 3px solid transparent;
        margin-bottom: -3px;
    }
    nav.tabs a:hover { color: #fff; }
    nav.tabs a.active { color: #fff; border-bottom-color: var(--brand); }
    .header-right { display: flex; align-items: center; }
    header .page-tag { color: #8a93a3; font-size: 13px; font-weight: 600; }
    .header-inner { display: flex; align-items: center; height: 100%; }

    main { padding: 24px; max-width: 1200px; margin: 0 auto; }

    /* ---------- cards ---------- */
    .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 18px 20px;
        margin-bottom: 18px;
    }
    .panel-header {
        display: flex; align-items: center; gap: 10px;
        margin: -18px -20px 16px; padding: 14px 20px;
        border-bottom: 1px solid var(--border);
        background: var(--surface-sunken);
        border-radius: var(--radius) var(--radius) 0 0;
    }
    .panel-header .fa-solid { color: var(--brand); font-size: 15px; width: 18px; text-align: center; }
    .panel-header h2 { margin: 0; font-size: 15px; }
    .panel-header .subtitle { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }
    .panel > h2:first-child { margin-top: 0; font-size: 15px; }
    .panel > h2:first-child .fa-solid { color: var(--brand); margin-right: 9px; }

    /* ---------- table ---------- */
    table { width: 100%; border-collapse: collapse; background: var(--surface); }
    th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; font-size: 14px; }
    th { background: var(--surface-sunken); font-size: 11.5px; text-transform: uppercase; color: var(--text-muted); letter-spacing: .05em; border-bottom: 1px solid var(--border-strong); }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--surface-sunken); }
    img.thumb { width: 46px; height: 46px; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-sunken); border: 1px solid var(--border); }

    /* ---------- status badges ---------- */
    .status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid transparent; }
    .status .fa-solid { font-size: 10px; }
    .status-draft { background: var(--amber-soft); color: var(--amber); border-color: var(--amber-border); }
    .status-reviewed { background: var(--green-soft); color: var(--green); border-color: var(--green-border); }
    .status-uploaded { background: var(--blue-soft); color: var(--blue); border-color: var(--blue-border); }
    .status-missing { background: var(--danger-soft); color: var(--danger); border-color: #f0c0bb; }

    /* ---------- notices ---------- */
    .notice { display: flex; align-items: flex-start; gap: 10px; border-radius: var(--radius); padding: 12px 16px; margin-bottom: 18px; border: 1px solid; font-size: 14px; }
    .notice .fa-solid { margin-top: 2px; }
    .notice-ok { background: var(--green-soft); color: var(--green); border-color: var(--green-border); }
    .notice-error { background: var(--danger-soft); color: var(--danger); border-color: #f0c0bb; }
    .notice-warn { background: var(--amber-soft); color: var(--amber); border-color: var(--amber-border); }

    /* ---------- forms ---------- */
    .field-group-label {
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
        color: var(--text-faint); margin: 22px 0 8px; padding-top: 14px; border-top: 1px solid var(--border);
    }
    .field-group-label:first-of-type { margin-top: 4px; padding-top: 0; border-top: none; }
    label { display: block; font-size: 12.5px; font-weight: 600; color: var(--text-muted); margin: 12px 0 5px; }
    input[type=text], input[type=number], textarea, select {
        width: 100%; padding: 9px 11px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
        font-size: 14px; font-family: inherit; background: var(--surface); color: var(--text);
    }
    input:focus, textarea:focus, select:focus { outline: 2px solid var(--brand); outline-offset: -1px; border-color: var(--brand); }
    input[type=file] { font-size: 14px; }
    textarea { min-height: 90px; resize: vertical; }
    .row { display: flex; gap: 16px; flex-wrap: wrap; }
    .row > div { flex: 1; min-width: 180px; }
    .checkbox-line { display: flex; align-items: center; gap: 8px; font-weight: normal; font-size: 14px; color: var(--text); cursor: pointer; }
    .checkbox-line input { width: auto; margin: 0; }

    /* ---------- buttons ---------- */
    button, .btn {
        display: inline-flex; align-items: center; gap: 8px;
        background: var(--brand); color: #fff; border: 1px solid var(--brand);
        padding: 9px 16px; border-radius: var(--radius-sm); font-size: 14px; font-weight: 600;
        cursor: pointer; text-decoration: none;
    }
    button:hover, .btn:hover { background: var(--brand-hover); border-color: var(--brand-hover); }
    button.secondary, .btn.secondary { background: var(--surface); color: var(--secondary); border-color: var(--border-strong); }
    button.secondary:hover, .btn.secondary:hover { background: var(--surface-sunken); border-color: var(--secondary); }
    button.danger, .btn.danger { background: var(--danger); border-color: var(--danger); }
    button.danger:hover, .btn.danger:hover { background: var(--danger-hover); border-color: var(--danger-hover); }
    button:disabled { opacity: .55; cursor: not-allowed; }

    .actions-cell { white-space: nowrap; text-align: right; }
    .icon-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; text-decoration: none;
        background: var(--surface-sunken); color: var(--secondary); border: 1px solid var(--border);
        border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; margin-left: 5px;
    }
    .icon-btn:hover { background: #eef1f5; border-color: var(--border-strong); }
    .icon-btn.danger { background: var(--danger-soft); color: var(--danger); border-color: #f0c0bb; }
    .icon-btn.danger:hover { background: #f6d6d2; }

    .fab {
        position: fixed; right: 24px; bottom: 24px; z-index: 60; border-radius: 999px;
        padding: 14px 22px; font-size: 14px; font-weight: 700;
        box-shadow: 0 4px 14px rgba(16, 24, 40, .28);
    }

    /* ---------- modal ---------- */
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(16, 24, 40, .55); align-items: center; justify-content: center; z-index: 100; padding: 20px; }
    .modal-backdrop.open { display: flex; }
    .modal-box { background: var(--bg); border: 1px solid var(--border-strong); border-radius: 12px; padding: 20px; max-width: 640px; width: 100%; max-height: 85vh; overflow: auto; }
    .modal-box .panel:last-child { margin-bottom: 0; }
    .modal-title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .modal-title-row h2 { margin: 0; font-size: 17px; display: flex; align-items: center; gap: 9px; }
    .modal-title-row h2 .fa-solid { color: var(--brand); }

    /* ---------- gallery ---------- */
    .gallery { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .gallery img { width: 110px; height: 110px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); display: block; }
    /* Fixed size lives on the wrapper, not just the <img> — if the image
       404s and its onerror hides it, the wrapper (and the remove button
       position:absolute inside it) must not collapse to 0x0, or the button
       becomes unreachable/overlaps its neighbors. */
    .gallery-item { position: relative; width: 110px; height: 110px; flex: none; cursor: grab; }
    .gallery-item img { width: 100%; height: 100%; }
    .gallery-item.dragging { opacity: .4; }
    .gallery-item__remove {
        position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0;
        line-height: 20px; text-align: center; border-radius: 50%;
        background: rgba(16, 24, 40, .72); color: #fff; font-size: 11px; border: none; cursor: pointer;
    }
    .gallery-item__remove:hover { background: var(--danger); }

    .price-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .price { font-size: 24px; font-weight: 800; }
    .mrp { text-decoration: line-through; color: var(--text-faint); }
    .discount { color: var(--green); font-weight: 700; }
    .rating { color: var(--amber); font-weight: 700; }
    .rating .fa-solid { font-size: 12px; }
    .muted { color: var(--text-muted); font-size: 13px; }
    .back-link { font-size: 13px; }
    .back-link a { color: var(--secondary); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .back-link a:hover { color: var(--brand); }

    /* ---------- row hover-preview card ---------- */
    .hover-card {
        display: none;
        position: fixed;
        z-index: 200;
        width: 300px;
        background: var(--surface);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius);
        box-shadow: 0 12px 32px rgba(16, 24, 40, .25);
        padding: 14px;
        pointer-events: none;
    }
    .hover-card h3 { margin: 0 0 8px; font-size: 14px; line-height: 1.35; }
    .hover-card .price-row { margin-bottom: 8px; }
    .hover-card .price { font-size: 18px; }
    .hover-card-images { display: flex; gap: 6px; margin-bottom: 10px; }
    .hover-card-images img { width: 62px; height: 62px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-sunken); }
    .hover-card-noimg {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        color: var(--text-faint); font-size: 12.5px; margin-bottom: 10px;
        background: var(--surface-sunken); border: 1px dashed var(--border-strong);
        border-radius: var(--radius-sm); padding: 16px;
    }
    .hover-card .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 0; }
    .hover-card .chip { background: var(--surface-sunken); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; font-size: 11.5px; color: var(--text-muted); }
    .hover-card .desc { font-size: 12.5px; color: var(--text-muted); margin-top: 8px; line-height: 1.4; }
`;

/**
 * type: "ok" | "error" | "warn". Shared banner used by every view instead of
 * each one hand-rolling its own inline pastel <div> — keeps colors/icons
 * consistent and means a palette change only happens in one place.
 */
function noticeBanner(notice) {
    if (!notice) return "";
    const cls = notice.type === "error" ? "notice-error" : notice.type === "warn" ? "notice-warn" : "notice-ok";
    const iconName = notice.type === "error" ? "circle-exclamation" : notice.type === "warn" ? "triangle-exclamation" : "circle-check";
    return `<div class="notice ${cls}">${icon(iconName)}<div>${notice.html ? notice.html : esc(notice.text)}</div></div>`;
}

function layout(title, bodyHtml, { active = null } = {}) {
    const navItem = (href, label, iconName, key) =>
        `<a href="${href}" class="${active === key ? "active" : ""}">${icon(iconName)} ${label}</a>`;

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${FA_CDN}" crossorigin="anonymous" referrerpolicy="no-referrer">
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="header-inner">
    <a href="/" class="brand">${icon("spider")} Product Scraper</a>
    <nav class="tabs">
      ${navItem("/", "Review", "table-list", "dashboard")}
      ${navItem("/batch", "Batch", "bolt", "batch")}
      ${navItem("/export-mongo", "Export", "database", "export")}
    </nav>
  </div>
  <div class="header-right"><span class="page-tag">${esc(title)}</span></div>
</header>
<main>${bodyHtml}</main>
</body>
</html>`;
}

module.exports = { layout, esc, jsAttr, icon, noticeBanner };
