const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema(
    {
        freelancer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        title: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            trim: true,
        },

        price: {
            type: Number,
            required: true,
            min: 0,
        },

        currency: {
            type: String,
            enum: ["USD", "SAR", "AED", "BHD"],
            default: "USD",
        },

        deliveryDays: {
            type: Number,
            required: true,
            min: 1,
        },

        revisions: {
            type: Number,
            default: 0,
            min: 0,
        },

        features: [
            {
                type: String,
                trim: true,
            },
        ],

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        sortOrder: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

packageSchema.index({ freelancer: 1, sortOrder: 1 });

module.exports = mongoose.model("Package", packageSchema);