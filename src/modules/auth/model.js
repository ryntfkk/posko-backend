const mongoose = require('mongoose');

const authUserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    roles: {
      type: [String],
      default: ['customer'],
    },
  },
  { timestamps: true }
);

const AuthUser = mongoose.model('AuthUser', authUserSchema);

module.exports = AuthUser;