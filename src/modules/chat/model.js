const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AuthUser' }],
    messages: [
      {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'AuthUser' },
        content: String,
        sentAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat;