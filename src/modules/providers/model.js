const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AuthUser',
      required: true,
    },
    services: [String],
    rating: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const Provider = mongoose.model('Provider', providerSchema);

module.exports = Provider;