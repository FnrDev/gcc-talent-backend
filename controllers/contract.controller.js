const mongoose = require("mongoose")
const Contract = require("../models/Contract")
const User = require("../models/User")
const Transaction = require("../models/Transaction")
const Job = require("../models/Job")

const CONTRACT_STATUSES = ["active", "completed", "cancelled"]

const configuredFee = Number(process.env.PLATFORM_FEE_PERCENT)
const PLATFORM_FEE_PERCENT = Number.isFinite(configuredFee) && configuredFee >= 0 && configuredFee <= 100 ? configuredFee : 10

function handleError(res, err) {
    if (err?.code === 11000) {
        return res.status(409).json({ success: false, message: "This operation has already been completed." })
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

function roundMoney(amount) {
    return Math.round((amount + Number.EPSILON) * 100) / 100
}

function getMilestone(contract, milestoneId) {
    if (!mongoose.Types.ObjectId.isValid(milestoneId)) {
        return null
    }

    return contract.milestones.id(milestoneId)
}

async function getCurrentUser(userId) {
    return User.findById(userId).select("role status wallet")
}

async function getContracts(req, res) {
    try {
        const { role, status, page = 1, limit = 20 } = req.query

        if (role !== undefined && !["client", "freelancer"].includes(role)) {
            return res.status(400).json({ success: false, message: "Role must be client or freelancer." })
        }

        if (status !== undefined && !CONTRACT_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid contract status." })
        }

        const parsedPage = Number.parseInt(page, 10)
        const parsedLimit = Number.parseInt(limit, 10)

        const currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        const currentLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20

        let filter

        if (role === "client") {
            filter = { client: req.user._id }

        } else if (role === "freelancer") {
            filter = { freelancer: req.user._id }
            
        } else {
            filter = { $or: [{ client: req.user._id }, { freelancer: req.user._id }] }
        }

        if (status !== undefined) {
            filter.status = status
        }

        const skip = (currentPage - 1) * currentLimit

        const [contracts, total] = await Promise.all([
            Contract.find(filter)
                .populate("client", "name avatarUrl country city ratingAvg ratingCount")
                .populate("freelancer", "name avatarUrl country city ratingAvg ratingCount")
                .populate("source.job", "title status")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(currentLimit)
                .lean(),

            Contract.countDocuments(filter),
        ])

        return res.status(200).json({ success: true, data: { contracts, pagination: { page: currentPage, limit: currentLimit, total, totalPages: total === 0 ? 0 : Math.ceil(total / currentLimit) } } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function getContract(req, res) {
    try {
        const filter = req.user.role === "admin" ? { _id: req.params.id } : { _id: req.params.id, $or: [{ client: req.user._id }, { freelancer: req.user._id }] }

        const contract = await Contract.findOne(filter)
            .populate("client", "name avatarUrl country city ratingAvg ratingCount")
            .populate("freelancer", "name avatarUrl country city ratingAvg ratingCount")
            .populate("source.job", "title status")
            .populate("activity.by", "name role")

        if (!contract) {
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        const transactions = await Transaction.find({ contract: contract._id })
            .select("user milestoneId type amount direction status reference createdAt")
            .sort({ createdAt: -1 })
            .lean()

        const escrowHeld = roundMoney(contract.milestones.reduce((total, milestone) => total + (milestone.escrowAmount || 0), 0))
        const approvedAmount = roundMoney(contract.milestones.filter((milestone) => milestone.status === "approved").reduce((total, milestone) => total + milestone.amount, 0))
        const remainingAmount = roundMoney(Math.max(contract.totalAmount - approvedAmount, 0))

        const moneySummary = {
            totalAmount: contract.totalAmount,
            escrowHeld,
            approvedAmount,
            remainingAmount,
            currency: contract.currency,
        }

        return res.status(200).json({ success: true, data: { contract, moneySummary, transactions } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function addMilestone(req, res) {
    try {
        const user = await getCurrentUser(req.user._id)

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "client") {
            return res.status(403).json({ success: false, message: "Only clients can add milestones." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot add milestones." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, client: req.user._id })

        if (!contract) {
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            return res.status(422).json({ success: false, message: "Milestones can only be added to active contracts." })
        }

        const { title, description, amount, dueDate } = req.body

        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ success: false, message: "Milestone title is required." })
        }

        if (typeof amount !== "number" || amount <= 0) {
            return res.status(400).json({ success: false, message: "Milestone amount must be greater than 0." })
        }

        if (!dueDate) {
            return res.status(400).json({ success: false, message: "Milestone due date is required." })
        }

        const parsedDueDate = new Date(dueDate)

        if (Number.isNaN(parsedDueDate.getTime())) {
            return res.status(400).json({ success: false, message: "Invalid milestone due date." })
        }

        if (parsedDueDate <= new Date()) {
            return res.status(400).json({ success: false, message: "Milestone due date must be in the future." })
        }

        contract.milestones.push({
            title: title.trim(),
            description: typeof description === "string" ? description.trim() : undefined,
            amount,
            dueDate: parsedDueDate,
            status: "pending",
            escrowAmount: 0,
        })

        contract.totalAmount = roundMoney(contract.totalAmount + amount)

        contract.activity.push({
            type: "milestone_added",
            by: req.user._id,
            message: `Milestone "${title.trim()}" was added.`,
            at: new Date(),
        })

        await contract.save()

        const milestone = contract.milestones[contract.milestones.length - 1]

        return res.status(201).json({ success: true, message: "Milestone added successfully.", data: { milestone, totalAmount: contract.totalAmount } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function updateMilestone(req, res) {
    try {
        const user = await getCurrentUser(req.user._id)

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "client") {
            return res.status(403).json({ success: false, message: "Only clients can edit milestones." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot edit milestones." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, client: req.user._id })

        if (!contract) {
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            return res.status(422).json({ success: false, message: "Only active contracts can be edited." })
        }

        const milestone = getMilestone(contract, req.params.mid)

        if (!milestone) {
            return res.status(404).json({ success: false, message: "Milestone not found." })
        }

        if (milestone.status !== "pending") {
            return res.status(422).json({ success: false, message: "Only unfunded milestones can be edited." })
        }

        const previousAmount = milestone.amount

        if (Object.hasOwn(req.body, "title")) {
            if (typeof req.body.title !== "string" || !req.body.title.trim()) {
                return res.status(400).json({ success: false, message: "Milestone title cannot be empty." })
            }

            milestone.title = req.body.title.trim()
        }

        if (Object.hasOwn(req.body, "description")) {
            if (req.body.description !== undefined && typeof req.body.description !== "string") {
                return res.status(400).json({ success: false, message: "Milestone description must be a string." })
            }

            milestone.description = typeof req.body.description === "string" ? req.body.description.trim() : undefined
        }

        if (Object.hasOwn(req.body, "amount")) {
            if (typeof req.body.amount !== "number" || req.body.amount <= 0) {
                return res.status(400).json({ success: false, message: "Milestone amount must be greater than 0." })
            }

            milestone.amount = req.body.amount
        }

        if (Object.hasOwn(req.body, "dueDate")) {
            const dueDate = new Date(req.body.dueDate)

            if (Number.isNaN(dueDate.getTime())) {
                return res.status(400).json({ success: false, message: "Invalid milestone due date." })
            }

            if (dueDate <= new Date()) {
                return res.status(400).json({ success: false, message: "Milestone due date must be in the future." })
            }

            milestone.dueDate = dueDate
        }

        contract.totalAmount = roundMoney(contract.totalAmount + milestone.amount - previousAmount)

        contract.activity.push({
            type: "milestone_updated",
            by: req.user._id,
            message: `Milestone "${milestone.title}" was updated.`,
            at: new Date(),
        })

        await contract.save()

        return res.status(200).json({ success: true, message: "Milestone updated successfully.", data: { milestone, totalAmount: contract.totalAmount } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function fundMilestone(req, res) {
    const session = await mongoose.startSession()

    try {
        session.startTransaction()

        const user = await User.findById(req.user._id).session(session)

        if (!user) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "client") {
            await session.abortTransaction()
            return res.status(403).json({ success: false, message: "Only clients can fund milestones." })
        }

        if (user.status === "suspended") {
            await session.abortTransaction()
            return res.status(403).json({ success: false, message: "Suspended accounts cannot fund milestones." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, client: req.user._id }).session(session)

        if (!contract) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "Only active contracts can have milestones funded." })
        }

        const milestone = getMilestone(contract, req.params.mid)

        if (!milestone) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Milestone not found." })
        }

        if (milestone.status !== "pending") {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "Only pending milestones can be funded." })
        }

        const amount = roundMoney(milestone.amount)

        if (user.wallet.available < amount) {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "Insufficient wallet balance." })
        }

        user.wallet.available = roundMoney(user.wallet.available - amount)

        milestone.status = "funded"
        milestone.escrowAmount = amount
        milestone.fundedAt = new Date()

        contract.activity.push({
            type: "milestone_funded",
            by: req.user._id,
            message: `Milestone "${milestone.title}" was funded with ${amount} ${contract.currency}.`,
            at: new Date(),
        })

        await user.save({ session })
        await contract.save({ session })

        await Transaction.create([{
            user: user._id,
            contract: contract._id,
            milestoneId: milestone._id,
            type: "escrow_fund",
            amount,
            direction: "debit",
            status: "completed",
            reference: `escrow-fund:${contract._id}:${milestone._id}`,
        }], { session })

        await session.commitTransaction()

        return res.status(200).json({ success: true, message: "Milestone funded successfully.", data: { milestone, wallet: user.wallet } })

    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }

        return handleError(res, err)

    } finally {
        await session.endSession()
    }
}

async function startMilestone(req, res) {
    try {
        const user = await getCurrentUser(req.user._id)

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can start milestones." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot start milestones." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, freelancer: req.user._id })

        if (!contract) {
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            return res.status(422).json({ success: false, message: "This contract is not active." })
        }

        const milestone = getMilestone(contract, req.params.mid)

        if (!milestone) {
            return res.status(404).json({ success: false, message: "Milestone not found." })
        }

        if (milestone.status !== "funded") {
            return res.status(422).json({ success: false, message: "Only funded milestones can be started." })
        }

        milestone.status = "in_progress"

        contract.activity.push({
            type: "milestone_started",
            by: req.user._id,
            message: `Work started on milestone "${milestone.title}".`,
            at: new Date(),
        })

        await contract.save()

        return res.status(200).json({ success: true, message: "Milestone started successfully.", data: { milestone } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function deliverMilestone(req, res) {
    try {
        const user = await getCurrentUser(req.user._id)

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "freelancer") {
            return res.status(403).json({ success: false, message: "Only freelancers can submit milestone deliveries." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot submit deliveries." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, freelancer: req.user._id })

        if (!contract) {
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            return res.status(422).json({ success: false, message: "This contract is not active." })
        }

        const milestone = getMilestone(contract, req.params.mid)

        if (!milestone) {
            return res.status(404).json({ success: false, message: "Milestone not found." })
        }

        if (!["funded", "in_progress", "revision_requested"].includes(milestone.status)) {
            return res.status(422).json({ success: false, message: "This milestone cannot be delivered in its current status." })
        }

        if (!milestone.escrowAmount || milestone.escrowAmount <= 0) {
            return res.status(422).json({ success: false, message: "This milestone must be funded before delivery." })
        }

        const { message, attachments } = req.body

        if (typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ success: false, message: "Delivery message is required." })
        }

        if (attachments !== undefined && !Array.isArray(attachments)) {
            return res.status(400).json({ success: false, message: "Attachments must be an array." })
        }

        milestone.deliveries.push({
            message: message.trim(),
            attachments: attachments || [],
            submittedAt: new Date(),
        })

        milestone.status = "delivered"
        milestone.deliveredAt = new Date()

        contract.activity.push({
            type: "milestone_delivered",
            by: req.user._id,
            message: `Milestone "${milestone.title}" was delivered.`,
            at: new Date(),
        })

        await contract.save()

        const delivery = milestone.deliveries[milestone.deliveries.length - 1]

        return res.status(200).json({ success: true, message: "Milestone delivered successfully.", data: { milestone, delivery } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function requestRevision(req, res) {
    try {
        const user = await getCurrentUser(req.user._id)

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "client") {
            return res.status(403).json({ success: false, message: "Only clients can request revisions." })
        }

        if (user.status === "suspended") {
            return res.status(403).json({ success: false, message: "Suspended accounts cannot request revisions." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, client: req.user._id })

        if (!contract) {
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            return res.status(422).json({ success: false, message: "This contract is not active." })
        }

        const milestone = getMilestone(contract, req.params.mid)

        if (!milestone) {
            return res.status(404).json({ success: false, message: "Milestone not found." })
        }

        if (milestone.status !== "delivered") {
            return res.status(422).json({ success: false, message: "A revision can only be requested for a delivered milestone." })
        }

        const { note } = req.body

        if (typeof note !== "string" || !note.trim()) {
            return res.status(400).json({ success: false, message: "Revision note is required." })
        }

        const delivery = milestone.deliveries[milestone.deliveries.length - 1]

        if (!delivery) {
            return res.status(422).json({ success: false, message: "No delivery exists for this milestone." })
        }

        delivery.response = "revision"
        delivery.responseNote = note.trim()
        delivery.respondedAt = new Date()

        milestone.status = "revision_requested"

        contract.activity.push({
            type: "revision_requested",
            by: req.user._id,
            message: `Revision requested for milestone "${milestone.title}": ${note.trim()}`,
            at: new Date(),
        })

        await contract.save()

        return res.status(200).json({ success: true, message: "Revision requested successfully.", data: { milestone } })

    } catch (err) {
        return handleError(res, err)
    }
}

async function approveMilestone(req, res) {
    const session = await mongoose.startSession()

    try {
        session.startTransaction()

        const user = await User.findById(req.user._id).session(session)

        if (!user) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (user.role !== "client") {
            await session.abortTransaction()
            return res.status(403).json({ success: false, message: "Only clients can approve milestones." })
        }

        if (user.status === "suspended") {
            await session.abortTransaction()
            return res.status(403).json({ success: false, message: "Suspended accounts cannot approve milestones." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, client: req.user._id }).session(session)

        if (!contract) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "This contract is not active." })
        }

        const milestone = getMilestone(contract, req.params.mid)

        if (!milestone) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Milestone not found." })
        }

        if (milestone.status !== "delivered") {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "Only delivered milestones can be approved." })
        }

        if (!milestone.escrowAmount || milestone.escrowAmount <= 0) {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "No escrow funds are available for this milestone." })
        }

        const freelancer = await User.findById(contract.freelancer).session(session)

        if (!freelancer) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Freelancer not found." })
        }

        const escrowAmount = roundMoney(milestone.escrowAmount)
        const platformFee = roundMoney(escrowAmount * (PLATFORM_FEE_PERCENT / 100))
        const freelancerAmount = roundMoney(escrowAmount - platformFee)

        freelancer.wallet.available = roundMoney(freelancer.wallet.available + freelancerAmount)

        const delivery = milestone.deliveries[milestone.deliveries.length - 1]

        if (delivery) {
            delivery.response = "approved"
            delivery.respondedAt = new Date()
        }

        milestone.status = "approved"
        milestone.approvedAt = new Date()
        milestone.escrowAmount = 0

        contract.activity.push({
            type: "milestone_approved",
            by: req.user._id,
            message: `Milestone "${milestone.title}" was approved.`,
            at: new Date(),
        })

        const allMilestonesApproved = contract.milestones.every((item) => item.status === "approved")

        if (allMilestonesApproved) {
            contract.status = "completed"
            contract.completedAt = new Date()

            contract.activity.push({
                type: "contract_completed",
                by: req.user._id,
                message: "All milestones were approved and the contract was completed.",
                at: new Date(),
            })

            if (contract.source?.type === "job" && contract.source?.job) {
                await Job.updateOne({ _id: contract.source.job }, { $set: { status: "completed" } }, { session })
            }
        }

        await freelancer.save({ session })
        await contract.save({ session })

        const transactions = [{
            user: freelancer._id,
            contract: contract._id,
            milestoneId: milestone._id,
            type: "escrow_release",
            amount: escrowAmount,
            direction: "credit",
            status: "completed",
            reference: `escrow-release:${contract._id}:${milestone._id}`,
        }]

        if (platformFee > 0) {
            transactions.push({
                user: freelancer._id,
                contract: contract._id,
                milestoneId: milestone._id,
                type: "platform_fee",
                amount: platformFee,
                direction: "debit",
                status: "completed",
                reference: `platform-fee:${contract._id}:${milestone._id}`,
            })
        }

        await Transaction.insertMany(transactions, { session })

        await session.commitTransaction()

        return res.status(200).json({ success: true, message: allMilestonesApproved ? "Milestone approved and contract completed successfully." : "Milestone approved successfully.", data: { milestone, contractStatus: contract.status, releasedAmount: escrowAmount, platformFee, freelancerAmount, freelancerWallet: freelancer.wallet } })

    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }

        return handleError(res, err)

    } finally {
        await session.endSession()
    }
}

async function cancelContract(req, res) {
    const session = await mongoose.startSession()

    try {
        session.startTransaction()

        const user = await User.findById(req.user._id).session(session)

        if (!user) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "User not found." })
        }

        if (!["client", "freelancer"].includes(user.role)) {
            await session.abortTransaction()
            return res.status(403).json({ success: false, message: "Only contract participants can cancel a contract." })
        }

        if (user.status === "suspended") {
            await session.abortTransaction()
            return res.status(403).json({ success: false, message: "Suspended accounts cannot cancel contracts." })
        }

        const contract = await Contract.findOne({ _id: req.params.id, $or: [{ client: req.user._id }, { freelancer: req.user._id }] }).session(session)

        if (!contract) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Contract not found." })
        }

        if (contract.status !== "active") {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "Only active contracts can be cancelled." })
        }

        const hasUnresolvedDelivery = contract.milestones.some((milestone) => ["delivered", "revision_requested", "disputed"].includes(milestone.status))

        if (hasUnresolvedDelivery) {
            await session.abortTransaction()
            return res.status(422).json({ success: false, message: "A contract with a delivered, revision-requested, or disputed milestone cannot be cancelled directly." })
        }

        const client = await User.findById(contract.client).session(session)

        if (!client) {
            await session.abortTransaction()
            return res.status(404).json({ success: false, message: "Client not found." })
        }

        let refundTotal = 0
        const refundTransactions = []

        for (const milestone of contract.milestones) {
            if (milestone.status === "pending") {
                milestone.status = "cancelled"
            }

            if (["funded", "in_progress"].includes(milestone.status) && milestone.escrowAmount > 0) {
                const refundAmount = roundMoney(milestone.escrowAmount)

                refundTotal = roundMoney(refundTotal + refundAmount)

                refundTransactions.push({
                    user: client._id,
                    contract: contract._id,
                    milestoneId: milestone._id,
                    type: "escrow_refund",
                    amount: refundAmount,
                    direction: "credit",
                    status: "completed",
                    reference: `escrow-refund:${contract._id}:${milestone._id}`,
                })

                milestone.escrowAmount = 0
                milestone.status = "refunded"
            }
        }

        if (refundTotal > 0) {
            client.wallet.available = roundMoney(client.wallet.available + refundTotal)
            await client.save({ session })
            await Transaction.insertMany(refundTransactions, { session })
        }

        contract.status = "cancelled"

        contract.activity.push({
            type: "contract_cancelled",
            by: req.user._id,
            message: refundTotal > 0 ? `Contract cancelled and ${refundTotal} ${contract.currency} refunded to the client.` : "Contract cancelled.",
            at: new Date(),
        })

        await contract.save({ session })

        await session.commitTransaction()

        return res.status(200).json({ success: true, message: "Contract cancelled successfully.", data: { contract, refundedAmount: refundTotal } })

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
    getContracts,
    getContract,
    addMilestone,
    updateMilestone,
    fundMilestone,
    startMilestone,
    deliverMilestone,
    requestRevision,
    approveMilestone,
    cancelContract,
}