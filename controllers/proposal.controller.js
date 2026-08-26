const mongoose = require("mongoose")
const Proposal = require("../models/Proposal")
const Job = require("../models/Job")
const User = require("../models/User")
const Contract = require("../models/Contract")
const FreelancerProfile = require("../models/FreelancerProfile")

const PROPOSAL_STATUSES = ["pending", "shortlisted", "accepted", "declined", "withdrawn"]

function handleError(res, err) {
    if (err?.code === 11000) {
        return res.status(409).json({ success: false, message: "You have already submitted a proposal for this job." })
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

function validateProposalDetails(amount, deliveryDays) {
    if (typeof amount !== "number" || amount <= 0) {
        return "Proposal amount must be greater than 0."
    }

    if (!Number.isInteger(deliveryDays) || deliveryDays < 1) {
        return "Delivery days must be a positive whole number."
    }

    return null
}

function validateMilestones(milestones, proposalAmount) {
    if (milestones === undefined || milestones.length === 0) {
        return null
    }

    if (!Array.isArray(milestones)) {
        return "Milestones must be an array."
    }

    for (const milestone of milestones) {
        if (typeof milestone.title !== "string" || !milestone.title.trim()) {
            return "Every milestone must have a title."
        }

        if (typeof milestone.amount !== "number" || milestone.amount <= 0) {
            return "Every milestone amount must be greater than 0."
        }

        if (milestone.dueDate !== undefined) {
            const dueDate = new Date(milestone.dueDate)

            if (Number.isNaN(dueDate.getTime())) {
                return "One or more milestone due dates are invalid."
            }

            if (dueDate <= new Date()) {
                return "Milestone due dates must be in the future."
            }
        }
    }

    const milestoneTotal = milestones.reduce((sum, milestone) => sum + milestone.amount, 0)

    if (Math.round(milestoneTotal * 100) !== Math.round(proposalAmount * 100)) {
        return "Milestone amounts must add up to the proposal amount."
    }

    return null
}

async function submitProposal(req, res) {
    const session = await mongoose.startSession()

    try {
        const { coverLetter, amount, deliveryDays, milestones, attachments } = req.body

        if (!coverLetter || amount === undefined || deliveryDays === undefined) {
            return res.status(400).json({ success: false, message: "Cover letter, amount, and delivery days are required." })
        }

        if (typeof coverLetter !== "string" || !coverLetter.trim()) {
            return res.status(400).json({ success: false, message: "Cover letter cannot be empty." })
        }

        const proposalError = validateProposalDetails(amount, deliveryDays)

        if (proposalError) {
            return res.status(400).json({ success: false, message: proposalError })
        }

        const milestoneError = validateMilestones(milestones, amount)

        if (milestoneError) {
            return res.status(400).json({ success: false, message: milestoneError })
        }

        if (attachments !== undefined && !Array.isArray(attachments)) {
            return res.status(400).json({ success: false, message: "Attachments must be an array." })
        }

        const user = await User.findById(req.user._id).select("role status")

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can submit proposals." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot submit proposals." })
        }

        const job = await Job.findById(req.params.id)

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (job.status !== "open") {
            return res.status(422).json({ success: false, message: "Proposals can only be submitted to open jobs." })
        }

        if (job.isHidden) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (String(job.client) === String(req.user._id)) {
            return res.status(422).json({ success: false, message: "You cannot submit a proposal to your own job." })
        }

        const existingProposal = await Proposal.exists({ job: job._id, freelancer: req.user._id })

        if (existingProposal) {
            return res.status(409).json({ success: false, message: "You have already submitted a proposal for this job." })
        }

        session.startTransaction()

        const [proposal] = await Proposal.create([{
            job: job._id,
            freelancer: req.user._id,
            coverLetter: coverLetter.trim(),
            amount,
            deliveryDays,
            milestones: milestones || [],
            attachments: attachments || [],
        }], { session })

        await Job.updateOne({ _id: job._id }, { $inc: { proposalsCount: 1 } }, { session })

        await session.commitTransaction()

        const populatedProposal = await Proposal.findById(proposal._id)
            .populate("job", "title budgetType budgetMin budgetMax status")
            .populate("freelancer", "name avatarUrl ratingAvg ratingCount")

        return res.status(201).json({ success: true, message: "Proposal submitted successfully.", data: { proposal: populatedProposal } })

    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }

        return handleError(res, err)

    } finally {
        await session.endSession()
    }
}

async function getMyProposals(req, res) {
    try {
        const user = await User.findById(req.user._id).select("role")

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can access their proposals." })
        }

        const { status, page = 1, limit = 20 } = req.query

        if (status !== undefined && !PROPOSAL_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid proposal status." })
        }

        const parsedPage = Number.parseInt(page, 10)
        const parsedLimit = Number.parseInt(limit, 10)

        const currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        const currentLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20

        const filter = { freelancer: req.user._id }

        if (status !== undefined) {
            filter.status = status
        }

        const skip = (currentPage - 1) * currentLimit

        const [proposals, total] = await Promise.all([
            Proposal.find(filter)
                .populate("job", "title status budgetType budgetMin budgetMax deadline")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(currentLimit)
                .lean(),

            Proposal.countDocuments(filter),
        ])

        return res.status(200).json({ success: true, data: { proposals, pagination: { page: currentPage, limit: currentLimit, total, totalPages: total === 0 ? 0 : Math.ceil(total / currentLimit) } } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function updateProposal(req, res) {
    try {
        const proposal = await Proposal.findOne({ _id: req.params.id, freelancer: req.user._id })

        if (!proposal) {
            return res.status(404).json({ success: false, message: "Proposal not found." })
        }

        if (proposal.status !== "pending") {
            return res.status(422).json({ success: false, message: "Only pending proposals can be edited." })
        }

        const allowedFields = ["coverLetter", "amount", "deliveryDays", "milestones", "attachments"]

        for (const field of allowedFields) {
            if (Object.hasOwn(req.body, field)) {
                proposal[field] = req.body[field]
            }
        }

        if (typeof proposal.coverLetter !== "string" || !proposal.coverLetter.trim()) {
            return res.status(400).json({ success: false, message: "Cover letter cannot be empty." })
        }

        const proposalError = validateProposalDetails(proposal.amount, proposal.deliveryDays)

        if (proposalError) {
            return res.status(400).json({ success: false, message: proposalError })
        }

        const milestoneError = validateMilestones(proposal.milestones, proposal.amount)

        if (milestoneError) {
            return res.status(400).json({ success: false, message: milestoneError })
        }

        if (!Array.isArray(proposal.attachments)) {
            return res.status(400).json({ success: false, message: "Attachments must be an array." })
        }

        proposal.coverLetter = proposal.coverLetter.trim()

        await proposal.save()

        return res.status(200).json({ success: true, message: "Proposal updated successfully.", data: { proposal } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function withdrawProposal(req, res) {
    const session = await mongoose.startSession()

    try {
        const proposal = await Proposal.findOne({ _id: req.params.id, freelancer: req.user._id })

        if (!proposal) {
            return res.status(404).json({ success: false, message: "Proposal not found." })
        }

        if (proposal.status !== "pending") {
            return res.status(422).json({ success: false, message: "Only pending proposals can be withdrawn." })
        }

        session.startTransaction()

        proposal.status = "withdrawn"

        await proposal.save({ session })

        await Job.updateOne({ _id: proposal.job, proposalsCount: { $gt: 0 } }, { $inc: { proposalsCount: -1 } }, { session })

        await session.commitTransaction()

        return res.status(200).json({ success: true, message: "Proposal withdrawn successfully.", data: { proposal } })

    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }

        return handleError(res, err)

    } finally {
        await session.endSession()
    }
}

async function getJobProposals(req, res) {
    try {
        const job = await Job.findOne({ _id: req.params.id, client: req.user._id })

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        const { status, page = 1, limit = 20 } = req.query

        if (status !== undefined && !PROPOSAL_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid proposal status." })
        }

        const parsedPage = Number.parseInt(page, 10)
        const parsedLimit = Number.parseInt(limit, 10)

        const currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        const currentLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20

        const filter = { job: job._id }

        if (status !== undefined) {
            filter.status = status
        }

        const skip = (currentPage - 1) * currentLimit

        const [proposals, total] = await Promise.all([
            Proposal.find(filter)
                .populate("freelancer", "name avatarUrl country city ratingAvg ratingCount")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(currentLimit)
                .lean(),

            Proposal.countDocuments(filter),
        ])

        const freelancerIds = proposals.map((proposal) => proposal.freelancer?._id).filter(Boolean)

        const profiles = await FreelancerProfile.find({ user: { $in: freelancerIds } })
            .populate("skills", "name")
            .select("user headline skills hourlyRate currency availability")
            .lean()

        const profileMap = new Map(profiles.map((profile) => [String(profile.user), profile]))

        const proposalsWithProfiles = proposals.map((proposal) => ({
            ...proposal,
            freelancerProfile: profileMap.get(String(proposal.freelancer?._id)) || null,
        }))

        return res.status(200).json({ success: true, data: { proposals: proposalsWithProfiles, pagination: { page: currentPage, limit: currentLimit, total, totalPages: total === 0 ? 0 : Math.ceil(total / currentLimit) } } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function updateProposalStatus(req, res) {
    try {
        const { status, declineReason } = req.body

        if (!["shortlisted", "declined"].includes(status)) {
            return res.status(400).json({ success: false, message: "Status must be shortlisted or declined." })
        }

        const proposal = await Proposal.findById(req.params.id)

        if (!proposal) {
            return res.status(404).json({ success: false, message: "Proposal not found." })
        }

        const job = await Job.findOne({ _id: proposal.job, client: req.user._id })

        if (!job) {
            return res.status(403).json({ success: false, message: "You are not allowed to manage this proposal." })
        }

        if (status === "shortlisted" && proposal.status !== "pending") {
            return res.status(422).json({ success: false, message: "Only pending proposals can be shortlisted." })
        }

        if (status === "declined" && !["pending", "shortlisted"].includes(proposal.status)) {
            return res.status(422).json({ success: false, message: "Only pending or shortlisted proposals can be declined." })
        }

        proposal.status = status

        if (status === "declined") {
            proposal.declineReason = typeof declineReason === "string" ? declineReason.trim() : undefined
        }

        await proposal.save()

        return res.status(200).json({ success: true, message: status === "shortlisted" ? "Proposal shortlisted successfully." : "Proposal declined successfully.", data: { proposal } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function acceptProposal(req, res) {
    const session = await mongoose.startSession()

    try {
        session.startTransaction()

        const proposal = await Proposal.findById(req.params.id).session(session)

        if (!proposal) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Proposal not found." })
        }

        if (!["pending", "shortlisted"].includes(proposal.status)) {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "Only pending or shortlisted proposals can be accepted." })
        }

        const job = await Job.findOne({ _id: proposal.job, client: req.user._id }).session(session)

        if (!job) {
            await session.abortTransaction()
            return res.status(403).json({ success: false, message: "You are not allowed to accept this proposal." })
        }

        if (job.status !== "open") {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "This job is no longer open." })
        }

        let contractMilestones

        if (proposal.milestones && proposal.milestones.length > 0) {
            const milestoneError = validateMilestones(proposal.milestones, proposal.amount)

            if (milestoneError) {
                await session.abortTransaction()
                return res.status(422).json({ success: false, message: milestoneError })
            }

            contractMilestones = proposal.milestones.map((milestone) => ({
                title: milestone.title,
                amount: milestone.amount,
                dueDate: milestone.dueDate,
                status: "pending",
                escrowAmount: 0,
            }))
        } else {
            const dueDate = new Date()
            dueDate.setDate(dueDate.getDate() + proposal.deliveryDays)

            contractMilestones = [{
                title: "Project delivery",
                amount: proposal.amount,
                dueDate,
                status: "pending",
                escrowAmount: 0,
            }]
        }

        const [contract] = await Contract.create([{
            client: job.client,
            freelancer: proposal.freelancer,
            source: {
                type: "job",
                job: job._id,
                proposal: proposal._id,
            },
            title: job.title,
            totalAmount: proposal.amount,
            currency: "USD",
            status: "active",
            milestones: contractMilestones,
            activity: [{
                type: "contract_created",
                by: req.user._id,
                message: "Contract created from accepted proposal.",
                at: new Date(),
            }],
            startedAt: new Date(),
        }], { session })

        proposal.status = "accepted"
        await proposal.save({ session })

        job.status = "in_progress"
        await job.save({ session })

        await Proposal.updateMany(
            {
                job: job._id,
                _id: { $ne: proposal._id },
                status: { $in: ["pending", "shortlisted"] },
            },
            {
                $set: {
                    status: "declined",
                    declineReason: "Another proposal was accepted.",
                },
            },
            { session }
        )

        await session.commitTransaction()

        const populatedContract = await Contract.findById(contract._id)
            .populate("client", "name avatarUrl")
            .populate("freelancer", "name avatarUrl ratingAvg ratingCount")
            .populate("source.job", "title status")
            .populate("source.proposal")

        return res.status(200).json({ success: true, message: "Proposal accepted and contract created successfully.", data: { proposal, contract: populatedContract } })

    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }

        return handleError(res, err)

    } finally {
        await session.endSession()
    }
}

module.exports = {
    submitProposal,
    getMyProposals,
    updateProposal,
    withdrawProposal,
    getJobProposals,
    updateProposalStatus,
    acceptProposal,
}