// src/modules/payments/controller.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const Payment = require('./model');
const Order = require('../orders/model');
const snap = require('../../utils/midtrans');
const { checkMidtransConfig } = require('../../utils/midtransConfig');
const env = require('../../config/env');

async function listPayments(req, res, next) {
  try {
    const userId = req.user.userId;
    
    // Only show payments for orders belonging to the authenticated user
    const payments = await Payment.find()
      .populate({
        path: 'orderId',
        match: { userId: userId },
        select: 'userId totalAmount status'
      })
      .lean();
    
    // Filter out payments where orderId is null (user doesn't own that order)
    const userPayments = payments.filter(p => p.orderId !== null);
    
    const messageKey = 'payments.list';
    res.json({ 
      messageKey, 
      message: req.t ?  req.t(messageKey) : 'Payment List', 
      data: userPayments 
    });
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
    const userId = req.user.userId;

    // 1.Ambil Data Order
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      return res.status(404).json({ message: 'Order tidak ditemukan' });
    }

    // Validate that the order belongs to the authenticated user
    if (order.userId._id.toString() !== userId) {
      return res.status(403).json({ 
        message: 'Anda tidak memiliki akses untuk membayar order ini' 
      });
    }

    // 2.Buat Order ID unik untuk Midtrans
    const midtransOrderId = `POSKO-${order._id}-${Date.now()}`;
    const currentBaseUrl = process.env.FRONTEND_CUSTOMER_URL || "http://localhost:3000";
    
    // [FIX] Susun Item Details agar sesuai dengan Gross Amount (Total)
    // Midtrans memvalidasi: Sum(item prices * quantity) === gross_amount
    let calculatedGrossAmount = 0;
    
    // A. Item Utama (Jasa/Service)
    const itemDetails = order.items.map(item => {
      const itemTotal = item.price * item.quantity;
      calculatedGrossAmount += itemTotal;
      return {
        id: item.serviceId.toString(),
        price: item.price,
        quantity: item.quantity,
        name: item.name.substring(0, 50)
      };
    });

    // B. Tambahkan Biaya Admin sebagai Item
    if (order.adminFee && order.adminFee > 0) {
      itemDetails.push({
        id: 'ADMIN-FEE',
        price: order.adminFee,
        quantity: 1,
        name: 'Biaya Layanan Aplikasi'
      });
      calculatedGrossAmount += order.adminFee;
    }

    // C. Tambahkan Diskon sebagai Item dengan harga negatif
    if (order.discountAmount && order.discountAmount > 0) {
      itemDetails.push({
        id: 'VOUCHER-DISC',
        price: -order.discountAmount, // Negatif agar mengurangi total
        quantity: 1,
        name: 'Diskon Voucher'
      });
      calculatedGrossAmount -= order.discountAmount;
    }

    // [SAFETY CHECK] Pastikan perhitungan JS sama dengan data di DB
    if (Math.abs(calculatedGrossAmount - order.totalAmount) > 5) {
       console.warn(`⚠️ Mismatch Warning: Calculated Items (${calculatedGrossAmount}) vs Order Total (${order.totalAmount})`);
    }

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
      item_details: itemDetails,
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

async function handleNotification(req, res, next) {
  try {
    const notification = req.body;
    
    // [SECURITY FIX] Verifikasi Signature Key Midtrans
    const { order_id, status_code, gross_amount, signature_key } = notification;
    const serverKey = env.midtransKey;

    if (!signature_key || !order_id || !status_code || !gross_amount) {
        console.error('❌ Invalid notification payload:', notification);
        return res.status(400).json({ message: 'Invalid notification payload' });
    }

    // 1. Validasi Signature
    // Gunakan gross_amount mentah dari payload (string/number) persis seperti yang dikirim Midtrans
    const signatureInput = `${order_id}${status_code}${gross_amount}${serverKey}`;
    const expectedSignature = crypto.createHash('sha512').update(signatureInput).digest('hex');

    if (signature_key !== expectedSignature) {
        console.error(`🚨 Security Alert: Invalid Signature detected! Order: ${order_id}`);
        return res.status(403).json({ message: 'Invalid signature key' });
    }

    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;
    const orderIdFull = notification.order_id; 

    // 2. Ekstrak Order ID Asli MongoDB
    const splitOrderId = orderIdFull.split('-');
    const realOrderId = splitOrderId[1]; 

    if (!realOrderId || !mongoose.Types.ObjectId.isValid(realOrderId)) {
        console.log(`⚠️ Ignored invalid Order ID: ${realOrderId}`);
        return res.status(200).json({ message: 'Invalid Order ID ignored' });
    }

    // 3. [CRITICAL] Validasi Amount dengan Database
    // Mencegah serangan manipulasi nominal (User bayar lebih murah dari seharusnya)
    const order = await Order.findById(realOrderId);
    if (!order) {
        return res.status(404).json({ message: 'Order not found in DB' });
    }

    // Konversi gross_amount ke Number untuk perbandingan (Midtrans mungkin kirim string "10000.00")
    const notifAmount = parseFloat(gross_amount);
    const dbAmount = order.totalAmount;

    // Toleransi selisih kecil akibat floating point (opsional, set strict jika perlu)
    if (Math.abs(notifAmount - dbAmount) > 5) { 
        console.error(`🚨 Fraud Alert: Amount mismatch! Paid: ${notifAmount}, Bill: ${dbAmount}`);
        // Jangan proses status order, kembalikan 200 agar Midtrans tidak retry (karena ini fraud/error permanen)
        return res.status(200).json({ message: 'Amount mismatch ignored' });
    }

    // 4. Tentukan Status Pembayaran
    let paymentStatus = 'pending';
    if (transactionStatus == 'capture') {
        if (fraudStatus == 'challenge') {
            paymentStatus = 'pending';
        } else if (fraudStatus == 'accept') {
            paymentStatus = 'paid';
        }
    } else if (transactionStatus == 'settlement') {
        paymentStatus = 'paid';
    } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
        paymentStatus = 'failed';
    }

    console.log(`🔔 Webhook: ${realOrderId} status ${paymentStatus} (${transactionStatus})`);

    // 5. Update Database (Payment & Order)
    if (paymentStatus === 'paid') {
        await Payment.findOneAndUpdate({ orderId: realOrderId }, { status: 'paid' });
        
        // Cek dulu agar tidak menimpa status jika sudah diproses lanjut
        if (['pending', 'cancelled', 'failed'].includes(order.status)) {
            const nextStatus = order.orderType === 'direct' ? 'paid' : 'searching';
            await Order.findByIdAndUpdate(realOrderId, { status: nextStatus });
        }
    } else if (paymentStatus === 'failed') {
        await Payment.findOneAndUpdate({ orderId: realOrderId }, { status: 'failed' });
        await Order.findByIdAndUpdate(realOrderId, { status: 'cancelled' });
    }

    res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('❌ Webhook Error:', error);
    // Return 500 jika error internal agar Midtrans retry
    res.status(500).json({ message: 'Internal Server Error' }); 
  }
}

module.exports = { listPayments, createPayment, handleNotification };