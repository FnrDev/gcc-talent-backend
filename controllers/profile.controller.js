const mongoose = require("mongoose");
const User = require("../models/User");
const FreelancerProfile = require("../models/FreelancerProfile");
const ClientProfile = require("../models/ClientProfile");
const Contract = require("../models/Contract");
const Review = require("../models/Review");
const Service = require("../models/Service");
const Package = require("../models/Package");
const Job = require("../models/Job");
const Skill = require("../models/Skill");
const { recordAuditLog } = require("../services/audit.service");

const PUBLIC_PROFILE_LISTING_LIMIT = 6;
const PUBLIC_PROFILE_REVIEW_LIMIT = 10;
const MAX_PORTFOLIO_ITEMS = 20;

function isHttpUrl(value) {
    if (!value) return true;

    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function portfolioPayload(body, { partial = false } = {}) {
    const allowedFields = ["title", "description", "imageUrl", "link"];
    const payload = {};

    for (const field of allowedFields) {
        if (!Object.hasOwn(body, field)) continue;
        if (typeof body[field] !== "string") {
            return { error: `${field} must be text.` };
        }
        payload[field] = body[field].trim();
    }

    if (!partial && !payload.title) {
        return { error: "Portfolio title is required." };
    }
    if (Object.hasOwn(payload, "title") && !payload.title) {
        return { error: "Portfolio title cannot be empty." };
    }
    if (payload.imageUrl && !isHttpUrl(payload.imageUrl)) {
        return { error: "Portfolio image URL must use http or https." };
    }
    if (payload.link && !isHttpUrl(payload.link)) {
        return { error: "Portfolio link must use http or https." };
    }
    if (partial && Object.keys(payload).length === 0) {
        return { error: "Provide at least one portfolio field to update." };
    }

    return { payload };
}

function privateProfileUser(user) {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        country: user.country,
        city: user.city,
        ratingAvg: user.ratingAvg,
        ratingCount: user.ratingCount,
        isEmailVerified: user.isEmailVerified,
    };
}

async function getMyProfile(req, res) {
    try {
        const user = await User.findById(req.user._id).select(
            "name email role avatarUrl country city ratingAvg ratingCount isEmailVerified"
        );

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        let profile;

        if (user.role === "freelancer") {
            profile = await FreelancerProfile.findOne({ user: user._id }).populate("skills", "name category");

        } else if (user.role === "client") {
            profile = await ClientProfile.findOne({ user: user._id });

        } else {
            return res.status(400).json({ success: false, message: "Admins do not have a client or freelancer profile." });
        }

        if (!profile) {
            return res.status(404).json({ success: false, message: "Profile not found." });
        }

        return res.status(200).json({
            success: true,
            data: {
                user: privateProfileUser(user),
                profile
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
}

async function updateMyProfile(req, res) {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const locationFields = ["country", "city"];
        for (const field of locationFields) {
            if (!Object.hasOwn(req.body, field)) continue;
            if (typeof req.body[field] !== "string") {
                return res.status(400).json({ success: false, message: `${field} must be text.` });
            }
            const value = req.body[field].trim();
            if (value.length > 100) {
                return res.status(400).json({ success: false, message: `${field} must be 100 characters or fewer.` });
            }
            user[field] = value;
        }

        const userChangedFields = locationFields.filter((field) => user.isModified(field));

        if (user.role === "freelancer") {
            const {
                headline,
                bio,
                skills,
                hourlyRate,
                currency,
                languages,
                availability,
            } = req.body;

            const profile = await FreelancerProfile.findOne({ user: user._id });

            if (!profile) {
                return res.status(404).json({ success: false, message: "Freelancer profile not found." });
            }

            if (headline !== undefined) {
                if (typeof headline !== "string") return res.status(400).json({ success: false, message: "Headline must be text." });
                profile.headline = headline.trim();
            }
            if (bio !== undefined) {
                if (typeof bio !== "string") return res.status(400).json({ success: false, message: "Bio must be text." });
                profile.bio = bio.trim();
            }
            if (skills !== undefined) {
                if (!Array.isArray(skills) || skills.length > 50) {
                    return res.status(400).json({ success: false, message: "Skills must be an array with at most 50 items." });
                }
                const uniqueSkills = [...new Set(skills.map(String))];
                if (uniqueSkills.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
                    return res.status(400).json({ success: false, message: "One or more skills are invalid." });
                }
                const skillCount = await Skill.countDocuments({ _id: { $in: uniqueSkills } });
                if (skillCount !== uniqueSkills.length) {
                    return res.status(400).json({ success: false, message: "One or more skills are invalid." });
                }
                profile.skills = uniqueSkills;
            }
            if (hourlyRate !== undefined) profile.hourlyRate = hourlyRate;
            if (currency !== undefined) profile.currency = currency;
            if (languages !== undefined) {
                if (!Array.isArray(languages) || languages.length > 20 || languages.some((language) => (
                    !language || typeof language.name !== "string" || !language.name.trim() ||
                    (language.level !== undefined && typeof language.level !== "string")
                ))) {
                    return res.status(400).json({ success: false, message: "Languages must include a name and optional proficiency level." });
                }
                profile.languages = languages.map((language) => ({
                    name: language.name.trim(),
                    level: typeof language.level === "string" ? language.level.trim() : "",
                }));
            }
            if (availability !== undefined) profile.availability = availability;

            const changedFields = [
                "headline", "bio", "skills", "hourlyRate", "currency", "languages", "availability",
            ].filter((field) => profile.isModified(field));
            await profile.save();
            if (userChangedFields.length) await user.save();
            if (changedFields.length) {
                await recordAuditLog(req, {
                    action: "update",
                    resource: "FreelancerProfile",
                    resourceId: profile._id,
                    details: { operation: "updateMyProfile", changedFields },
                });
            }

            if (userChangedFields.length) {
                await recordAuditLog(req, {
                    action: "update",
                    resource: "User",
                    resourceId: user._id,
                    details: { operation: "updateMyProfileLocation", changedFields: userChangedFields },
                });
            }

            await profile.populate("skills", "name category");

            return res.status(200).json({
                success: true,
                message: "Freelancer profile updated successfully.",
                data: { user: privateProfileUser(user), profile }
            });
        }

        if (user.role === "client") {
            const {
                companyName,
                isCompany,
                description,
                website,
            } = req.body;

            const profile = await ClientProfile.findOne({ user: user._id, });

            if (!profile) {
                return res.status(404).json({ success: false, message: "Client profile not found." });
            }

            if (companyName !== undefined) {
                if (typeof companyName !== "string") return res.status(400).json({ success: false, message: "Company name must be text." });
                profile.companyName = companyName.trim();
            }
            if (isCompany !== undefined) {
                if (typeof isCompany !== "boolean") return res.status(400).json({ success: false, message: "Company type must be true or false." });
                profile.isCompany = isCompany;
            }
            if (description !== undefined) {
                if (typeof description !== "string") return res.status(400).json({ success: false, message: "Description must be text." });
                profile.description = description.trim();
            }
            if (website !== undefined) {
                if (typeof website !== "string" || !isHttpUrl(website.trim())) {
                    return res.status(400).json({ success: false, message: "Website must be an http or https URL." });
                }
                profile.website = website.trim();
            }

            const changedFields = ["companyName", "isCompany", "description", "website"]
                .filter((field) => profile.isModified(field));
            await profile.save();
            if (userChangedFields.length) await user.save();
            if (changedFields.length) {
                await recordAuditLog(req, {
                    action: "update",
                    resource: "ClientProfile",
                    resourceId: profile._id,
                    details: { operation: "updateMyProfile", changedFields },
                });
            }

            if (userChangedFields.length) {
                await recordAuditLog(req, {
                    action: "update",
                    resource: "User",
                    resourceId: user._id,
                    details: { operation: "updateMyProfileLocation", changedFields: userChangedFields },
                });
            }

            return res.status(200).json({
                success: true,
                message: "Client profile updated successfully.",
                data: { user: privateProfileUser(user), profile }
            });
        }

        return res.status(400).json({ success: false, message: "Admins do not have a client or freelancer profile." });

    } catch (err) {
        console.error(err);

        if (err.name === "ValidationError") {
            return res.status(400).json({ success: false, message: err.message });
        }

        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
}

async function createPortfolioItem(req, res) {
    try {
        const user = await User.findById(req.user._id).select("role");
        if (!user) return res.status(404).json({ success: false, message: "User not found." });
        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can manage portfolio items." });
        }

        const result = portfolioPayload(req.body);
        if (result.error) return res.status(400).json({ success: false, message: result.error });

        const profile = await FreelancerProfile.findOne({ user: user._id });
        if (!profile) return res.status(404).json({ success: false, message: "Freelancer profile not found." });
        if (profile.portfolio.length >= MAX_PORTFOLIO_ITEMS) {
            return res.status(409).json({ success: false, message: `Portfolio items are limited to ${MAX_PORTFOLIO_ITEMS}.` });
        }

        profile.portfolio.push(result.payload);
        const item = profile.portfolio[profile.portfolio.length - 1];
        await profile.save();
        await recordAuditLog(req, {
            action: "create",
            resource: "FreelancerProfile",
            resourceId: profile._id,
            details: { operation: "createPortfolioItem", portfolioItemId: item._id },
        });

        return res.status(201).json({
            success: true,
            message: "Portfolio item added successfully.",
            data: { item },
        });
    } catch (err) {
        if (err?.name === "ValidationError") {
            return res.status(400).json({ success: false, message: err.message });
        }
        console.error(err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
}

async function updatePortfolioItem(req, res) {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.itemId)) {
            return res.status(400).json({ success: false, message: "Invalid portfolio item id." });
        }

        const user = await User.findById(req.user._id).select("role");
        if (!user) return res.status(404).json({ success: false, message: "User not found." });
        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can manage portfolio items." });
        }

        const result = portfolioPayload(req.body, { partial: true });
        if (result.error) return res.status(400).json({ success: false, message: result.error });

        const profile = await FreelancerProfile.findOne({ user: user._id });
        if (!profile) return res.status(404).json({ success: false, message: "Freelancer profile not found." });

        const item = profile.portfolio.id(req.params.itemId);
        if (!item) return res.status(404).json({ success: false, message: "Portfolio item not found." });

        for (const [field, value] of Object.entries(result.payload)) item[field] = value;
        await profile.save();
        await recordAuditLog(req, {
            action: "update",
            resource: "FreelancerProfile",
            resourceId: profile._id,
            details: {
                operation: "updatePortfolioItem",
                portfolioItemId: item._id,
                changedFields: Object.keys(result.payload),
            },
        });

        return res.status(200).json({
            success: true,
            message: "Portfolio item updated successfully.",
            data: { item },
        });
    } catch (err) {
        if (err?.name === "ValidationError") {
            return res.status(400).json({ success: false, message: err.message });
        }
        console.error(err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
}

async function deletePortfolioItem(req, res) {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.itemId)) {
            return res.status(400).json({ success: false, message: "Invalid portfolio item id." });
        }

        const user = await User.findById(req.user._id).select("role");
        if (!user) return res.status(404).json({ success: false, message: "User not found." });
        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can manage portfolio items." });
        }

        const profile = await FreelancerProfile.findOne({ user: user._id });
        if (!profile) return res.status(404).json({ success: false, message: "Freelancer profile not found." });

        const item = profile.portfolio.id(req.params.itemId);
        if (!item) return res.status(404).json({ success: false, message: "Portfolio item not found." });

        item.deleteOne();
        await profile.save();
        await recordAuditLog(req, {
            action: "update",
            resource: "FreelancerProfile",
            resourceId: profile._id,
            details: { operation: "deletePortfolioItem", portfolioItemId: req.params.itemId },
        });

        return res.status(200).json({ success: true, message: "Portfolio item deleted successfully." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
}

function publicUserSummary(user) {
    return {
        _id: user._id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        country: user.country,
        city: user.city,
        ratingAvg: user.ratingAvg,
        ratingCount: user.ratingCount,
    };
}

async function getFreelancerListings(user) {
    const services = await Service.aggregate([
        { $match: { freelancer: user._id } },
        {
            $lookup: {
                from: Package.collection.name,
                let: { packageIds: "$packages", freelancerId: "$freelancer" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $in: ["$_id", "$$packageIds"] },
                                    { $eq: ["$freelancer", "$$freelancerId"] },
                                    { $eq: ["$isActive", true] },
                                ],
                            },
                        },
                    },
                    { $sort: { sortOrder: 1, price: 1, createdAt: 1 } },
                    {
                        $project: {
                            name: 1,
                            title: 1,
                            description: 1,
                            price: 1,
                            currency: 1,
                            deliveryDays: 1,
                            revisions: 1,
                            features: 1,
                            sortOrder: 1,
                        },
                    },
                ],
                as: "packages",
            },
        },
        { $match: { "packages.0": { $exists: true } } },
        {
            $set: {
                startingPrice: { $min: "$packages.price" },
                fastestDelivery: { $min: "$packages.deliveryDays" },
            },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        { $limit: PUBLIC_PROFILE_LISTING_LIMIT },
        {
            $project: {
                name: 1,
                images: 1,
                packages: 1,
                startingPrice: 1,
                fastestDelivery: 1,
                createdAt: 1,
                updatedAt: 1,
            },
        },
    ]);

    const freelancer = publicUserSummary(user);

    return services.map((service) => ({
        ...service,
        freelancer,
        ratingAvg: Number(user.ratingAvg || 0),
        ratingCount: Number(user.ratingCount || 0),
    }));
}

function getClientListings(userId) {
    return Job.find({ client: userId, status: "open", isHidden: false })
        .select("client category skills title description budgetType budgetMin budgetMax experienceLevel duration status deadline proposalsCount isFeatured createdAt updatedAt")
        .populate("client", "name avatarUrl country city ratingAvg ratingCount")
        .populate("category", "name slug")
        .populate("skills", "name category")
        .sort({ createdAt: -1, _id: -1 })
        .limit(PUBLIC_PROFILE_LISTING_LIMIT)
        .lean();
}

function getRecentReviews(userId) {
    return Review.find({ reviewee: userId })
        .select("contract reviewer reviewee rating comment createdAt updatedAt")
        .populate("reviewer", "name avatarUrl role ratingAvg ratingCount")
        .populate("contract", "title status")
        .sort({ createdAt: -1, _id: -1 })
        .limit(PUBLIC_PROFILE_REVIEW_LIMIT)
        .lean();
}

async function getPublicActivityStats(user) {
    if (user.role === "freelancer") {
        const completedContracts = await Contract.countDocuments({
            freelancer: user._id,
            status: "completed",
        });

        return { completed: completedContracts, completedContracts };
    }

    const [jobsPosted, hiredJobs] = await Promise.all([
        Job.countDocuments({ client: user._id, status: { $ne: "draft" } }),
        Job.countDocuments({ client: user._id, status: { $in: ["in_progress", "completed"] } }),
    ]);
    const hireRate = jobsPosted > 0 ? Math.round((hiredJobs / jobsPosted) * 100) : 0;

    return { completed: jobsPosted, jobsPosted, hiredJobs, hireRate };
}

async function getPublicProfile(req, res) {
    try {
        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid user id." });
        }

        const user = await User.findOne({ _id: userId, status: "active" }).select(
            "name role avatarUrl country city ratingAvg ratingCount isEmailVerified createdAt"
        );

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        let profile;

        if (user.role === "freelancer") {
            profile = await FreelancerProfile.findOne({ user: user._id }).populate("skills", "name category");

        } else if (user.role === "client") {
            profile = await ClientProfile.findOne({ user: user._id });

        } else {
            return res.status(400).json({ success: false, message: "Admins do not have a public marketplace profile." });
        }

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: user.role === "freelancer" ? "Freelancer profile not found." : "Client profile not found.",
            });
        }

        const isFreelancer = user.role === "freelancer";
        const [listings, reviews, activityStats] = await Promise.all([
            isFreelancer ? getFreelancerListings(user) : getClientListings(user._id),
            getRecentReviews(user._id),
            getPublicActivityStats(user),
        ]);

        const ratingAvg = Number(user.ratingAvg || 0);
        const reviewCount = Number(user.ratingCount || 0);
        const stats = {
            reviewCount,
            ratingAvg,
            ratingPercent: Math.round((ratingAvg / 5) * 100),
            ...activityStats,
        };
        // Public responses are an explicit allowlist rather than the whole
        // profile document. In particular, private freelancer earnings never
        // leave the authenticated account/dashboard APIs.
        const publicProfile = isFreelancer
            ? {
                headline: profile.headline,
                bio: profile.bio,
                skills: profile.skills,
                hourlyRate: profile.hourlyRate,
                currency: profile.currency,
                languages: profile.languages,
                availability: profile.availability,
                portfolio: profile.portfolio,
                completedContracts: activityStats.completedContracts,
            }
            : {
                companyName: profile.companyName,
                isCompany: profile.isCompany,
                description: profile.description,
                website: profile.website,
                jobsPosted: activityStats.jobsPosted,
                // Public marketplace trust signal used by the recovered
                // client-profile design; unlike wallet balances, it is an
                // aggregate of completed/funded work.
                totalSpent: profile.totalSpent,
                hireRate: activityStats.hireRate,
            };

        return res.status(200).json({
            success: true,
            data: { user, profile: publicProfile, listings, reviews, stats },
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
}

module.exports = {
    getMyProfile,
    updateMyProfile,
    createPortfolioItem,
    updatePortfolioItem,
    deletePortfolioItem,
    getPublicProfile,
};
