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

    // 1. Ambil Data Order
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

    // 2. Tentukan Jenis Pembayaran (Order Utama atau Add-on)
    let grossAmount = 0;
    let itemDetails = [];
    let paymentType = 'initial'; // 'initial' or 'addon'

    // KONDISI 1: Pembayaran Awal (Order Utama)
    if (order.status === 'pending') {
        grossAmount = order.totalAmount;
        
        // Item Utama
        itemDetails = order.items.map(item => ({
            id: item.serviceId.toString(),
            price: item.price,
            quantity: item.quantity,
            name: item.name.substring(0, 50)
        }));

        // Admin Fee
        if (order.adminFee && order.adminFee > 0) {
            itemDetails.push({
                id: 'ADMIN-FEE',
                price: order.adminFee,
                quantity: 1,
                name: 'Biaya Layanan Aplikasi'
            });
        }

        // Diskon
        if (order.discountAmount && order.discountAmount > 0) {
            itemDetails.push({
                id: 'VOUCHER-DISC',
                price: -order.discountAmount,
                quantity: 1,
                name: 'Diskon Voucher'
            });
        }
    } 
    // KONDISI 2: Pembayaran Biaya Tambahan (Saat Working/On The Way)
    else if (['working', 'on_the_way', 'accepted', 'waiting_approval'].includes(order.status)) {
        // Cari biaya tambahan yang statusnya 'pending_approval' (belum dibayar customer)
        const unpaidFees = order.additionalFees.filter(f => f.status === 'pending_approval');
        
        if (unpaidFees.length === 0) {
            return res.status(400).json({ message: 'Tidak ada tagihan yang perlu dibayar saat ini.' });
        }

        paymentType = 'addon';
        grossAmount = unpaidFees.reduce((acc, curr) => acc + curr.amount, 0);

        itemDetails = unpaidFees.map(fee => ({
            id: `ADDON-${fee._id}`,
            price: fee.amount,
            quantity: 1,
            name: fee.description.substring(0, 50)
        }));
    } else {
        return res.status(400).json({ message: 'Status pesanan tidak valid untuk pembayaran.' });
    }

    // 3. Buat Order ID unik untuk Midtrans
    // Format: POSKO-[ORDER_ID]-[TIMESTAMP]
    const midtransOrderId = `POSKO-${order._id}-${Date.now()}`;
    const currentBaseUrl = process.env.FRONTEND_CUSTOMER_URL || "http://localhost:3000";

    const transactionDetails = {
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: grossAmount,
      },
      customer_details: {
        first_name: order.userId.fullName,
        email: order.userId.email,
        phone: order.userId.phoneNumber || '',
      },
      item_details: itemDetails,
      callbacks: {
        finish: `${currentBaseUrl}/orders/${order._id}`,
        error: `${currentBaseUrl}/orders/${order._id}`,
        pending: `${currentBaseUrl}/orders/${order._id}`
      }
    };

    const transaction = await snap.createTransaction(transactionDetails);

    const payment = new Payment({
      orderId: order._id,
      amount: grossAmount,
      method: 'midtrans_snap',
      status: 'pending',
      // Bisa tambahkan field meta/type jika schema mendukung, tapi sementara pakai logic status order
    });
    await payment.save();

    res.status(201).json({
      message: 'Payment Token Generated',
      data: {
        paymentId: payment._id,
        snapToken: transaction.token,
        redirectUrl: transaction.redirect_url,
        paymentType
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

    // 3. Validasi & Ambil Order
    const order = await Order.findById(realOrderId);
    if (!order) {
        return res.status(404).json({ message: 'Order not found in DB' });
    }

    const notifAmount = parseFloat(gross_amount);

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

    console.log(`🔔 Webhook: ${realOrderId} status ${paymentStatus} (${transactionStatus}) - Amount: ${notifAmount}`);

    // 5. Update Database
    if (paymentStatus === 'paid') {
        // A. Update Payment Record
        // Cari payment yang statusnya pending untuk order ini dengan nominal yang cocok
        // (Mengantisipasi multiple payment untuk addon)
        await Payment.findOneAndUpdate(
            { 
                orderId: realOrderId, 
                status: 'pending',
                amount: notifAmount // Match amount untuk membedakan initial vs addon jika perlu
            }, 
            { status: 'paid' }
        );
        
        // B. Update Order / Additional Fees
        // Logika: Jika order masih pending -> ini pembayaran utama
        if (order.status === 'pending') {
             // Cek kesesuaian nominal utama
             if (Math.abs(notifAmount - order.totalAmount) <= 500) { // Toleransi kecil
                 const nextStatus = order.orderType === 'direct' ? 'paid' : 'searching';
                 await Order.findByIdAndUpdate(realOrderId, { status: nextStatus });
                 console.log(`✅ Order ${realOrderId} updated to ${nextStatus}`);
             } else {
                 console.warn(`⚠️ Payment amount ${notifAmount} does not match order total ${order.totalAmount}`);
             }
        } 
        // Jika order sudah berjalan (working/on_the_way) -> ini kemungkinan pembayaran add-on
        else {
             // Cari semua biaya tambahan yang statusnya 'pending_approval'
             // Kita update statusnya menjadi 'paid' menggunakan manipulasi langsung pada document order
             // agar atomic dan Mongoose mendeteksi perubahan subdocument dengan benar.
             
             let updatedFees = false;
             
             // Iterate langsung array di dalam document Mongoose
             if (order.additionalFees && order.additionalFees.length > 0) {
                 order.additionalFees.forEach(fee => {
                     if (fee.status === 'pending_approval') {
                         fee.status = 'paid';
                         updatedFees = true;
                     }
                 });
             }

             if (updatedFees) {
                 await order.save(); // Simpan perubahan pada document utama
                 console.log(`✅ Additional fees for order ${realOrderId} marked as paid`);
             }
        }

    } else if (paymentStatus === 'failed') {
        await Payment.findOneAndUpdate({ orderId: realOrderId, status: 'pending' }, { status: 'failed' });
        if (order.status === 'pending') {
            await Order.findByIdAndUpdate(realOrderId, { status: 'cancelled' });
        }
    }

    res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('❌ Webhook Error:', error);
    // Return 500 jika error internal agar Midtrans retry
    res.status(500).json({ message: 'Internal Server Error' }); 
  }
}

module.exports = { listPayments, createPayment, handleNotification };