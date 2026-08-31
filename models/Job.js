// models/Job.js
const mongoose = require("mongoose");

const JOB_BUDGET_TYPES = ["fixed", "hourly"];
const JOB_EXPERIENCE_LEVELS = ["entry", "intermediate", "expert"];
const JOB_STATUSES = ["draft", "open", "in_progress", "completed", "closed"];

const jobSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },
    skills: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Skill",
        index: true,
      },
    ],
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    budgetType: {
      type: String,
      enum: JOB_BUDGET_TYPES,
      required: true,
    },
    budgetMin: {
      type: Number,
      min: 0,
    },
    budgetMax: {
      type: Number,
      min: 0,
    },
    // F-JOB-01: experience level, expected duration and attachments.
    experienceLevel: {
      type: String,
      enum: JOB_EXPERIENCE_LEVELS,
    },
    duration: {
      type: String, // e.g. "1-3 months"
      trim: true,
    },
    attachments: [
      {
        _id: false,
        url: { type: String, required: true },
        name: { type: String, required: true },
        size: { type: Number },
      },
    ],
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: "draft",
      index: true,
    },
    deadline: {
      type: Date,
    },
    // F-JOB-05: "My Jobs" dashboard shows proposal counts per job.
    proposalsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // F-ADM-04: admin moderation — hide/unhide, feature on homepage.
    isFeatured: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

// Supports F-JOB-03 keyword search across title/description.
jobSchema.index({ title: "text", description: "text" });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ status: 1, isHidden: 1, category: 1, createdAt: -1 });
jobSchema.index({ status: 1, isHidden: 1, skills: 1 });
jobSchema.index({ status: 1, isHidden: 1, budgetType: 1, experienceLevel: 1 });

module.exports = mongoose.model("Job", jobSchema);
