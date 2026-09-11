const { z } = require("zod");

const TraceEntry = z.object({
    field: z.string().optional(),
    source: z.enum(["json-ld", "api", "dom", "missing"]),
    selector: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    success: z.boolean(),
});

const ImageEntry = z.object({
    url: z.string(),
    path: z.string().nullable(),
    success: z.boolean(),
    hash: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
});

const ProductSchema = z.object({
    source: z.object({
        website: z.string(),
        url: z.string(),
    }),
    product: z.object({
        name: z.string().min(1, "product name is required"),
        brand: z.string().nullable().optional(),
        price: z.number().nullable().optional(),
        currency: z.string().nullable().optional(),
        sku: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
    }),
    variants: z.object({
        sizes: z.array(z.string()).default([]),
        colors: z.array(z.string()).default([]),
    }).optional(),
    // Arbitrary site-specific extra fields (material, availability, weight, ...),
    // each either a single string/null or a list of strings depending on the config.
    additionalInfo: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])).optional(),
    // How many image URLs extraction actually found on the page, before any
    // MAX_IMAGES_PER_PRODUCT cap was applied — lets you tell "site only had
    // 2 photos" apart from "we capped it at 10 out of 30".
    imagesFound: z.number().optional(),
    images: z.array(ImageEntry),
    trace: z.record(z.string(), TraceEntry),
    scrapedAt: z.string(),
});

/**
 * Throws a ZodError (with a readable message) if `product` doesn't match
 * the expected shape. Called right before writing product.json so a broken
 * selector produces a loud failure instead of a silently malformed file.
 */
function validateProduct(product) {
    return ProductSchema.parse(product);
}

module.exports = { validateProduct, ProductSchema };
