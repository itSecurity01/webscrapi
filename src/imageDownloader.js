const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const pLimit = require("p-limit");

/**
 * Downloads `images` (array of absolute URLs) into `folder`, named 01.jpg, 02.jpg, ...
 * Validates each download (content-type, non-empty) and de-duplicates by
 * content hash so the same picture served from two CDN URLs isn't saved twice.
 *
 * Returns [{ url, path, success, hash, error }]
 */
async function downloadImages(images, folder, { concurrency = 5, rateLimiter = null } = {}) {
    const limit = pLimit(concurrency);
    const seenHashes = new Set();
    const results = new Array(images.length);

    await Promise.all(
        images.map((url, index) =>
            limit(async () => {
                const task = () => downloadOne(url, folder, index);
                const outcome = rateLimiter ? await rateLimiter.schedule(url, task) : await task();

                if (outcome.success && outcome.hash) {
                    if (seenHashes.has(outcome.hash)) {
                        // Duplicate image content (e.g. same photo at a different CDN size) — drop the file, keep the URL for traceability.
                        try { fs.unlinkSync(outcome.path); } catch {}
                        results[index] = { url, path: null, success: false, hash: outcome.hash, error: "duplicate-image-content" };
                        return;
                    }
                    seenHashes.add(outcome.hash);
                }

                results[index] = outcome;
            })
        )
    );

    return results;
}

async function downloadOne(url, folder, index) {
    const ext = guessExtension(url);
    const filename = `${String(index + 1).padStart(2, "0")}${ext}`;
    const filePath = path.join(folder, filename);

    try {
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 20000,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; product-scraper/1.0)" },
            validateStatus: (status) => status >= 200 && status < 300,
        });

        const contentType = response.headers["content-type"] || "";
        if (!contentType.startsWith("image/")) {
            return { url, path: null, success: false, error: `unexpected content-type: ${contentType}` };
        }

        const buffer = Buffer.from(response.data);
        if (buffer.length === 0) {
            return { url, path: null, success: false, error: "empty file" };
        }

        fs.writeFileSync(filePath, buffer);
        const hash = crypto.createHash("sha1").update(buffer).digest("hex");

        return { url, path: filePath, success: true, hash };
    } catch (error) {
        return { url, path: null, success: false, error: error.message };
    }
}

function guessExtension(url) {
    try {
        const pathname = new URL(url).pathname;
        const ext = path.extname(pathname).split("?")[0];
        if (ext && ext.length <= 5) return ext;
    } catch {}
    return ".jpg";
}

module.exports = { downloadImages };
