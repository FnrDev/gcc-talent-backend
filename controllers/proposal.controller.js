const mongoose = require("mongoose")
const Proposal = require("../models/Proposal")
const Job = require("../models/Job")
const User = require("../models/User")
const Contract = require("../models/Contract")
const FreelancerProfile = require("../models/FreelancerProfile")
const { recordAuditLog, recordAuditLogs } = require("../services/audit.service")

const PROPOSAL_STATUSES = ["pending", "shortlisted", "accepted", "declined", "withdrawn"]
const MAX_COVER_LETTER_LENGTH = 5000
const MAX_MILESTONES = 20
const MAX_ATTACHMENTS = 5

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
    if (milestones === undefined) {
        return null
    }

    if (!Array.isArray(milestones)) {
        return "Milestones must be an array."
    }

    if (milestones.length === 0) {
        return null
    }

    if (milestones.length > MAX_MILESTONES) {
        return `A proposal can have at most ${MAX_MILESTONES} milestones.`
    }

    for (const milestone of milestones) {
        if (typeof milestone.title !== "string" || !milestone.title.trim()) {
            return "Every milestone must have a title."
        }

        if (milestone.title.trim().length > 200) {
            return "Milestone titles must be 200 characters or fewer."
        }

        if (typeof milestone.amount !== "number" || milestone.amount <= 0) {
            return "Every milestone amount must be greater than 0."
        }

        if (typeof milestone.description !== "string" || !milestone.description.trim()) {
            return "Every milestone must have a description."
        }

        if (milestone.description.trim().length > 2000) {
            return "Milestone descriptions must be 2000 characters or fewer."
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

function validateAttachments(attachments) {
    if (attachments === undefined) return null
    if (!Array.isArray(attachments)) return "Attachments must be an array."
    if (attachments.length > MAX_ATTACHMENTS) return `A proposal can have at most ${MAX_ATTACHMENTS} attachments.`

    for (const attachment of attachments) {
        if (!attachment || typeof attachment.url !== "string" || !/^https?:\/\//i.test(attachment.url)) {
            return "Every attachment must include a valid http or https URL."
        }
        if (attachment.url.length > 2000) return "Attachment URLs must be 2000 characters or fewer."
        if (typeof attachment.name !== "string" || !attachment.name.trim()) {
            return "Every attachment must include a name."
        }
        if (attachment.name.trim().length > 255) return "Attachment names must be 255 characters or fewer."
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

        if (coverLetter.trim().length > MAX_COVER_LETTER_LENGTH) {
            return res.status(400).json({ success: false, message: `Cover letter must be ${MAX_COVER_LETTER_LENGTH} characters or fewer.` })
        }

        const proposalError = validateProposalDetails(amount, deliveryDays)

        if (proposalError) {
            return res.status(400).json({ success: false, message: proposalError })
        }

        const milestoneError = validateMilestones(milestones, amount)

        if (milestoneError) {
            return res.status(400).json({ success: false, message: milestoneError })
        }

        const attachmentError = validateAttachments(attachments)

        if (attachmentError) {
            return res.status(400).json({ success: false, message: attachmentError })
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
            return res.status(409).json({ success: false, message: "Proposals can only be submitted to open jobs." })
        }

        if (job.deadline && job.deadline <= new Date()) {
            return res.status(409).json({ success: false, message: "The proposal deadline has passed." })
        }

        if (job.isHidden) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        const activeClient = await User.exists({
            _id: job.client,
            role: "client",
            status: "active",
        })

        if (!activeClient) {
            return res.status(404).json({ success: false, message: "Job not found." })
        }

        if (String(job.client) === String(req.user._id)) {
            return res.status(403).json({ success: false, message: "You cannot submit a proposal to your own job." })
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

        const jobUpdate = await Job.updateOne({
            _id: job._id,
            status: "open",
            isHidden: false,
            $or: [
                { deadline: { $exists: false } },
                { deadline: null },
                { deadline: { $gt: new Date() } },
            ],
        }, { $inc: { proposalsCount: 1 } }, { session })

        if (jobUpdate.modifiedCount === 0) {
            await session.abortTransaction()
            return res.status(409).json({ success: false, message: "This job is no longer accepting proposals." })
        }

        const auditEntries = [{
            action: "create",
            resource: "Proposal",
            resourceId: proposal._id,
            details: { operation: "submitProposal", jobId: job._id, freelancerId: proposal.freelancer, status: proposal.status },
        }]

        if (jobUpdate.modifiedCount > 0) {
            auditEntries.push({
                action: "update",
                resource: "Job",
                resourceId: job._id,
                details: { operation: "submitProposal", proposalId: proposal._id, changedFields: ["proposalsCount"], proposalsCountDelta: 1 },
            })
        }

        await recordAuditLogs(req, auditEntries, { session })

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

async function getMyProposalForJob(req, res) {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
            return res.status(400).json({ success: false, message: "Invalid job id." })
        }

        const user = await User.findById(req.user._id).select("role")

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can access their proposals." })
        }

        const proposal = await Proposal.findOne({
            job: req.params.jobId,
            freelancer: req.user._id,
        }).populate("job", "title status budgetType budgetMin budgetMax deadline")

        if (!proposal) {
            return res.status(404).json({ success: false, message: "Proposal not found." })
        }

        return res.status(200).json({ success: true, data: { proposal } })

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

        if (proposal.coverLetter.trim().length > MAX_COVER_LETTER_LENGTH) {
            return res.status(400).json({ success: false, message: `Cover letter must be ${MAX_COVER_LETTER_LENGTH} characters or fewer.` })
        }

        const proposalError = validateProposalDetails(proposal.amount, proposal.deliveryDays)

        if (proposalError) {
            return res.status(400).json({ success: false, message: proposalError })
        }

        const milestoneError = validateMilestones(proposal.milestones, proposal.amount)

        if (milestoneError) {
            return res.status(400).json({ success: false, message: milestoneError })
        }

        const attachmentError = validateAttachments(proposal.attachments)

        if (attachmentError) {
            return res.status(400).json({ success: false, message: attachmentError })
        }

        proposal.coverLetter = proposal.coverLetter.trim()

        const changedFields = allowedFields.filter((field) => proposal.isModified(field))
        await proposal.save()

        if (changedFields.length > 0) {
            await recordAuditLog(req, {
                action: "update",
                resource: "Proposal",
                resourceId: proposal._id,
                details: { operation: "updateProposal", jobId: proposal.job, changedFields },
            })
        }

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

        const jobUpdate = await Job.updateOne({ _id: proposal.job, proposalsCount: { $gt: 0 } }, { $inc: { proposalsCount: -1 } }, { session })

        const auditEntries = [{
            action: "update",
            resource: "Proposal",
            resourceId: proposal._id,
            details: { operation: "withdrawProposal", jobId: proposal.job, previousStatus: "pending", status: proposal.status },
        }]

        if (jobUpdate.modifiedCount > 0) {
            auditEntries.push({
                action: "update",
                resource: "Job",
                resourceId: proposal.job,
                details: { operation: "withdrawProposal", proposalId: proposal._id, changedFields: ["proposalsCount"], proposalsCountDelta: -1 },
            })
        }

        await recordAuditLogs(req, auditEntries, { session })

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

        if (status === "declined" && declineReason !== undefined) {
            if (typeof declineReason !== "string") {
                return res.status(400).json({ success: false, message: "Decline reason must be text." })
            }
            if (declineReason.trim().length > 500) {
                return res.status(400).json({ success: false, message: "Decline reason must be 500 characters or fewer." })
            }
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

        const previousStatus = proposal.status
        proposal.status = status

        if (status === "declined") {
            proposal.declineReason = typeof declineReason === "string" ? declineReason.trim() : undefined
        }

        await proposal.save()

        await recordAuditLog(req, {
            action: "update",
            resource: "Proposal",
            resourceId: proposal._id,
            details: { operation: "updateProposalStatus", jobId: proposal.job, previousStatus, status: proposal.status },
        })

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
                description: milestone.description,
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
                description: job.description,
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
            currency: "BHD",
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

        const previousProposalStatus = proposal.status
        proposal.status = "accepted"
        await proposal.save({ session })

        job.status = "in_progress"
        await job.save({ session })

        const declinedProposals = await Proposal.updateMany(
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

        const auditEntries = [{
            action: "create",
            resource: "Contract",
            resourceId: contract._id,
            details: { operation: "acceptProposal", jobId: job._id, proposalId: proposal._id, status: contract.status },
        }, {
            action: "update",
            resource: "Proposal",
            resourceId: proposal._id,
            details: { operation: "acceptProposal", jobId: job._id, contractId: contract._id, previousStatus: previousProposalStatus, status: proposal.status },
        }, {
            action: "update",
            resource: "Job",
            resourceId: job._id,
            details: { operation: "acceptProposal", contractId: contract._id, previousStatus: "open", status: job.status },
        }]

        if (declinedProposals.modifiedCount > 0) {
            auditEntries.push({
                action: "update",
                resource: "Proposal",
                affectedCount: declinedProposals.modifiedCount,
                details: {
                    operation: "acceptProposal",
                    jobId: job._id,
                    excludedProposalId: proposal._id,
                    previousStatuses: ["pending", "shortlisted"],
                    status: "declined",
                    reason: "another_proposal_accepted",
                },
            })
        }

        await recordAuditLogs(req, auditEntries, { session })

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
    getMyProposalForJob,
    updateProposal,
    withdrawProposal,
    getJobProposals,
    updateProposalStatus,
    acceptProposal,
}
