// models/index.js
// Barrel file so the rest of the app can do:
//   const { User, Job, Contract } = require("../models");
// instead of requiring each model file individually. Also guarantees every
// model gets registered with Mongoose (important for populate() to work
// across files) as soon as this module is required once, e.g. from db.js.
//
// Matches the 8-collection ERD: User, Category, Skill, Job, Proposal,
// Contract, Transaction, Review.

module.exports = {
  User: require("./User"),
  Category: require("./Category"),
  Skill: require("./Skill"),
  Job: require("./Job"),
  Proposal: require("./Proposal"),
  Contract: require("./Contract"),
  Transaction: require("./Transaction"),
  Review: require("./Review"),
};
