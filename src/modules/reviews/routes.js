const express = require('express');
const { validateBody } = require('../../middlewares/validator');
const controller = require('./controller');

const router = express.Router();

router.get('/', controller.listReviews);
router.post('/', validateBody(['userId', 'providerId', 'rating']), controller.createReview);

module.exports = router;