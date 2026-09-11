function parseCliArgs(argv = process.argv.slice(2)) {
    const args = {
        limit: null,
        website: null,
        headed: false,
        dryRun: false,
        force: false,
        skipImages: /^(1|true)$/i.test(process.env.SKIP_IMAGES || ""),
        input: process.env.INPUT_XLSX || "input/products.xlsx",
    };

    for (const arg of argv) {
        if (arg.startsWith("--limit=")) args.limit = parseInt(arg.split("=")[1], 10);
        else if (arg.startsWith("--website=")) args.website = arg.split("=")[1];
        else if (arg.startsWith("--input=")) args.input = arg.split("=")[1];
        else if (arg === "--headed") args.headed = true;
        else if (arg === "--dry-run") args.dryRun = true;
        else if (arg === "--force") args.force = true;
        else if (arg === "--skip-images") args.skipImages = true;
    }

    return args;
}

module.exports = { parseCliArgs };
