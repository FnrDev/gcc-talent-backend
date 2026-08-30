const User = require("../models/User");
const FreelancerProfile = require("../models/FreelancerProfile");
const ClientProfile = require("../models/ClientProfile");
const { recordAuditLog } = require("../services/audit.service");

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
                user: {
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
                },
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

        if (user.role === "freelancer") {
            const {
                headline,
                bio,
                skills,
                hourlyRate,
                currency,
                languages,
                availability,
                portfolio,
            } = req.body;

            const profile = await FreelancerProfile.findOne({ user: user._id });

            if (!profile) {
                return res.status(404).json({ success: false, message: "Freelancer profile not found." });
            }

            if (headline !== undefined) profile.headline = headline;
            if (bio !== undefined) profile.bio = bio;
            if (skills !== undefined) profile.skills = skills;
            if (hourlyRate !== undefined) profile.hourlyRate = hourlyRate;
            if (currency !== undefined) profile.currency = currency;
            if (languages !== undefined) profile.languages = languages;
            if (availability !== undefined) profile.availability = availability;
            if (portfolio !== undefined) profile.portfolio = portfolio;

            const changedFields = [
                "headline", "bio", "skills", "hourlyRate", "currency", "languages", "availability", "portfolio",
            ].filter((field) => profile.isModified(field));
            await profile.save();
            if (changedFields.length) {
                await recordAuditLog(req, {
                    action: "update",
                    resource: "FreelancerProfile",
                    resourceId: profile._id,
                    details: { operation: "updateMyProfile", changedFields },
                });
            }

            return res.status(200).json({
                success: true, message: "Freelancer profile updated successfully.", data: { profile }
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

            if (companyName !== undefined) profile.companyName = companyName;
            if (isCompany !== undefined) profile.isCompany = isCompany;
            if (description !== undefined) profile.description = description;
            if (website !== undefined) profile.website = website;

            const changedFields = ["companyName", "isCompany", "description", "website"]
                .filter((field) => profile.isModified(field));
            await profile.save();
            if (changedFields.length) {
                await recordAuditLog(req, {
                    action: "update",
                    resource: "ClientProfile",
                    resourceId: profile._id,
                    details: { operation: "updateMyProfile", changedFields },
                });
            }

            return res.status(200).json({
                success: true, message: "Client profile updated successfully.", data: { profile }
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

async function getPublicProfile(req, res) {
    try {
        const { userId } = req.params;

        const user = await User.findById(userId).select(
            "name role avatarUrl country city ratingAvg ratingCount isEmailVerified"
        );

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (user.role === "freelancer") {
            const profile = await FreelancerProfile.findOne({ user: user._id }).populate("skills", "name category");

            if (!profile) {
                return res.status(404).json({ success: false, message: "Freelancer profile not found." });
            }

            return res.status(200).json({ success: true, data: { user, profile } });
        }

        if (user.role === "client") {
            const profile = await ClientProfile.findOne({ user: user._id });

            if (!profile) {
                return res.status(404).json({ success: false, message: "Client profile not found." });
            }

            return res.status(200).json({
                success: true, data: { user, profile }
            });
        }

        return res.status(400).json({ success: false, message: "Admins do not have a public marketplace profile." });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
}

module.exports = {
    getMyProfile,
    updateMyProfile,
    getPublicProfile,
};
