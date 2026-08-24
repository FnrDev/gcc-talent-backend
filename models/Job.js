// models/Job.js
const mongoose = require("mongoose");

const JOB_BUDGET_TYPES = ["fixed", "hourly"];
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
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: "draft",
      index: true,
    },
    deadline: {
      type: Date,
    },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

// Supports F-JOB-03 keyword search across title/description.
jobSchema.index({ title: "text", description: "text" });
jobSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Job", jobSchema);
