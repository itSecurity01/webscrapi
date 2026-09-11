/**
 * Copied verbatim from the target backend's campaignSchema so
 * src/uploadToMongo.js can validate/insert through the real Mongoose model
 * (casting program/categories strings to actual ObjectId instances, running
 * enum/required checks, etc.) instead of writing raw documents that skip all
 * of that. Keep this in sync if the backend schema changes.
 */
const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema({
    toolType: {
        type: String,
        required: true,
        enum: ["saleIntegration", "singleActionIntegration", "multiActionIntegration", "clickIntegration", "storeIntegration"],
        default: "saleIntegration",
        trim: true
    },
    campaignType: {
        type: String,
        required: true,
        enum: ["bannerCampaign", "textCampaign", "linkCampaign", "videoCampaign", "storeCampaign"],
        trim: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        trim: true
    },
    toolIntegrationPlugin: {
        type: String,
        trim: true
    },
    toolPeriod: {
        type: String,
        trim: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    campaignTargetLink: {
        type: String,
        trim: true
    },
    mrp: {
        type: Number,
        min: 0
    },
    productPrice: {
        type: Number,
        min: 0
    },
    linkCopy: {
        type: Number,
        min: 0,
        default : 0
    },
    linkOpen: {
        type: Number,
        min: 0,
        default : 0
    },
    linkTitle: {
        type: String,
        trim: true
    },
    terms: {
        type: String,
        trim: true
    },
    categories: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            trim: true
        }
    ],
    vendorComment: {
        type: String,
        trim: true
    },
    image: {
        type: String, // URL or file path
        trim: true
    },
    allowForAffiliate: {
        type: String,
        enum: ["all", "selected"],
        default: "all"
    },
    selectedAffiliates: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user" // Assuming the affiliate users are stored in the User collection
        }
    ],
    status: {
        type: String,
        enum: ["in review", "draft", "public"],
        default: "public"
    },
    program: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MarketingProgram",
        required: true
    },
    content: {
        type: String,
        trim: true
    },
    textSize: {
        type: String,
        trim: true
    },
    textColor: {
        type: String,
        trim: true
    },
    backgroundColor: {
        type: String,
        trim: true
    },
    bannerImage: {
        type: String,
        trim: true
    },
    campaignHeight: {
        type: String,
        trim: true
    },
    campaignWidth: {
        type: String,
        trim: true
    },
    videoLink: {
        type: String,
        trim: true
    },
    buttonText: {
        type: String,
        trim: true
    },
    productSizes: {
        type: [String], // store campaign
    },
    colour: {
        type: [String], // Array of colors
    },
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
    },
    discount: {
        type: Number,
        default: 0, // Percentage discount (e.g., 10 for 10%)
        min: 0,
        max: 100,
    },
    subImages: {
        type: [String], // Array of image URLs/paths
        default: [],
    },
    onSale: {
        type: Boolean,
        trim: true
    },
    featured: {
        type: Boolean,
        trim: true
    },
    gender: {
        type: String,
        enum: ["men", "women", "kids"],
        trim: true
    },
    productDescription: {
        type: String,
        trim: true
    },
    additionalInformation: {
        type: String,
        trim: true
    },
    vendorSku: {
        type: String,
        trim: true
    },
    stock: {
        type: Boolean,
        default: true
    },
    trendyType: {
        type: String,
        trim: true,
        // enum : ["topRated", "newArrival", "bestSeller"]
    },
    url: {
        type: String
    },
    isThirdParty: {
        type: Boolean,
        default: false
    },
    ThirdPartyCampaignDetails:{
        type: Object
    }
}, { timestamps: true });


campaignSchema.pre("deleteOne", { document: true, query: false }, function (next) {
    next(new Error("Document delete is blocked"));
});

campaignSchema.pre("deleteOne", { document: false, query: true }, function (next) {
    next(new Error("Query delete is blocked"));
});

campaignSchema.pre("findOneAndDelete", function (next) {
    next(new Error("findOneAndDelete is blocked"));
});

campaignSchema.pre("findByIdAndDelete", function (next) {
    next(new Error("findByIdAndDelete is blocked"));
});

module.exports = mongoose.model("campaign", campaignSchema);
