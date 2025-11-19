const Review = require('./model');

async function listReviews(req, res, next) {
  try {
    const reviews = await Review.find();
    res.json({ message: 'Daftar ulasan', data: reviews });
  } catch (error) {
    next(error);
  }
}

async function createReview(req, res, next) {
  try {
    const { userId, providerId, rating, comment = '' } = req.body;
    const review = new Review({ userId, providerId, rating, comment });
    await review.save();
    res.status(201).json({ message: 'Ulasan tersimpan', data: review });
  } catch (error) {
    next(error);
  }
}

module.exports = { listReviews, createReview };