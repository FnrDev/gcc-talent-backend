const mongoose = require("mongoose")
const Job = require("../models/Job")
const User = require("../models/User")
const Category = require("../models/Category")
const Skill = require("../models/Skill")

const JOB_BUDGET_TYPES = ["fixed", "hourly"]
const JOB_EXPERIENCE_LEVELS = ["entry", "intermediate", "expert"]

function handleError(res, err) {
    if (err?.code === 11000) {
        return res.status(409).json({ success: false, message: "A record with that value already exists." })
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

async function validateCategory(categoryId) {
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return false
    }
    const category = await Category.exists({ _id: categoryId })
    return !!category
}

async function validateSkills(skills) {
    if (skills === undefined) {
        return true
    }

    if (!Array.isArray(skills)) {
        return false
    }

    if (
        skills.some((skill) => !mongoose.Types.ObjectId.isValid(skill))
    ) {
        return false
    }

    const uniqueSkills = [...new Set(skills.map((skill) => String(skill)))]

    const count = await Skill.countDocuments({ _id: { $in: uniqueSkills } })
    return count === uniqueSkills.length
}

function validateBudget(budgetType, budgetMin, budgetMax) {
    if (!JOB_BUDGET_TYPES.includes(budgetType)) {
        return "Budget type must be fixed or hourly."
    }

    if (budgetMin !== undefined && typeof budgetMin !== "number") {
        return "budgetMin must be a number."
    }

    if (budgetMax !== undefined && typeof budgetMax !== "number") {
        return "budgetMax must be a number."
    }

    if (budgetMin !== undefined && budgetMin < 0) {
        return "budgetMin cannot be negative."
    }

    if (budgetMax !== undefined && budgetMax < 0) {
        return "budgetMax cannot be negative."
    }

    if (budgetMin !== undefined && budgetMax !== undefined && budgetMin > budgetMax) {
        return "budgetMin cannot be greater than budgetMax."
    }
    return null
}

async function createJob(req, res) {
    try {
        const {
            category,
            skills,
            title,
            description,
            budgetType,
            budgetMin,
            budgetMax,
            experienceLevel,
            duration,
            attachments,
            deadline,
        } = req.body

        if (!title || !description || !category || !budgetType) {
            return res.status(400).json({ success: false, message: "title, description, category, and budgetType are required." })
        }

        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ success: false, message: "Title cannot be empty." })
        }

        if (typeof description !== "string" || !description.trim()) {
            return res.status(400).json({ success: false, message: "Description cannot be empty." })
        }

        const user = await User.findById(req.user._id).select("role status")

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "client") {
            return res.status(403).json({ success: false, message: "Only clients can create jobs." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot create jobs." })
        }

        const categoryExists = await validateCategory(category)

        if (!categoryExists) {
            return res.status(404).json({ success: false, message: "Category not found." })
        }

        const skillsValid = await validateSkills(skills)

        if (!skillsValid) {
            return res.status(400).json({ success: false, message: "One or more skills are invalid." })
        }

        if (experienceLevel !== undefined && !JOB_EXPERIENCE_LEVELS.includes(experienceLevel)) {
            return res.status(400).json({ success: false, message: "Invalid experience level." })
        }

        const budgetError = validateBudget(
            budgetType,
            budgetMin,
            budgetMax
        )

        if (budgetError) {
            return res.status(400).json({ success: false, message: budgetError })
        }

        if (deadline !== undefined) {
            const deadlineDate = new Date(deadline)

            if (Number.isNaN(deadlineDate.getTime())) {
                return res.status(400).json({ success: false, message: "Invalid deadline." })
            }

            if (deadlineDate <= new Date()) {
                return res.status(400).json({ success: false, message: "Deadline must be in the future." })
            }
        }

        if (attachments !== undefined && !Array.isArray(attachments)) {
            return res.status(400).json({ success: false, message: "Attachments must be an array." })
        }

        const job = await Job.create({
            client: req.user._id,
            category,
            skills: skills || [],
            title: title.trim(),
            description: description.trim(),
            budgetType,
            budgetMin,
            budgetMax,
            experienceLevel,
            duration,
            attachments: attachments || [],
            deadline,
        })

        const populatedJob = await Job.findById(job._id)
            .populate("category", "name slug")
            .populate("skills", "name category")
            .populate("client", "name avatarUrl")

        return res.status(201).json({ success: true, message: "Job created successfully.", data: { job: populatedJob } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function getJobs(req, res) {
    try {
        const {
            category,
            skill,
            search,
            budgetType,
            experienceLevel,
            page = 1,
            limit = 20,
        } = req.query

        const parsedPage = Number.parseInt(page, 10)
        const parsedLimit = Number.parseInt(limit, 10)
        const currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        const currentLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20

        const filter = { status: "open", isHidden: false }

        if (category !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(category)) {
                return res.status(400).json({ success: false, message: "Invalid category id." })
            }
            filter.category = category
        }

        if (skill !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(skill)) {
                return res.status(400).json({ success: false, message: "Invalid skill id." })
            }
            filter.skills = skill
        }

        if (budgetType !== undefined) {
            if (!JOB_BUDGET_TYPES.includes(budgetType)) {
                return res.status(400).json({ success: false, message: "Invalid budget type." })
            }
            filter.budgetType = budgetType
        }

        if (experienceLevel !== undefined) {
            if (!JOB_EXPERIENCE_LEVELS.includes(experienceLevel)) {
                return res.status(400).json({ success: false, message: "Invalid experience level." })
            }
            filter.experienceLevel = experienceLevel
        }

        if (typeof search === "string" && search.trim()) {
            filter.$text = { $search: search.trim() }
        }
        const skip = (currentPage - 1) * currentLimit

        const [jobs, total] = await Promise.all([
            Job.find(filter)
                .populate("client", "name avatarUrl country city ratingAvg ratingCount")
                .populate("category", "name slug")
                .populate("skills", "name category")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(currentLimit)
                .lean(),
            Job.countDocuments(filter),
        ])

        return res.status(200).json({
            success: true,
            data: {
                jobs,
                pagination: {
                    page: currentPage,
                    limit: currentLimit,
                    total,
                    totalPages: total === 0 ? 0 : Math.ceil(total / currentLimit),
                }
            }
        })

    } catch (err) {
        return handleError(res, err)
    }
}

async function getJob(req, res) {
    try {
        const { id } = req.params
        const job = await Job.findOne({ _id: id, isHidden: false })
            .populate(
                "client",
                "name avatarUrl country city ratingAvg ratingCount"
            )
            .populate("category", "name slug")
            .populate("skills", "name category")

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (job.status !== "open") {
            return res.status(404).json({ success: false, message: "Job not found." })
        }
        return res.status(200).json({ success: true, data: { job } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function getMyJobs(req, res) {
    try {
        const user = await User.findById(req.user._id).select("role status")

        if (!user) {
            return res.status(404).json({success: false, message: "User not found."})
        }

        if (user.role !== "client") {
            return res.status(403).json({success: false, message: "Only clients can access their jobs."})
        }

        const {status, page = 1, limit = 20} = req.query

        const validStatuses = [
            "draft",
            "open",
            "in_progress",
            "completed",
            "closed",
        ]

        if (status !== undefined && !validStatuses.includes(status)) {
            return res.status(400).json({success: false, message: "Invalid job status."})
        }

        const parsedPage = Number.parseInt(page, 10)
        const parsedLimit = Number.parseInt(limit, 10)

        const currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1

        const currentLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20

        const filter = {
            client: req.user._id
        }

        if (status !== undefined) {
            filter.status = status
        }

        const skip = (currentPage - 1) * currentLimit

        const [jobs, total] = await Promise.all([
            Job.find(filter)
                .populate("category", "name slug")
                .populate("skills", "name category")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(currentLimit)
                .lean(),

            Job.countDocuments(filter),
        ])

        return res.status(200).json({
            success: true,
            data: {
                jobs,
                pagination: {
                    page: currentPage,
                    limit: currentLimit,
                    total,
                    totalPages: total === 0 ? 0 : Math.ceil(total / currentLimit),
                }
            }
        })

    } catch (err) {
        return handleError(res, err)
    }
}

async function getMyJob(req, res) {
    try {
        const job = await Job.findOne({ _id: req.params.id, client: req.user._id })
            .populate("category", "name slug")
            .populate("skills", "name category")
            .populate("client", "name avatarUrl country city")

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        return res.status(200).json({ success: true, data: { job } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function updateMyJob(req, res) {
    try {
        const job = await Job.findOne({ _id: req.params.id, client: req.user._id })

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (["in_progress", "completed"].includes(job.status)) {
            return res.status(400).json({ success: false, message: "Jobs in progress or completed cannot be edited." })
        }

        if (job.status === "closed") {
            return res.status(400).json({ success: false, message: "Closed jobs cannot be edited." })
        }

        const allowedFields = [
            "category",
            "skills",
            "title",
            "description",
            "budgetType",
            "budgetMin",
            "budgetMax",
            "experienceLevel",
            "duration",
            "attachments",
            "deadline",
        ]

        for (const field of allowedFields) {
            if (Object.hasOwn(req.body, field)) { job[field] = req.body[field] }
        }

        if (
            Object.hasOwn(req.body, "title") &&
            (typeof req.body.title !== "string" || !req.body.title.trim())
        ) {
            return res.status(400).json({ success: false, message: "Title cannot be empty." })
        }

        if (
            Object.hasOwn(req.body, "description") &&
            (typeof req.body.description !== "string" || !req.body.description.trim())
        ) {
            return res.status(400).json({ success: false, message: "Description cannot be empty." })
        }

        if (Object.hasOwn(req.body, "category")) {
            const categoryExists = await validateCategory(req.body.category)

            if (!categoryExists) {
                return res.status(404).json({ success: false, message: "Category not found." })
            }
        }

        if (Object.hasOwn(req.body, "skills")) {
            const skillsValid = await validateSkills(req.body.skills)

            if (!skillsValid) {
                return res.status(400).json({ success: false, message: "One or more skills are invalid.", })
            }
        }

        if (Object.hasOwn(req.body, "experienceLevel")) {
            if (
                !JOB_EXPERIENCE_LEVELS.includes(req.body.experienceLevel)
            ) {
                return res.status(400).json({ success: false, message: "Invalid experience level." })
            }
        }

        const budgetError = validateBudget(
            job.budgetType,
            job.budgetMin,
            job.budgetMax
        )

        if (budgetError) {
            return res.status(400).json({ success: false, message: budgetError })
        }

        if (Object.hasOwn(req.body, "deadline")) {
            const deadlineDate = new Date(req.body.deadline)

            if (Number.isNaN(deadlineDate.getTime())) {
                return res.status(400).json({ success: false, message: "Invalid deadline." })
            }

            if (deadlineDate <= new Date()) {
                return res.status(400).json({ success: false, message: "Deadline must be in the future." })
            }
        }

        if (typeof job.title === "string") {
            job.title = job.title.trim()
        }

        if (typeof job.description === "string") {
            job.description = job.description.trim()
        }

        await job.save()

        const updatedJob = await Job.findById(job._id)
            .populate("category", "name slug")
            .populate("skills", "name category")
            .populate("client", "name avatarUrl country city")

        return res.status(200).json({ success: true, message: "Job updated successfully.", data: { job: updatedJob } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function publishJob(req, res) {
    try {
        const job = await Job.findOne({ _id: req.params.id, client: req.user._id })

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (job.status !== "draft") {
            return res.status(400).json({ success: false, message: "Only draft jobs can be published." })
        }

        if (!job.title || !job.description || !job.category) {
            return res.status(400).json({ success: false, message: "Job is missing required information." })
        }

        if (!job.budgetType) {
            return res.status(400).json({ success: false, message: "Budget type is required before publishing." })
        }

        const budgetError = validateBudget(
            job.budgetType,
            job.budgetMin,
            job.budgetMax
        )

        if (budgetError) {
            return res.status(400).json({ success: false, message: budgetError })
        }

        if (job.deadline && job.deadline <= new Date()) {
            return res.status(400).json({ success: false, message: "Deadline must be in the future." })
        }

        job.status = "open"
        await job.save()

        return res.status(200).json({
            success: true,
            message: "Job published successfully.",
            data: {
                job,
            },
        })
    } catch (err) {
        return handleError(res, err)
    }
}

async function closeJob(req, res) {
    try {
        const job = await Job.findOne({ _id: req.params.id, client: req.user._id })

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (job.status !== "open") {
            return res.status(400).json({ success: false, message: "Only open jobs can be closed." })
        }

        job.status = "closed"
        await job.save()

        return res.status(200).json({ success: true, message: "Job closed successfully.", data: { job } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function reopenJob(req, res) {
    try {
        const job = await Job.findOne({_id: req.params.id, client: req.user._id})

        if (!job) {
            return res.status(404).json({success: false, message: "Job not found."})
        }

        if (job.status !== "closed") {
            return res.status(400).json({success: false, message: "Only closed jobs can be reopened."})
        }

        if (job.deadline && job.deadline <= new Date()) {
            return res.status(400).json({success: false, message: "Update the deadline before reopening this job."})
        }

        job.status = "open"

        await job.save()

        return res.status(200).json({success: true, message: "Job reopened successfully.", data: { job }})

    } catch (err) {
        return handleError(res, err)
    }
}

async function deleteMyJob(req, res) {
    try {
        const job = await Job.findOne({ _id: req.params.id, client: req.user._id })

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (job.status !== "draft") {
            return res.status(400).json({ success: false, message: "Only draft jobs can be deleted." })
        }

        if (job.proposalsCount > 0) {
            return res.status(409).json({ success: false, message: "A job with proposals cannot be deleted." })
        }

        await job.deleteOne()
        return res.status(200).json({ success: true, message: "Job deleted successfully." })

    } catch (err) {
        return handleError(res, err)
    }
}

module.exports = {
    createJob,
    getJobs,
    getJob,
    getMyJobs,
    getMyJob,
    updateMyJob,
    publishJob,
    closeJob,
    reopenJob,
    deleteMyJob,
}