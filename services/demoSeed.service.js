const crypto = require("crypto");
const mongoose = require("mongoose");

const {
  User,
  FreelancerProfile,
  ClientProfile,
  Category,
  Skill,
  Job,
  Proposal,
  Contract,
  Transaction,
  Review,
  Package,
  Service,
} = require("../models");

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const CATEGORY_SEEDS = [
  { name: "Web Development", slug: "web-development", icon: "code", skills: ["React", "Node.js", "MongoDB"] },
  { name: "Mobile Development", slug: "mobile-development", icon: "smartphone", skills: ["React Native", "Swift", "Flutter"] },
  { name: "Graphic Design", slug: "graphic-design", icon: "paintbrush", skills: ["Brand Identity", "Figma", "Illustration"] },
  { name: "Digital Marketing", slug: "digital-marketing", icon: "megaphone", skills: ["SEO", "Paid Social", "Content Strategy"] },
  { name: "Content Writing", slug: "content-writing", icon: "pen", skills: ["Arabic Copywriting", "Technical Writing", "Editing"] },
  { name: "Video & Audio", slug: "video-audio", icon: "video", skills: ["Video Editing", "Motion Design", "Voice Over"] },
];

const FREELANCER_NAMES = [
  "Sara Ahmed",
  "Mohammed Al-Farsi",
  "Lina Yousef",
  "Noor Al Hashimi",
  "Yousef Al Doseri",
  "Hessa Al Qahtani",
  "Fahad Al Mansoor",
  "Maya Khoury",
  "Ali Al Balushi",
  "Dana Al Sabah",
  "Omar Al Nasser",
  "Reem Al Suwaidi",
  "Khalid Al Harbi",
  "Layla Haddad",
  "Abdullah Al Zayani",
  "Mariam Al Shamsi",
  "Tariq Al Amri",
  "Rana Abu Saleh",
  "Salman Al Khalifa",
  "Aya Al Ansari",
];

const CLIENT_NAMES = [
  "Gulf Horizon Trading",
  "Pearl Coast Logistics",
  "Manama Studio",
  "Nukhba Foods",
  "Sadu Commerce",
  "Falcon Health",
  "Riyada Learning",
  "Dhow Technology",
  "Palm Hospitality",
  "Majlis Media",
];

const CLIENT_INDUSTRIES = [
  "Retail & Commerce",
  "Logistics",
  "Creative Services",
  "Food & Beverage",
  "E-commerce",
  "Healthcare",
  "Education",
  "Technology",
  "Hospitality",
  "Media",
];

const CLIENT_COMPANY_SIZES = ["2_10", "11_50", "51_200", "201_500", "501_plus"];

const LOCATIONS = [
  ["Bahrain", "Manama"],
  ["Saudi Arabia", "Riyadh"],
  ["United Arab Emirates", "Dubai"],
  ["Kuwait", "Kuwait City"],
  ["Oman", "Muscat"],
  ["Qatar", "Doha"],
];

const JOB_TITLES = [
  "Build a bilingual company website",
  "Design a visual identity for a retail launch",
  "Create a React Native customer app",
  "Plan a GCC paid social campaign",
  "Write Arabic and English product pages",
  "Edit a short hospitality campaign video",
  "Develop an internal operations dashboard",
  "Refresh our mobile checkout experience",
  "Prepare a brand guideline document",
  "Run a technical SEO audit",
  "Write an investor-ready company profile",
  "Produce an Arabic explainer voice-over",
  "Build a booking API with Node.js",
  "Design a Figma component library",
  "Create a monthly content plan",
];

function databaseHosts(uri) {
  const withoutScheme = uri.replace(/^mongodb(?:\+srv)?:\/\//, "");
  const authority = withoutScheme.split("/", 1)[0];
  const hosts = authority.slice(authority.lastIndexOf("@") + 1).split(",");

  return hosts.map((entry) => {
    if (entry.startsWith("[")) return entry.slice(1, entry.indexOf("]"));
    return entry.split(":", 1)[0];
  });
}

function assertSafeDatabaseTarget(uri) {
  if (!uri) throw new Error("MONGODB_URI is required.");
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error("MONGODB_URI must be a valid MongoDB connection string.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo data cannot be seeded with NODE_ENV=production.");
  }

  const hosts = databaseHosts(uri);
  if (hosts.length === 0 || hosts.some((host) => !LOCAL_DATABASE_HOSTS.has(host))) {
    throw new Error("Demo data can only be seeded into a local MongoDB instance.");
  }
}

function demoPassword() {
  if (process.env.DEMO_SEED_PASSWORD) return process.env.DEMO_SEED_PASSWORD;
  return crypto.randomBytes(32).toString("base64url");
}

async function upsertUser({ name, email, role, avatarUrl, country, city, ratingAvg = 0, ratingCount = 0 }) {
  const normalizedEmail = email.toLowerCase();
  let user = await User.findOne({ email: normalizedEmail });
  const fields = {
    name,
    email: normalizedEmail,
    role,
    status: "active",
    isEmailVerified: true,
    avatarUrl,
    country,
    city,
    ratingAvg,
    ratingCount,
  };

  if (!user) {
    user = await User.create({ ...fields, hashedPassword: demoPassword() });
  } else {
    user = await User.findByIdAndUpdate(
      user._id,
      { $set: fields },
      { returnDocument: "after", runValidators: true },
    );
  }

  return user;
}

async function seedTaxonomy() {
  const categories = [];
  const skills = [];

  for (const [index, seed] of CATEGORY_SEEDS.entries()) {
    const category = await Category.findOneAndUpdate(
      { slug: seed.slug },
      { $set: { name: seed.name, slug: seed.slug, icon: seed.icon, isFeatured: index < 6 } },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );
    categories.push(category);

    const categorySkills = [];
    for (const skillName of seed.skills) {
      const skill = await Skill.findOneAndUpdate(
        { name: skillName },
        { $set: { name: skillName, category: category._id } },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
      );
      skills.push(skill);
      categorySkills.push(skill);
    }
    category.skills = categorySkills;
  }

  return { categories, skills };
}

async function seedFreelancers(categories) {
  const freelancers = [];
  const services = [];
  let packageCount = 0;

  for (const [index, name] of FREELANCER_NAMES.entries()) {
    const [country, city] = LOCATIONS[index % LOCATIONS.length];
    const category = categories[index % categories.length];
    const ratingAvg = Number((4.5 + (index % 5) * 0.1).toFixed(1));
    const user = await upsertUser({
      name,
      email: `demo.freelancer.${String(index + 1).padStart(2, "0")}@gcctalents.local`,
      role: "freelancer",
      avatarUrl: `/placeholders/avatar-${(index % 11) + 1}.svg`,
      country,
      city,
      ratingAvg,
      ratingCount: 8 + index * 3,
    });

    const profile = await FreelancerProfile.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          headline: `${category.name} specialist for GCC teams`,
          bio: `I help growing GCC businesses deliver practical ${category.name.toLowerCase()} work with clear milestones and reliable communication.`,
          skills: category.skills.slice(0, 3).map((skill) => skill._id),
          hourlyRate: 12 + index * 2,
          currency: "BHD",
          languages: [
            { name: "Arabic", level: "native" },
            { name: "English", level: "fluent" },
          ],
          availability: index % 5 === 0 ? "part_time" : "full_time",
          portfolio: [
            {
              title: `${category.name} launch project`,
              description: "A recent regional project delivered from brief through handover.",
              imageUrl: `/placeholders/cover-${(index % 6) + 1}.svg`,
              link: "https://example.com",
            },
          ],
          completedContracts: Math.floor(index / 2),
          totalEarned: 250 + index * 175,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );

    const packageItem = await Package.findOneAndUpdate(
      { freelancer: user._id, name: "Standard" },
      {
        $set: {
          name: "Standard",
          title: `${category.name} delivery package`,
          description: "A clearly scoped delivery with discovery, execution, and final handover.",
          price: 18 + index * 3,
          currency: "BHD",
          deliveryDays: 4 + (index % 8),
          revisions: 2,
          features: ["Discovery call", "Milestone updates", "Final source files"],
          isActive: true,
          sortOrder: 0,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );

    const service = await Service.findOneAndUpdate(
      { freelancer: user._id, name: `${category.name} for growing businesses` },
      {
        $set: {
          packages: [packageItem._id],
          images: [],
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );

    freelancers.push({ user, profile });
    services.push(service);
    packageCount += 1;
  }

  return { freelancers, services, packageCount };
}

async function seedClients() {
  const clients = [];

  for (const [index, companyName] of CLIENT_NAMES.entries()) {
    const [country, city] = LOCATIONS[(index + 2) % LOCATIONS.length];
    const user = await upsertUser({
      name: `${companyName} Team`,
      email: `demo.client.${String(index + 1).padStart(2, "0")}@gcctalents.local`,
      role: "client",
      avatarUrl: `/placeholders/avatar-${((index + 4) % 11) + 1}.svg`,
      country,
      city,
      ratingAvg: Number((4.4 + (index % 6) * 0.1).toFixed(1)),
      ratingCount: 4 + index,
    });

    const profile = await ClientProfile.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          companyName,
          isCompany: true,
          description: `${companyName} hires independent GCC talent for focused product and growth projects.`,
          website: `https://example.com/${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          industry: CLIENT_INDUSTRIES[index % CLIENT_INDUSTRIES.length],
          companySize: CLIENT_COMPANY_SIZES[index % CLIENT_COMPANY_SIZES.length],
          foundedYear: 2008 + index,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );

    clients.push({ user, profile });
  }

  return clients;
}

async function seedJobs(clients, categories) {
  const jobs = [];

  for (const [index, title] of JOB_TITLES.entries()) {
    const client = clients[index % clients.length].user;
    const category = categories[index % categories.length];
    const status = index < 9 ? "open" : index < 12 ? "in_progress" : "completed";
    const job = await Job.findOneAndUpdate(
      { client: client._id, title },
      {
        $set: {
          category: category._id,
          skills: category.skills.slice(0, 2).map((skill) => skill._id),
          description: `We are looking for an experienced specialist to ${title.toLowerCase()}. The scope includes discovery, regular updates, and a documented handover.`,
          budgetType: index % 4 === 0 ? "hourly" : "fixed",
          budgetMin: 45 + index * 5,
          budgetMax: 90 + index * 10,
          experienceLevel: ["entry", "intermediate", "expert"][index % 3],
          duration: ["Less than 1 month", "1-3 months", "3-6 months"][index % 3],
          status,
          deadline: new Date(Date.now() + (14 + index) * 24 * 60 * 60 * 1000),
          proposalsCount: status === "open" ? 2 + (index % 6) : 1,
          isFeatured: index < 4,
          isHidden: false,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );
    jobs.push(job);
  }

  return jobs;
}

async function seedOpenJobProposals(jobs, freelancers) {
  let proposalCount = 0;

  for (const [jobIndex, job] of jobs.entries()) {
    if (job.status !== "open") continue;
    const desiredCount = 2 + (jobIndex % 4);

    for (let proposalIndex = 0; proposalIndex < desiredCount; proposalIndex += 1) {
      const freelancer = freelancers[(jobIndex + proposalIndex) % freelancers.length].user;
      await Proposal.findOneAndUpdate(
        { job: job._id, freelancer: freelancer._id },
        {
          $set: {
            coverLetter: "I have relevant regional experience and can begin with a focused discovery milestone.",
            amount: 55 + jobIndex * 5 + proposalIndex * 4,
            deliveryDays: 6 + proposalIndex,
            milestones: [],
            attachments: [],
            status: proposalIndex === 0 && jobIndex % 3 === 0 ? "shortlisted" : "pending",
          },
        },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
      );
    }

    const actualCount = await Proposal.countDocuments({ job: job._id });
    await Job.findByIdAndUpdate(job._id, { $set: { proposalsCount: actualCount } });
    proposalCount += actualCount;
  }

  return proposalCount;
}

async function seedContractsAndReviews({ jobs, clients, freelancers }) {
  const contracts = [];
  const reviews = [];

  for (let index = 0; index < 6; index += 1) {
    const job = jobs[9 + index];
    const client = clients[(9 + index) % clients.length].user;
    const freelancer = freelancers[index].user;
    const amount = 80 + index * 25;
    const completed = index >= 3;
    const proposal = await Proposal.findOneAndUpdate(
      { job: job._id, freelancer: freelancer._id },
      {
        $set: {
          coverLetter: "I can deliver this scope with a clear first milestone and regular progress updates.",
          amount,
          deliveryDays: 7 + index,
          milestones: [
            {
              title: "Project delivery",
              description: "Complete the agreed scope and provide the final handover.",
              amount,
              dueDate: new Date(Date.now() + (10 + index) * 24 * 60 * 60 * 1000),
            },
          ],
          attachments: [],
          status: "accepted",
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );

    const now = new Date();
    const contract = await Contract.findOneAndUpdate(
      { "source.job": job._id },
      {
        $set: {
          client: client._id,
          freelancer: freelancer._id,
          source: { type: "job", job: job._id, proposal: proposal._id },
          title: job.title,
          totalAmount: amount,
          currency: "BHD",
          status: completed ? "completed" : "active",
          milestones: [
            {
              title: "Project delivery",
              description: "Complete the agreed scope and provide the final handover.",
              amount,
              dueDate: new Date(Date.now() + (10 + index) * 24 * 60 * 60 * 1000),
              status: completed ? "approved" : "in_progress",
              escrowAmount: completed ? 0 : amount,
              fundedAt: now,
              approvedAt: completed ? now : undefined,
            },
          ],
          activity: [
            { type: "contract_started", by: client._id, message: "The contract was started.", at: now },
            { type: "milestone_funded", by: client._id, message: "The first milestone was funded.", at: now },
          ],
          startedAt: now,
          completedAt: completed ? now : undefined,
          endedAt: completed ? now : undefined,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );
    contracts.push(contract);

    await Job.findByIdAndUpdate(job._id, { $set: { status: completed ? "completed" : "in_progress" } });

    await Transaction.findOneAndUpdate(
      { reference: `demo-fund-${contract._id}` },
      {
        $setOnInsert: {
          user: client._id,
          contract: contract._id,
          milestoneId: contract.milestones[0]._id,
          type: "escrow_fund",
          amount,
          direction: "debit",
          status: "completed",
          reference: `demo-fund-${contract._id}`,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    if (completed) {
      const freelancerReview = await Review.findOneAndUpdate(
        { contract: contract._id, reviewer: client._id },
        {
          $set: {
            reviewee: freelancer._id,
            rating: 5 - (index % 2),
            comment: "Clear communication, reliable delivery, and a well-organised handover.",
          },
        },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
      );
      const clientReview = await Review.findOneAndUpdate(
        { contract: contract._id, reviewer: freelancer._id },
        {
          $set: {
            reviewee: client._id,
            rating: 5,
            comment: "The brief was clear and feedback arrived quickly throughout the project.",
          },
        },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
      );
      reviews.push(freelancerReview, clientReview);

      const release = Number((amount * 0.9).toFixed(2));
      await Transaction.findOneAndUpdate(
        { reference: `demo-release-${contract._id}` },
        {
          $setOnInsert: {
            user: freelancer._id,
            contract: contract._id,
            milestoneId: contract.milestones[0]._id,
            type: "escrow_release",
            amount: release,
            direction: "credit",
            status: "completed",
            reference: `demo-release-${contract._id}`,
          },
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
    }
  }

  // Keep the denormalized rating counters aligned with the actual Review
  // collection, including zero-review demo users. This prevents public cards
  // from advertising review totals that cannot be opened on the profile.
  const marketplaceUserIds = [
    ...clients.map(({ user }) => user._id),
    ...freelancers.map(({ user }) => user._id),
  ];
  for (const userId of marketplaceUserIds) {
    const [rating] = await Review.aggregate([
      { $match: { reviewee: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, ratingAvg: { $avg: "$rating" }, ratingCount: { $sum: 1 } } },
    ]);
    await User.findByIdAndUpdate(userId, {
      $set: {
        ratingAvg: Number((rating?.ratingAvg || 0).toFixed(2)),
        ratingCount: rating?.ratingCount || 0,
      },
    });
  }

  return { contracts, reviews };
}

async function refreshProfileCounters({ clients, freelancers }) {
  for (const { user } of clients) {
    const [jobsPosted, completedContracts, spending] = await Promise.all([
      Job.countDocuments({ client: user._id, status: { $ne: "draft" } }),
      Contract.countDocuments({ client: user._id, status: "completed" }),
      Transaction.aggregate([
        { $match: { user: user._id, type: "escrow_fund", status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);
    await ClientProfile.findOneAndUpdate(
      { user: user._id },
      { $set: { jobsPosted, totalSpent: spending[0]?.total || 0, completedContracts } },
    );
  }

  for (const { user } of freelancers) {
    const [completedContracts, earnings] = await Promise.all([
      Contract.countDocuments({ freelancer: user._id, status: "completed" }),
      Transaction.aggregate([
        { $match: { user: user._id, type: "escrow_release", status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);
    await FreelancerProfile.findOneAndUpdate(
      { user: user._id },
      { $set: { completedContracts, totalEarned: earnings[0]?.total || 0 } },
    );
    await User.findByIdAndUpdate(user._id, {
      $set: {
        "wallet.available": earnings[0]?.total || 0,
        "wallet.pending": 0,
      },
    });
  }
}

async function seedMarketplaceData({
  uri = process.env.MONGODB_URI,
  manageConnection = false,
} = {}) {
  assertSafeDatabaseTarget(uri);

  if (manageConnection) {
    await mongoose.connect(uri);
  } else if (mongoose.connection.readyState !== 1) {
    throw new Error("A local MongoDB connection is required before seeding.");
  }

  const admin = await upsertUser({
    name: "GCC Talents Demo Admin",
    email: "demo.admin@gcctalents.local",
    role: "admin",
    country: "Bahrain",
    city: "Manama",
  });
  const { categories, skills } = await seedTaxonomy();
  const { freelancers, services, packageCount } = await seedFreelancers(categories);
  const clients = await seedClients();
  const jobs = await seedJobs(clients, categories);
  const openJobProposals = await seedOpenJobProposals(jobs, freelancers);
  const { contracts, reviews } = await seedContractsAndReviews({
    jobs,
    clients,
    freelancers,
  });
  await refreshProfileCounters({ clients, freelancers });

  return {
    database: mongoose.connection.name,
    admins: admin ? 1 : 0,
    categories: categories.length,
    skills: skills.length,
    freelancers: freelancers.length,
    clients: clients.length,
    profiles: freelancers.length + clients.length,
    packages: packageCount,
    services: services.length,
    jobs: jobs.length,
    proposals: openJobProposals + contracts.length,
    contracts: contracts.length,
    reviews: reviews.length,
  };
}

module.exports = {
  assertSafeDatabaseTarget,
  seedMarketplaceData,
};
