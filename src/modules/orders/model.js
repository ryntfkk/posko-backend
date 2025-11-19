const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: false,
    },
    items: {
      type: [
        {
          name: {
            type: String,
            required: [true, 'Item name is required'],
            trim: true,
          },
          quantity: {
            type: Number,
            required: [true, 'Item quantity is required'],
            min: [1, 'Quantity must be at least 1'],
          },
          price: {
            type: Number,
            required: [true, 'Item price is required'],
            min: [0, 'Price cannot be negative'],
          },
        },
      ],
      default: [],
    },
   
    status: {
      type: String,
      enum: ['pending', 'paid', 'completed', 'cancelled'],
      default: 'pending',
    },
    totalAmount: {
      required: [true, 'Total amount is required'],
      type: Number,
      default: 0,
      min: [0, 'Total amount cannot be negative'],
    },
  },
  { timestamps: true }
);

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;