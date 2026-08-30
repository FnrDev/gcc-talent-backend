const crypto = require("crypto");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const { User, FreelancerProfile, Package, Service } = require("../models");

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const FEATURED_FREELANCERS = [
  {
    user: {
      name: "Sara Ahmed",
      email: "sara.ahmed.featured@example.com",
      avatarUrl: "/placeholders/avatar-1.svg",
      country: "Bahrain",
      city: "Manama",
      ratingAvg: 4.8,
      ratingCount: 314,
    },
    profile: {
      headline: "Brand identity and UI designer",
      bio: "Bilingual designer creating clear, practical brand systems for growing GCC businesses.",
      hourlyRate: 28,
      currency: "BHD",
      languages: [
        { name: "Arabic", level: "native" },
        { name: "English", level: "fluent" },
      ],
      availability: "full_time",
      completedContracts: 214,
      totalEarned: 16420,
    },
    service: {
      name: "Logo & Brand Identity Design",
      packages: [
        {
          name: "Basic",
          title: "Starter logo package",
          description: "A focused logo direction with ready-to-use digital files.",
          price: 10,
          currency: "BHD",
          deliveryDays: 3,
          revisions: 2,
          features: ["1 logo concept", "PNG and SVG files", "Social media avatar"],
        },
        {
          name: "Standard",
          title: "Complete brand identity",
          description: "A flexible visual identity for web, social, and print use.",
          price: 45,
          currency: "BHD",
          deliveryDays: 5,
          revisions: 4,
          features: [
            "3 logo concepts",
            "Colour palette",
            "Typography system",
            "Editable source files",
          ],
        },
        {
          name: "Premium",
          title: "Full brand system",
          description: "A documented brand system prepared for a growing team.",
          price: 100,
          currency: "BHD",
          deliveryDays: 7,
          revisions: 6,
          features: [
            "5 logo concepts",
            "Brand guidelines",
            "Stationery mockups",
            "Editable source files",
            "Commercial usage rights",
          ],
        },
      ],
    },
  },
  {
    user: {
      name: "Mohammed Al-Farsi",
      email: "mohammed.alfarsi.featured@example.com",
      avatarUrl: "/placeholders/avatar-2.svg",
      country: "Oman",
      city: "Muscat",
      ratingAvg: 4.9,
      ratingCount: 201,
    },
    profile: {
      headline: "Full-stack React and Node.js engineer",
      bio: "Product-focused engineer delivering maintainable web applications, APIs, and deployment handovers.",
      hourlyRate: 35,
      currency: "BHD",
      languages: [
        { name: "Arabic", level: "native" },
        { name: "English", level: "fluent" },
      ],
      availability: "full_time",
      completedContracts: 108,
      totalEarned: 28650,
    },
    service: {
      name: "React & Node.js Development",
      packages: [
        {
          name: "Basic",
          title: "Landing page and API starter",
          description: "A responsive single-page experience with one connected API endpoint.",
          price: 25,
          currency: "BHD",
          deliveryDays: 7,
          revisions: 1,
          features: ["Responsive page", "1 API endpoint", "Deployment"],
        },
        {
          name: "Standard",
          title: "Full-stack business application",
          description: "A secure multi-page application with authentication and data persistence.",
          price: 210,
          currency: "BHD",
          deliveryDays: 14,
          revisions: 3,
          features: [
            "Up to 6 pages",
            "Authentication and database",
            "Admin dashboard",
            "Deployment documentation",
          ],
        },
        {
          name: "Premium",
          title: "Production platform delivery",
          description: "End-to-end product delivery with automation, testing, and launch support.",
          price: 530,
          currency: "BHD",
          deliveryDays: 30,
          revisions: 5,
          features: [
            "Custom product scope",
            "Authentication and admin tools",
            "Automated tests",
            "CI/CD pipeline",
            "30 days of launch support",
          ],
        },
      ],
    },
  },
  {
    user: {
      name: "Lina Yousef",
      email: "lina.yousef.featured@example.com",
      avatarUrl: "/placeholders/avatar-3.svg",
      country: "Jordan",
      city: "Amman",
      ratingAvg: 4.7,
      ratingCount: 158,
    },
    profile: {
      headline: "Arabic and English voice-over artist",
      bio: "Broadcast-ready Arabic and English voice-over for campaigns, explainers, and digital products.",
      hourlyRate: 22,
      currency: "BHD",
      languages: [
        { name: "Arabic", level: "native" },
        { name: "English", level: "fluent" },
      ],
      availability: "part_time",
      completedContracts: 176,
      totalEarned: 11980,
    },
    service: {
      name: "Arabic & English Voice Over",
      packages: [
        {
          name: "Basic",
          title: "Short voice-over recording",
          description: "A polished short-form recording for social media or product content.",
          price: 8,
          currency: "BHD",
          deliveryDays: 2,
          revisions: 1,
          features: ["Up to 150 words", "WAV and MP3 files", "Commercial usage"],
        },
        {
          name: "Standard",
          title: "Campaign voice-over",
          description: "A longer recording with dialect options and a mastered music mix.",
          price: 30,
          currency: "BHD",
          deliveryDays: 3,
          revisions: 3,
          features: ["Up to 500 words", "Two dialect options", "Background music mix"],
        },
        {
          name: "Premium",
          title: "Broadcast voice-over production",
          description: "Full recording, edit, and sync for a long-form or broadcast project.",
          price: 70,
          currency: "BHD",
          deliveryDays: 5,
          revisions: 6,
          features: [
            "Up to 1,500 words",
            "Full mix and master",
            "Video synchronisation",
            "Broadcast usage rights",
          ],
        },
      ],
    },
  },
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
    throw new Error("Featured demo data cannot be seeded with NODE_ENV=production.");
  }

  const hosts = databaseHosts(uri);
  if (hosts.length === 0 || hosts.some((host) => !LOCAL_DATABASE_HOSTS.has(host))) {
    throw new Error("Featured demo data can only be seeded into a local MongoDB instance.");
  }
}

async function upsertUser(seed) {
  const email = seed.email.toLowerCase();
  const userFields = {
    ...seed,
    email,
    role: "freelancer",
    status: "active",
    isEmailVerified: true,
  };
  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      ...userFields,
      hashedPassword: crypto.randomBytes(32).toString("base64url"),
    });
  } else {
    user = await User.findByIdAndUpdate(user._id, { $set: userFields }, {
      returnDocument: "after",
      runValidators: true,
    });
  }

  return user;
}

async function upsertFreelancer(seed) {
  const user = await upsertUser(seed.user);

  await FreelancerProfile.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        ...seed.profile,
        skills: [],
        portfolio: [],
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
  );

  const packageIds = [];
  for (const [sortOrder, packageSeed] of seed.service.packages.entries()) {
    const packageItem = await Package.findOneAndUpdate(
      { freelancer: user._id, name: packageSeed.name },
      { $set: { ...packageSeed, isActive: true, sortOrder } },
      {
        upsert: true,
        returnDocument: "after",
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
    packageIds.push(packageItem._id);
  }

  const service = await Service.findOneAndUpdate(
    { freelancer: user._id, name: seed.service.name },
    { $set: { packages: packageIds } },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
  );

  return { user, service, packageIds };
}

async function seedFeaturedServices(uri = process.env.MONGODB_URI) {
  assertSafeDatabaseTarget(uri);
  await mongoose.connect(uri);

  const seeded = [];
  for (const freelancerSeed of FEATURED_FREELANCERS) {
    seeded.push(await upsertFreelancer(freelancerSeed));
  }

  return {
    database: mongoose.connection.name,
    freelancers: seeded.length,
    profiles: seeded.length,
    packages: seeded.reduce((total, item) => total + item.packageIds.length, 0),
    services: seeded.length,
  };
}

async function main() {
  try {
    const summary = await seedFeaturedServices();
    console.log("Featured marketplace seed complete.");
    console.log(`Database: ${summary.database}`);
    console.log(`Freelancers: ${summary.freelancers}`);
    console.log(`Profiles: ${summary.profiles}`);
    console.log(`Packages: ${summary.packages}`);
    console.log(`Services: ${summary.services}`);
  } catch (error) {
    console.error(`Featured marketplace seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main();

module.exports = {
  FEATURED_FREELANCERS,
  assertSafeDatabaseTarget,
  seedFeaturedServices,
};
