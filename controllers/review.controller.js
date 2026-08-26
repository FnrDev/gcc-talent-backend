const mongoose = require("mongoose")
const Review = require("../models/Review")
const Contract = require("../models/Contract")
const User = require("../models/User")

function handleError(res, err) {
    if (err?.code === 11000) {
        return res.status(409).json({ success: false, message: "You have already reviewed this contract." })
    }

    if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, message: err.message })
    }

    if (err?.name === "CastError") {
        return res.status(404).json({ success: false, message: "Resource not found." })
    }

    console.error(err)
    return res.status(500).json({ success: false, message: "Internal Server Error" })
}

async function createReview(req, res) {
    const session = await mongoose.startSession()

    try {
        const { rating, comment } = req.body

        if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be a whole number between 1 and 5." })
        }

        if (comment !== undefined && typeof comment !== "string") {
            return res.status(400).json({ success: false, message: "Comment must be a string." })
        }

        const user = await User.findById(req.user._id).select("status")

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot leave reviews." })
        }

        const contract = await Contract.findById(req.params.id)

        if (!contract) {
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (!["completed", "cancelled"].includes(contract.status)) {
            return res.status(422).json({ success: false, message: "Reviews can only be submitted after a contract has ended." })
        }

        const currentUserId = String(req.user._id)
        const clientId = String(contract.client)
        const freelancerId = String(contract.freelancer)

        if (currentUserId !== clientId && currentUserId !== freelancerId) {
            return res.status(403).json({ success: false, message: "Only contract participants can leave a review." })
        }

        const revieweeId = currentUserId === clientId ? contract.freelancer : contract.client

        const existingReview = await Review.exists({ contract: contract._id, reviewer: req.user._id })

        if (existingReview) {
            return res.status(409).json({ success: false, message: "You have already reviewed this contract." })
        }

        session.startTransaction()

        const [review] = await Review.create([{
            contract: contract._id,
            reviewer: req.user._id,
            reviewee: revieweeId,
            rating,
            comment: typeof comment === "string" ? comment.trim() : undefined
        }], { session })

        const ratingStats = await Review.aggregate([
            {
                $match: {reviewee: new mongoose.Types.ObjectId(revieweeId)}
            },
            {
                $group: {
                    _id: "$reviewee",
                    ratingAvg: { $avg: "$rating" },
                    ratingCount: { $sum: 1 },
                },
            },
        ]).session(session)

        const stats = ratingStats[0]

        await User.updateOne(
            { _id: revieweeId },
            {
                $set: {
                    ratingAvg: stats ? Math.round(stats.ratingAvg * 100) / 100 : 0,
                    ratingCount: stats ? stats.ratingCount : 0,
                },
            },
            { session }
        )

        await session.commitTransaction()

        const populatedReview = await Review.findById(review._id)
            .populate("reviewer", "name avatarUrl role")
            .populate("reviewee", "name avatarUrl role")
            .populate("contract", "title status")

        return res.status(201).json({ success: true, message: "Review submitted successfully.", data: { review: populatedReview } })

    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }

        return handleError(res, err)

    } finally {
        await session.endSession()
    }
}

async function getUserReviews(req, res) {
    try {
        const { page = 1, limit = 20 } = req.query

        const userExists = await User.exists({ _id: req.params.id })

        if (!userExists) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        const parsedPage = Number.parseInt(page, 10)
        const parsedLimit = Number.parseInt(limit, 10)

        const currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        const currentLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20

        const filter = { reviewee: req.params.id }
        const skip = (currentPage - 1) * currentLimit

        const [reviews, total, user] = await Promise.all([
            Review.find(filter)
                .populate("reviewer", "name avatarUrl role ratingAvg ratingCount")
                .populate("contract", "title status")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(currentLimit)
                .lean(),

            Review.countDocuments(filter),

            User.findById(req.params.id)
                .select("name avatarUrl role ratingAvg ratingCount")
                .lean(),
        ])

        return res.status(200).json({ success: true, data: { user, reviews, pagination: { page: currentPage, limit: currentLimit, total, totalPages: total === 0 ? 0 : Math.ceil(total / currentLimit) } } })

    } catch (err) {
        return handleError(res, err)
    }
}

module.exports = {
    createReview,
    getUserReviews,
}