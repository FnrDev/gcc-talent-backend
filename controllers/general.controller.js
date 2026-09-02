const Category = require("../models/Category");
const FreelancerProfile = require("../models/FreelancerProfile");
const Job = require("../models/Job");
const Package = require("../models/Package");
const Service = require("../models/Service");
const Skill = require("../models/Skill");
const User = require("../models/User");

const HOME_CATEGORY_LIMIT = 5;
const HOME_SERVICE_LIMIT = 3;
const HOME_JOB_LIMIT = 3;
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 50;
const MAX_SEARCH_QUERY_LENGTH = 100;
const SEARCH_TYPES = new Set(["jobs", "services", "gigs", "freelancers"]);

const PUBLIC_SERVICE_PROJECT = {
  _id: 1,
  name: 1,
  images: 1,
  freelancer: 1,
  packages: 1,
  startingPrice: 1,
  fastestDelivery: 1,
  ratingAvg: 1,
  ratingCount: 1,
  createdAt: 1,
  updatedAt: 1,
};

class QueryValidationError extends Error {}

function handleError(res, error) {
  if (error instanceof QueryValidationError) {
    return res.status(400).json({ success: false, message: error.message });
  }

  console.error(error);
  return res.status(500).json({ success: false, message: "Internal Server Error" });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function positiveInteger(value, fallback, name, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new QueryValidationError(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new QueryValidationError(`${name} must be at most ${maximum}.`);
  }

  return parsed;
}

function parseSearchQuery(query) {
  if (typeof query.type !== "string") {
    throw new QueryValidationError("type is required and must be a single string value.");
  }

  const requestedType = query.type.trim().toLowerCase();
  if (!SEARCH_TYPES.has(requestedType)) {
    throw new QueryValidationError("type must be one of jobs, services, gigs, or freelancers.");
  }

  if (typeof query.query !== "string" || !query.query.trim()) {
    throw new QueryValidationError("query is required and must be a non-empty string.");
  }

  const searchQuery = query.query.trim();
  if (searchQuery.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new QueryValidationError(`query must be at most ${MAX_SEARCH_QUERY_LENGTH} characters.`);
  }

  return {
    requestedType,
    type: requestedType === "gigs" ? "services" : requestedType,
    query: searchQuery,
    page: positiveInteger(query.page, 1, "page", Number.MAX_SAFE_INTEGER),
    limit: positiveInteger(query.limit, DEFAULT_SEARCH_LIMIT, "limit", MAX_SEARCH_LIMIT),
  };
}

function serviceViewPipeline() {
  return [
    { $match: { isHidden: { $ne: true } } },
    {
      $lookup: {
        from: Package.collection.name,
        let: { packageIds: "$packages", freelancerId: "$freelancer" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$packageIds"] },
                  { $eq: ["$freelancer", "$$freelancerId"] },
                  { $eq: ["$isActive", true] },
                ],
              },
            },
          },
          { $sort: { sortOrder: 1, price: 1, createdAt: 1 } },
          {
            $project: {
              name: 1,
              title: 1,
              description: 1,
              price: 1,
              currency: 1,
              deliveryDays: 1,
              revisions: 1,
              features: 1,
              sortOrder: 1,
            },
          },
        ],
        as: "packages",
      },
    },
    { $match: { "packages.0": { $exists: true } } },
    {
      $lookup: {
        from: User.collection.name,
        let: { freelancerId: "$freelancer" },
        pipeline: [
          {
            $match: {
              role: "freelancer",
              status: "active",
              $expr: { $eq: ["$_id", "$$freelancerId"] },
            },
          },
          {
            $project: {
              name: 1,
              avatarUrl: 1,
              country: 1,
              city: 1,
              ratingAvg: 1,
              ratingCount: 1,
            },
          },
        ],
        as: "freelancer",
      },
    },
    { $unwind: "$freelancer" },
    {
      $set: {
        startingPrice: { $min: "$packages.price" },
        fastestDelivery: { $min: "$packages.deliveryDays" },
        ratingAvg: { $ifNull: ["$freelancer.ratingAvg", 0] },
        ratingCount: { $ifNull: ["$freelancer.ratingCount", 0] },
        recommendationScore: {
          $multiply: [
            { $ifNull: ["$freelancer.ratingAvg", 0] },
            { $ifNull: ["$freelancer.ratingCount", 0] },
          ],
        },
      },
    },
  ];
}

async function getHome(_req, res) {
  try {
    const activeClientIds = await User.distinct("_id", { role: "client", status: "active" });
    const [categories, services, jobs] = await Promise.all([
      Category.find({})
        .select("name slug icon isFeatured")
        .sort({ isFeatured: -1, name: 1 })
        .limit(HOME_CATEGORY_LIMIT)
        .lean(),
      Service.aggregate([
        ...serviceViewPipeline(),
        { $sort: { recommendationScore: -1, ratingAvg: -1, createdAt: -1, _id: -1 } },
        { $limit: HOME_SERVICE_LIMIT },
        { $project: PUBLIC_SERVICE_PROJECT },
      ]),
      Job.find({ status: "open", isHidden: false, client: { $in: activeClientIds } })
        .select("client category skills title description budgetType budgetMin budgetMax experienceLevel duration status deadline proposalsCount isFeatured createdAt updatedAt")
        .populate("client", "name avatarUrl country city ratingAvg ratingCount")
        .populate("category", "name slug")
        .populate("skills", "name category")
        .sort({ isFeatured: -1, createdAt: -1, _id: -1 })
        .limit(HOME_JOB_LIMIT)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: { categories, services, jobs },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function searchJobs(pattern, page, limit) {
  const activeClientIds = await User.distinct("_id", { role: "client", status: "active" });
  const filter = {
    status: "open",
    isHidden: false,
    client: { $in: activeClientIds },
    $or: [{ title: pattern }, { description: pattern }],
  };
  const skip = (page - 1) * limit;

  const [results, total] = await Promise.all([
    Job.find(filter)
      .select("client category skills title description budgetType budgetMin budgetMax experienceLevel duration status deadline proposalsCount isFeatured createdAt updatedAt")
      .populate("client", "name avatarUrl country city ratingAvg ratingCount")
      .populate("category", "name slug")
      .populate("skills", "name category")
      .sort({ isFeatured: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Job.countDocuments(filter),
  ]);

  return { results, total };
}

async function searchServices(pattern, page, limit) {
  const [result] = await Service.aggregate([
    ...serviceViewPipeline(),
    {
      $match: {
        $or: [
          { name: pattern },
          { "freelancer.name": pattern },
          { "packages.name": pattern },
          { "packages.title": pattern },
          { "packages.description": pattern },
          { "packages.features": pattern },
        ],
      },
    },
    { $sort: { recommendationScore: -1, ratingAvg: -1, createdAt: -1, _id: -1 } },
    {
      $facet: {
        results: [
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: PUBLIC_SERVICE_PROJECT },
        ],
        totals: [{ $count: "count" }],
      },
    },
  ]);

  return {
    results: result?.results || [],
    total: result?.totals?.[0]?.count || 0,
  };
}

async function searchFreelancers(pattern, page, limit) {
  const [result] = await User.aggregate([
    { $match: { role: "freelancer", status: "active" } },
    {
      $lookup: {
        from: FreelancerProfile.collection.name,
        localField: "_id",
        foreignField: "user",
        as: "profile",
      },
    },
    { $unwind: "$profile" },
    {
      $lookup: {
        from: Skill.collection.name,
        localField: "profile.skills",
        foreignField: "_id",
        as: "skillDocuments",
      },
    },
    { $set: { "profile.skills": "$skillDocuments" } },
    {
      $match: {
        $or: [
          { name: pattern },
          { country: pattern },
          { city: pattern },
          { "profile.headline": pattern },
          { "profile.bio": pattern },
          { "profile.skills.name": pattern },
        ],
      },
    },
    { $sort: { ratingAvg: -1, ratingCount: -1, createdAt: -1, _id: -1 } },
    {
      $project: {
        _id: 1,
        name: 1,
        avatarUrl: 1,
        country: 1,
        city: 1,
        ratingAvg: 1,
        ratingCount: 1,
        isEmailVerified: 1,
        createdAt: 1,
        profile: {
          _id: "$profile._id",
          headline: "$profile.headline",
          bio: "$profile.bio",
          hourlyRate: "$profile.hourlyRate",
          currency: "$profile.currency",
          languages: "$profile.languages",
          availability: "$profile.availability",
          completedContracts: "$profile.completedContracts",
          skills: "$profile.skills",
        },
      },
    },
    {
      $facet: {
        results: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        totals: [{ $count: "count" }],
      },
    },
  ]);

  return {
    results: result?.results || [],
    total: result?.totals?.[0]?.count || 0,
  };
}

async function searchMarketplace(req, res) {
  try {
    const { requestedType, type, query, page, limit } = parseSearchQuery(req.query);
    const pattern = new RegExp(escapeRegExp(query), "i");

    let searchResult;
    if (type === "jobs") searchResult = await searchJobs(pattern, page, limit);
    else if (type === "services") searchResult = await searchServices(pattern, page, limit);
    else searchResult = await searchFreelancers(pattern, page, limit);

    const totalPages = searchResult.total === 0 ? 0 : Math.ceil(searchResult.total / limit);

    return res.status(200).json({
      success: true,
      data: {
        requestedType,
        type,
        query,
        results: searchResult.results,
        pagination: { page, limit, total: searchResult.total, totalPages },
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { getHome, searchMarketplace };
