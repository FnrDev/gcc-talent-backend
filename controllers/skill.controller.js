const mongoose = require("mongoose");
const Skill = require("../models/Skill");
const Category = require("../models/Category");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function handleError(res, err) {
  if (err?.code === 11000) {
    return res.status(409).json({ message: "A skill with that name already exists." });
  }

  if (err?.name === "ValidationError") {
    return res.status(400).json({ message: err.message });
  }

  if (err?.name === "CastError") {
    return res.status(404).json({ message: "Skill not found." });
  }

  console.error(err);
  return res.status(500).json({ message: "Internal Server Error" });
}

async function resolveCategoryFilter(query, res) {
  if (query.category) {
    if (!mongoose.Types.ObjectId.isValid(query.category)) {
      res.status(400).json({ message: "Invalid category id." });
      return null;
    }

    const categoryExists = await Category.exists({ _id: query.category });
    if (!categoryExists) {
      res.status(404).json({ message: "Category not found." });
      return null;
    }

    return query.category;
  }

  if (typeof query.categorySlug === "string" && query.categorySlug.trim()) {
    const category = await Category.findOne({
      slug: query.categorySlug.trim().toLowerCase(),
    })
      .select("_id")
      .lean();

    if (!category) {
      res.status(404).json({ message: "Category not found." });
      return null;
    }

    return category._id;
  }

  return undefined;
}

async function getSkills(req, res) {
  try {
    const filter = {};
    const category = await resolveCategoryFilter(req.query, res);

    if (category === null) return;
    if (category !== undefined) filter.category = category;

    if (typeof req.query.search === "string" && req.query.search.trim()) {
      filter.name = new RegExp(escapeRegExp(req.query.search.trim()), "i");
    }

    const skills = await Skill.find(filter)
      .populate("category", "name slug")
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({ skills, count: skills.length });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getSkill(req, res) {
  try {
    const skill = await Skill.findById(req.params.id)
      .populate("category", "name slug")
      .lean();

    if (!skill) return res.status(404).json({ message: "Skill not found." });
    return res.status(200).json({ skill });
  } catch (err) {
    return handleError(res, err);
  }
}

async function createSkill(req, res) {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const { category } = req.body;

    if (!name) return res.status(400).json({ message: "Skill name is required." });
    if (!mongoose.Types.ObjectId.isValid(category)) {
      return res.status(400).json({ message: "A valid category id is required." });
    }

    const categoryExists = await Category.exists({ _id: category });
    if (!categoryExists) return res.status(404).json({ message: "Category not found." });

    const skill = await Skill.create({ name, category });
    await skill.populate("category", "name slug");

    return res.status(201).json({ message: "Skill created.", skill });
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateSkill(req, res) {
  try {
    const updates = {};

    if (Object.hasOwn(req.body, "name")) {
      if (typeof req.body.name !== "string" || !req.body.name.trim()) {
        return res.status(400).json({ message: "Skill name cannot be empty." });
      }
      updates.name = req.body.name.trim();
    }

    if (Object.hasOwn(req.body, "category")) {
      if (!mongoose.Types.ObjectId.isValid(req.body.category)) {
        return res.status(400).json({ message: "A valid category id is required." });
      }

      const categoryExists = await Category.exists({ _id: req.body.category });
      if (!categoryExists) return res.status(404).json({ message: "Category not found." });
      updates.category = req.body.category;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Provide a name or category to update." });
    }

    const skill = await Skill.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).populate("category", "name slug");

    if (!skill) return res.status(404).json({ message: "Skill not found." });
    return res.status(200).json({ message: "Skill updated.", skill });
  } catch (err) {
    return handleError(res, err);
  }
}

async function deleteSkill(req, res) {
  try {
    const skill = await Skill.findByIdAndDelete(req.params.id);

    if (!skill) return res.status(404).json({ message: "Skill not found." });
    return res.status(200).json({ message: "Skill deleted." });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = {
  getSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
};
