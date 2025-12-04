// src/modules/payments/controller.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const Payment = require('./model');
const Order = require('../orders/model');
const snap = require('../../utils/midtrans');
const { checkMidtransConfig } = require('../../utils/midtransConfig');
const env = require('../../config/env');
const UserVoucher = require('../vouchers/userVoucherModel');
const Voucher = require('../vouchers/model');

// User: List Payment Sendiri
async function listPayments(req, res, next) {
  try {
    const userId = req.user.userId;
    
    const payments = await Payment.find()
      .populate({
        path: 'orderId',
        match: { userId: userId },
        select: 'userId totalAmount status'
      })
      .sort({ createdAt: -1 })
      .lean();
    
    const userPayments = payments.filter(p => p.orderId !== null);
    
    const messageKey = 'payments.list';
    res.json({ 
      messageKey, 
      message: req.t ? req.t(messageKey) : 'Payment List', 
      data: userPayments 
    });
  } catch (error) {
    next(error);
  }
}

// [BARU] Admin: List Semua Payment (Monitoring)
async function listAllPayments(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) {
      return res.status(403).json({ message: 'Akses ditolak.' });
    }

    const { page = 1, limit = 20, status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const payments = await Payment.find(filter)
      .populate({
        path: 'orderId',
        select: 'orderNumber totalAmount orderType',
        populate: { path: 'userId', select: 'fullName email' } // Info pembayar
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments(filter);

    res.json({
      message: 'Semua data pembayaran berhasil diambil',
      data: payments,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
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

    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      return res.status(404).json({ message: 'Order tidak ditemukan' });
    }

    if (order.userId._id.toString() !== userId) {
      return res.status(403).json({ 
        message: 'Anda tidak memiliki akses untuk membayar order ini' 
      });
    }

    let grossAmount = 0;
    let itemDetails = [];
    let paymentType = 'initial'; 

    if (order.status === 'pending') {
        grossAmount = order.totalAmount;
        
        itemDetails = order.items.map(item => ({
            id: item.serviceId.toString(),
            price: item.price,
            quantity: item.quantity,
            name: item.name.substring(0, 50)
        }));

        if (order.adminFee && order.adminFee > 0) {
            itemDetails.push({
                id: 'ADMIN-FEE',
                price: order.adminFee,
                quantity: 1,
                name: 'Biaya Layanan Aplikasi'
            });
        }

        if (order.discountAmount && order.discountAmount > 0) {
            itemDetails.push({
                id: 'VOUCHER-DISC',
                price: -order.discountAmount,
                quantity: 1,
                name: 'Diskon Voucher'
            });
        }
    } 
    else if (['working', 'on_the_way', 'accepted', 'waiting_approval'].includes(order.status)) {
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
    
    const { order_id, status_code, gross_amount, signature_key } = notification;
    const serverKey = env.midtransKey;

    if (!signature_key || !order_id || !status_code || !gross_amount) {
        console.error('❌ Invalid notification payload:', notification);
        return res.status(400).json({ message: 'Invalid notification payload' });
    }

    const signatureInput = `${order_id}${status_code}${gross_amount}${serverKey}`;
    const expectedSignature = crypto.createHash('sha512').update(signatureInput).digest('hex');

    if (signature_key !== expectedSignature) {
        console.error(`🚨 Security Alert: Invalid Signature detected! Order: ${order_id}`);
        return res.status(403).json({ message: 'Invalid signature key' });
    }

    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;
    const orderIdFull = notification.order_id; 

    const splitOrderId = orderIdFull.split('-');
    const realOrderId = splitOrderId[1]; 

    if (!realOrderId || !mongoose.Types.ObjectId.isValid(realOrderId)) {
        console.log(`⚠️ Ignored invalid Order ID: ${realOrderId}`);
        return res.status(200).json({ message: 'Invalid Order ID ignored' });
    }

    const order = await Order.findById(realOrderId);
    if (!order) {
        return res.status(404).json({ message: 'Order not found in DB' });
    }

    const notifAmount = parseFloat(gross_amount);

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

    if (paymentStatus === 'paid') {
        await Payment.findOneAndUpdate(
            { 
                orderId: realOrderId, 
                status: 'pending',
                amount: notifAmount 
            }, 
            { status: 'paid' }
        );
        
        if (order.status === 'pending') {
             if (Math.abs(notifAmount - order.totalAmount) <= 500) { 
                 const nextStatus = order.orderType === 'direct' ? 'paid' : 'searching';
                 await Order.findByIdAndUpdate(realOrderId, { status: nextStatus });
                 console.log(`✅ Order ${realOrderId} updated to ${nextStatus}`);
             } else {
                 console.warn(`⚠️ Payment amount ${notifAmount} does not match order total ${order.totalAmount}`);
             }
        } 
        else {
             const pendingFees = order.additionalFees.filter(f => f.status === 'pending_approval');
             const totalPendingAmount = pendingFees.reduce((sum, f) => sum + f.amount, 0);
             
             if (Math.abs(notifAmount - totalPendingAmount) <= 500) {
                 let updatedFees = false;
                 order.additionalFees.forEach(fee => {
                     if (fee.status === 'pending_approval') {
                         fee.status = 'paid';
                         updatedFees = true;
                     }
                 });

                 if (updatedFees) {
                     await order.save(); 
                     console.log(`✅ Additional fees for order ${realOrderId} marked as paid`);
                 }
             } else {
                 console.error(`🚨 Payment Mismatch for Add-on! Fees NOT updated.`);
             }
        }

    } 
    else if (paymentStatus === 'failed') {
        await Payment.findOneAndUpdate(
            { orderId: realOrderId, status: 'pending' }, 
            { status: 'failed' }
        );

        if (order.status === 'pending') {
            await Order.findByIdAndUpdate(realOrderId, { status: 'cancelled' });
            console.log(`❌ Order ${realOrderId} cancelled due to payment failure`);

            const userVoucher = await UserVoucher.findOne({ orderId: realOrderId });
            if (userVoucher) {
                userVoucher.status = 'active';
                userVoucher.usageDate = null;
                userVoucher.orderId = null;
                await userVoucher.save();
                
                if (order.voucherId) {
                    await Voucher.findByIdAndUpdate(order.voucherId, { $inc: { quota: 1 } });
                }
            }
        }
    }

    res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('❌ Webhook Error:', error);
    res.status(500).json({ message: 'Internal Server Error' }); 
  }
}

module.exports = { listPayments, createPayment, handleNotification, listAllPayments };