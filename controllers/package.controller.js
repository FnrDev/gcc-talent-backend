const Package = require("../models/Package");
const User = require("../models/User");

const CURRENCIES = ["USD", "SAR", "AED", "BHD"];

function handleError(res, err) {
    if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, message: err.message });
    }

    if (err?.name === "CastError") {
        return res.status(404).json({ success: false, message: "Resource not found." });
    }

    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
}

function validateFeatures(features) {
    if (!Array.isArray(features)) {
        return "Features must be an array.";
    }

    if (features.some((feature) => typeof feature !== "string" || !feature.trim())) {
        return "Every feature must be a non-empty string.";
    }

    return null;
}

function validatePackageFields({ name, title, description, price, currency, deliveryDays, revisions, features, sortOrder }) {
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
        return "Package name must be a non-empty string.";
    }

    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
        return "Package title must be a non-empty string.";
    }

    if (description !== undefined && typeof description !== "string") {
        return "Package description must be a string.";
    }

    if (price !== undefined && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) {
        return "Package price must be a non-negative number.";
    }

    if (currency !== undefined && !CURRENCIES.includes(currency)) {
        return "Invalid package currency.";
    }

    if (deliveryDays !== undefined && (!Number.isInteger(deliveryDays) || deliveryDays < 1)) {
        return "Delivery days must be a positive whole number.";
    }

    if (revisions !== undefined && (!Number.isInteger(revisions) || revisions < 0)) {
        return "Revisions must be a non-negative whole number.";
    }

    if (features !== undefined) {
        const featureError = validateFeatures(features);

        if (featureError) {
            return featureError;
        }
    }

    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
        return "Sort order must be a non-negative whole number.";
    }

    return null;
}

async function createPackage(req, res) {
    try {
        const user = await User.findById(req.user._id).select("role status");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can create packages." });
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot create packages." });
        }

        const {
            name,
            title,
            description,
            price,
            currency,
            deliveryDays,
            revisions,
            features,
            sortOrder,
        } = req.body;

        if (name === undefined || title === undefined || price === undefined || deliveryDays === undefined) {
            return res.status(400).json({ success: false, message: "Name, title, price, and delivery days are required." });
        }

        const validationError = validatePackageFields({
            name,
            title,
            description,
            price,
            currency,
            deliveryDays,
            revisions,
            features,
            sortOrder,
        });

        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        const packageItem = await Package.create({
            freelancer: user._id,
            name: name.trim(),
            title: title.trim(),
            description: typeof description === "string" ? description.trim() : undefined,
            price,
            currency: currency || "USD",
            deliveryDays,
            revisions: revisions ?? 0,
            features: features ? features.map((feature) => feature.trim()) : [],
            sortOrder: sortOrder ?? 0,
        });

        return res.status(201).json({ success: true, message: "Package created successfully.", data: { package: packageItem } });

    } catch (err) {
        return handleError(res, err);
    }
}

async function getFreelancerPackages(req, res) {
    try {
        const freelancer = await User.findOne({
            _id: req.params.id,
            role: "freelancer",
            status: "active",
        }).select("_id name avatarUrl ratingAvg ratingCount");

        if (!freelancer) {
            return res.status(404).json({ success: false, message: "Freelancer not found." });
        }

        const packages = await Package.find({
            freelancer: freelancer._id,
            isActive: true,
        })
            .sort({ sortOrder: 1, price: 1, createdAt: 1 })
            .lean();

        return res.status(200).json({ success: true, data: { freelancer, packages } });

    } catch (err) {
        return handleError(res, err);
    }
}

async function getPackage(req, res) {
    try {
        const packageItem = await Package.findOne({
            _id: req.params.id,
            isActive: true,
        })
            .populate({
                path: "freelancer",
                match: {
                    role: "freelancer",
                    status: "active",
                },
                select: "name avatarUrl country city ratingAvg ratingCount isEmailVerified",
            })
            .lean();

        if (!packageItem || !packageItem.freelancer) {
            return res.status(404).json({ success: false, message: "Package not found." });
        }

        return res.status(200).json({ success: true, data: { package: packageItem } });

    } catch (err) {
        return handleError(res, err);
    }
}

async function getMyPackages(req, res) {
    try {
        const user = await User.findById(req.user._id).select("role");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can access their packages." });
        }

        const packages = await Package.find({
            freelancer: user._id,
        })
            .sort({ sortOrder: 1, price: 1, createdAt: 1 })
            .lean();

        return res.status(200).json({ success: true, data: { packages } });

    } catch (err) {
        return handleError(res, err);
    }
}

async function updatePackage(req, res) {
    try {
        const user = await User.findById(req.user._id).select("role status");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can update packages." });
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot update packages." });
        }

        const packageItem = await Package.findOne({
            _id: req.params.id,
            freelancer: user._id,
        });

        if (!packageItem) {
            return res.status(404).json({ success: false, message: "Package not found." });
        }

        const {
            name,
            title,
            description,
            price,
            currency,
            deliveryDays,
            revisions,
            features,
            isActive,
            sortOrder,
        } = req.body;

        const validationError = validatePackageFields({
            name,
            title,
            description,
            price,
            currency,
            deliveryDays,
            revisions,
            features,
            sortOrder,
        });

        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        if (isActive !== undefined && typeof isActive !== "boolean") {
            return res.status(400).json({ success: false, message: "isActive must be a boolean." });
        }

        if (name !== undefined) packageItem.name = name.trim();
        if (title !== undefined) packageItem.title = title.trim();
        if (description !== undefined) packageItem.description = description.trim();
        if (price !== undefined) packageItem.price = price;
        if (currency !== undefined) packageItem.currency = currency;
        if (deliveryDays !== undefined) packageItem.deliveryDays = deliveryDays;
        if (revisions !== undefined) packageItem.revisions = revisions;
        if (features !== undefined) packageItem.features = features.map((feature) => feature.trim());
        if (isActive !== undefined) packageItem.isActive = isActive;
        if (sortOrder !== undefined) packageItem.sortOrder = sortOrder;

        await packageItem.save();

        return res.status(200).json({ success: true, message: "Package updated successfully.", data: { package: packageItem } });

    } catch (err) {
        return handleError(res, err);
    }
}

async function deletePackage(req, res) {
    try {
        const user = await User.findById(req.user._id).select("role status");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can delete packages." });
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot delete packages." });
        }

        const packageItem = await Package.findOne({
            _id: req.params.id,
            freelancer: user._id,
        });

        if (!packageItem) {
            return res.status(404).json({ success: false, message: "Package not found." });
        }

        if (!packageItem.isActive) {
            return res.status(422).json({ success: false, message: "Package is already inactive." });
        }

        packageItem.isActive = false;

        await packageItem.save();

        return res.status(200).json({ success: true, message: "Package deleted successfully." });

    } catch (err) {
        return handleError(res, err);
    }
}

module.exports = {
    createPackage,
    getFreelancerPackages,
    getPackage,
    getMyPackages,
    updatePackage,
    deletePackage,
};