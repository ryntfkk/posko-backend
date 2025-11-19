const Review = require('./model');

async function listReviews(req, res, next) {
  try {
    const reviews = await Review.find();
    const messageKey = 'reviews.list';
    res.json({ messageKey, message: req.t(messageKey), data: reviews });
  } catch (error) {
    next(error);
  }
}

async function createReview(req, res, next) {
  try {
    const { userId, providerId, rating, comment = '' } = req.body;
    const review = new Review({ userId, providerId, rating, comment });
    await review.save();
    const messageKey = 'reviews.created';
    res.status(201).json({ messageKey, message: req.t(messageKey), data: review });
  } catch (error) {
    next(error);
  }
}

module.exports = { listReviews, createReview };