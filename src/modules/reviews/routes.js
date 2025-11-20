const express = require('express');
const controller = require('./controller');
const { validateCreateReview } = require('./validators');

const router = express.Router();

router.get('/', controller.listReviews);
router.post('/', validateCreateReview, controller.createReview);

module.exports = router;