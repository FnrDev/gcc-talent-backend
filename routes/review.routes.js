const router = require("express").Router();
const reviewController = require("../controllers/review.controller");
const verifyToken = require("../middleware/verifyToken");
const validateObjectId = require("../middleware/validateObjectId");


// Submit a review after a contract ends

router.post("/contracts/:id/reviews", verifyToken, validateObjectId, reviewController.createReview);


// Public reviews received by a user

router.get("/users/:id/reviews", validateObjectId, reviewController.getUserReviews);

router.get("/users/:id/rating", validateObjectId, reviewController.getUserRating);

router.get("/services/:id/reviews", validateObjectId, reviewController.getServiceReviews);


module.exports = router;
