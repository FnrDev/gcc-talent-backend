const mongoose = require("mongoose")
const Category = require("../models/Category")
const Skill = require("../models/Skill")
const Job = require("../models/Job")

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

function handleError(res, err) {
    if (err?.code === 11000) {
        const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || "value"
        return res.status(409).json({ success: false, message: `A category with that ${field} already exists.` })
    }

    if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, message: err.message })
    }

    if (err?.name === "CastError") {
        return res.status(404).json({ success: false, message: "Category not found." })
    }

    console.error(err)
    return res.status(500).json({ success: false, message: "Internal Server Error" })
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// "Web Development" -> "web-development". Keeps Arabic letters intact.
function slugify(value) {
    return value
        .normalize("NFKD")
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
}

function parsePagination(query) {
    const requestedPage = Number.parseInt(query.page, 10)
    const requestedLimit = Number.parseInt(query.limit, 10)

    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, MAX_PAGE_SIZE)
            : DEFAULT_PAGE_SIZE

    return { page, limit, skip: (page - 1) * limit }
}

// Counts the skills of every listed category in one aggregation, so listing
// N categories does not fire N extra count queries (NF-PERF-01).
async function attachSkillCounts(categories) {
    if (categories.length === 0) {
        return categories
    }

    const rows = await Skill.aggregate([
        { $match: { category: { $in: categories.map((category) => category._id) } } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
    ])

    const counts = new Map(rows.map((row) => [String(row._id), row.count]))

    return categories.map((category) => ({
        ...category,
        skillsCount: counts.get(String(category._id)) || 0,
    }))
}

/* -------------------------------------------------------------------------- */
/*  Public reads — search filters, job forms, and the landing page            */
/* -------------------------------------------------------------------------- */

// GET /categories?search=&featured=true&page=&limit=
async function getCategories(req, res) {
    try {
        const { page, limit, skip } = parsePagination(req.query)
        const filter = {}

        if (typeof req.query.search === "string" && req.query.search.trim()) {
            filter.name = new RegExp(escapeRegExp(req.query.search.trim()), "i")
        }

        if (req.query.featured !== undefined) {
            if (!["true", "false"].includes(req.query.featured)) {
                return res.status(400).json({ success: false, message: "featured must be true or false." })
            }

            filter.isFeatured = req.query.featured === "true"
        }

        const [categories, total] = await Promise.all([
            Category.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
            Category.countDocuments(filter),
        ])

        return res.status(200).json({
            success: true,
            data: {
                categories: await attachSkillCounts(categories),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
                },
            },
        })
    } catch (err) {
        return handleError(res, err)
    }
}

// GET /categories/:id — one category with the skills that belong to it.
async function getCategory(req, res) {
    try {
        const category = await Category.findById(req.params.id).lean()

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." })
        }

        const skills = await Skill.find({ category: category._id })
            .select("name")
            .sort({ name: 1 })
            .lean()

        return res.status(200).json({
            success: true,
            data: {
                category: { ...category, skillsCount: skills.length },
                skills,
            },
        })
    } catch (err) {
        return handleError(res, err)
    }
}

// GET /categories/slug/:slug — lets the frontend build readable filter URLs.
async function getCategoryBySlug(req, res) {
    try {
        const slug = String(req.params.slug || "").trim().toLowerCase()

        if (!slug) {
            return res.status(400).json({ success: false, message: "A category slug is required." })
        }

        const category = await Category.findOne({ slug }).lean()

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." })
        }

        const skills = await Skill.find({ category: category._id })
            .select("name")
            .sort({ name: 1 })
            .lean()

        return res.status(200).json({
            success: true,
            data: {
                category: { ...category, skillsCount: skills.length },
                skills,
            },
        })
    } catch (err) {
        return handleError(res, err)
    }
}

/* -------------------------------------------------------------------------- */
/*  Admin management (F-ADM-03)                                               */
/*  Mount behind verifyToken + requireAdmin.                                  */
/* -------------------------------------------------------------------------- */

// POST /admin/categories  { name, slug?, icon?, isFeatured? }
async function createCategory(req, res) {
    try {
        const { name, slug, icon, isFeatured } = req.body

        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({ success: false, message: "Category name is required." })
        }

        const finalSlug = slugify(typeof slug === "string" && slug.trim() ? slug : name)

        if (!finalSlug) {
            return res.status(400).json({ success: false, message: "A valid category slug is required." })
        }

        if (icon !== undefined && typeof icon !== "string") {
            return res.status(400).json({ success: false, message: "icon must be a string." })
        }

        if (isFeatured !== undefined && typeof isFeatured !== "boolean") {
            return res.status(400).json({ success: false, message: "isFeatured must be a boolean." })
        }

        const category = await Category.create({
            name: name.trim(),
            slug: finalSlug,
            icon: typeof icon === "string" ? icon.trim() : undefined,
            isFeatured: isFeatured ?? false,
        })

        return res.status(201).json({
            success: true,
            message: "Category created successfully.",
            data: { category },
        })
    } catch (err) {
        return handleError(res, err)
    }
}

// PATCH /admin/categories/:id
async function updateCategory(req, res) {
    try {
        const updates = {}

        if (Object.hasOwn(req.body, "name")) {
            if (typeof req.body.name !== "string" || !req.body.name.trim()) {
                return res.status(400).json({ success: false, message: "Category name cannot be empty." })
            }

            updates.name = req.body.name.trim()
        }

        if (Object.hasOwn(req.body, "slug")) {
            const slug = typeof req.body.slug === "string" ? slugify(req.body.slug) : ""

            if (!slug) {
                return res.status(400).json({ success: false, message: "Category slug cannot be empty." })
            }

            updates.slug = slug
        }

        if (Object.hasOwn(req.body, "icon")) {
            if (typeof req.body.icon !== "string") {
                return res.status(400).json({ success: false, message: "icon must be a string." })
            }

            updates.icon = req.body.icon.trim()
        }

        if (Object.hasOwn(req.body, "isFeatured")) {
            if (typeof req.body.isFeatured !== "boolean") {
                return res.status(400).json({ success: false, message: "isFeatured must be a boolean." })
            }

            updates.isFeatured = req.body.isFeatured
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "Provide name, slug, icon, or isFeatured to update." })
        }

        const category = await Category.findByIdAndUpdate(req.params.id, updates, {
            new: true,
            runValidators: true,
        })

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." })
        }

        return res.status(200).json({
            success: true,
            message: "Category updated successfully.",
            data: { category },
        })
    } catch (err) {
        return handleError(res, err)
    }
}

// DELETE /admin/categories/:id — refuses while skills or jobs still reference it.
async function deleteCategory(req, res) {
    try {
        const [category, skillsCount, jobsCount] = await Promise.all([
            Category.findById(req.params.id),
            Skill.countDocuments({ category: req.params.id }),
            Job.countDocuments({ category: req.params.id }),
        ])

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found." })
        }

        if (skillsCount > 0 || jobsCount > 0) {
            return res.status(409).json({
                success: false,
                message: "Category is still referenced and cannot be deleted.",
                references: { skills: skillsCount, jobs: jobsCount },
            })
        }

        await category.deleteOne()

        return res.status(200).json({ success: true, message: "Category deleted successfully." })
    } catch (err) {
        return handleError(res, err)
    }
}

module.exports = {
    getCategories,
    getCategory,
    getCategoryBySlug,
    createCategory,
    updateCategory,
    deleteCategory,
}
