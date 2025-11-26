// src/modules/payments/controller.js
const mongoose = require('mongoose');
const Payment = require('./model');
const Order = require('../orders/model');
const snap = require('../../utils/midtrans');
const { checkMidtransConfig } = require('../../utils/midtransConfig');

async function listPayments(req, res, next) {
  try {
    const payments = await Payment.find(). populate('orderId');
    const messageKey = 'payments.list';
    res.json({ messageKey, message: req.t ?  req.t(messageKey) : 'Payment List', data: payments });
  } catch (error) {
    next(error);
  }
}

async function createPayment(req, res, next) {
  try {
    const { isConfigured, missingKeys } = checkMidtransConfig();
    if (!isConfigured) {
      return res.status(503).json({
        message: 'Payment service is temporarily unavailable due to incomplete configuration.',
        details: { missingKeys },
      });
    }
    
    const { orderId } = req.body;

    // 1. Ambil Data Order
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      return res.status(404). json({ message: 'Order tidak ditemukan' });
    }

    // 2. Buat Order ID unik untuk Midtrans
    const midtransOrderId = `POSKO-${order._id}-${Date.now()}`;
    const currentBaseUrl = process.env.CLIENT_URL || "http://localhost:3000";
    
    const transactionDetails = {
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: order.totalAmount,
      },
      customer_details: {
        first_name: order.userId.fullName,
        email: order.userId.email,
        phone: order.userId.phoneNumber || '',
      },
      item_details: order.items.map(item => ({
        id: item.serviceId.toString(),
        price: item.price,
        quantity: item.quantity,
        name: item.name.substring(0, 50)
      })),
      callbacks: {
        finish: `${currentBaseUrl}/orders`,
        error: `${currentBaseUrl}/orders`,
        pending: `${currentBaseUrl}/orders`
      }
    };

    const transaction = await snap.createTransaction(transactionDetails);

    const payment = new Payment({
      orderId: order._id,
      amount: order.totalAmount,
      method: 'midtrans_snap',
      status: 'pending',
    });
    await payment.save();

    res.status(201).json({
      message: 'Payment Token Generated',
      data: {
        paymentId: payment._id,
        snapToken: transaction.token,
        redirectUrl: transaction.redirect_url
      }
    });

  } catch (error) {
    console.error('Midtrans Error:', error);
    next(error);
  }
}

// --- [PERBAIKAN UTAMA] HANDLE NOTIFICATION DENGAN ORDER ID EXTRACTION YANG ROBUST ---
async function handleNotification(req, res, next) {
  try {
    const notification = req.body;
    
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;
    const orderIdFull = notification.order_id;

    // --- [PERBAIKAN 1] Ekstrak Order ID dengan Regex (Lebih Robust) ---
    // Format: POSKO-{MongoDB_ObjectId}-{Timestamp}
    // MongoDB ObjectId format: 24 hex characters [a-f0-9]{24}
    const match = orderIdFull.match(/^POSKO-([a-f0-9]{24})-\d+$/i);
    
    if (!match || !match[1]) {
      console.warn(`⚠️ Invalid Order ID format: ${orderIdFull}`);
      return res. status(400).json({ 
        message: 'Invalid Order ID format',
        receivedFormat: orderIdFull
      });
    }

    const realOrderId = match[1];

    // --- [PERBAIKAN 2] Validasi Format MongoDB ObjectId ---
    if (!mongoose. Types.ObjectId.isValid(realOrderId)) {
      console.warn(`⚠️ Invalid MongoDB ObjectId: ${realOrderId}`);
      return res. status(400).json({ 
        message: 'Invalid MongoDB Object ID',
        receivedId: realOrderId
      });
    }

    // --- [PERBAIKAN 3] Tentukan Status Pembayaran Berdasarkan Midtrans Status ---
    let paymentStatus = 'pending';
    
    if (transactionStatus === 'capture') {
      if (fraudStatus === 'challenge') {
        paymentStatus = 'pending'; // Menunggu review fraud
      } else if (fraudStatus === 'accept') {
        paymentStatus = 'paid';
      }
    } else if (transactionStatus === 'settlement') {
      paymentStatus = 'paid'; // Settlement dari bank
    } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
      paymentStatus = 'failed';
    } else if (transactionStatus === 'pending') {
      paymentStatus = 'pending'; // Masih pending
    }

    console.log(`🔔 Webhook: Order ${realOrderId} → Status: ${paymentStatus} (${transactionStatus})`);

    // --- [PERBAIKAN 4] Update Payment & Order dengan Transactional Logic ---
    const payment = await Payment.findOne({ orderId: realOrderId });
    
    if (!payment) {
      console.warn(`⚠️ Payment record not found for Order: ${realOrderId}`);
      // Tetap return 200 agar Midtrans tidak retry
      return res.status(200).json({ message: 'Payment record not found (ignored)' });
    }

    const order = await Order.findById(realOrderId);
    if (!order) {
      console.warn(`⚠️ Order not found: ${realOrderId}`);
      return res.status(200).json({ message: 'Order not found (ignored)' });
    }

    // --- [PERBAIKAN 5] Update Payment Status ---
    payment.status = paymentStatus;
    await payment.save();

    // --- [PERBAIKAN 6] Update Order Status Berdasarkan Payment & Order Type ---
    if (paymentStatus === 'paid') {
      // Jika pembayaran berhasil
      if (['pending', 'cancelled'].includes(order.status)) {
        const nextStatus = order.orderType === 'direct' ? 'paid' : 'searching';
        order.status = nextStatus;
        await order.save();
        
        console.log(`✅ Order ${realOrderId} updated to status: ${nextStatus}`);
      } else {
        console.log(`ℹ️ Order ${realOrderId} already in progress (status: ${order.status}), no status update`);
      }
    } else if (paymentStatus === 'failed') {
      // Jika pembayaran gagal
      if (! ['completed', 'working', 'waiting_approval'].includes(order.status)) {
        order.status = 'cancelled';
        await order.save();
        
        console.log(`⚠️ Order ${realOrderId} cancelled due to payment failure`);
      }
    }

    // Selalu return 200 OK kepada Midtrans untuk acknowledge webhook
    res.status(200).json({ message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('❌ Webhook Processing Error:', error);
    // Tetap return 200 agar Midtrans tidak retry
    res.status(200).json({ message: 'Error handled internally' });
  }
}

module.exports = { listPayments, createPayment, handleNotification };