const mongoose = require('mongoose'); // [TAMBAHAN PENTING]
const Payment = require('./model');
const Order = require('../orders/model');
const snap = require('../../utils/midtrans');

async function listPayments(req, res, next) {
  try {
    const payments = await Payment.find().populate('orderId');
    const messageKey = 'payments.list';
    res.json({ messageKey, message: req.t(messageKey), data: payments });
  } catch (error) {
    next(error);
  }
}

async function createPayment(req, res, next) {
  try {
    const { orderId } = req.body;

    // 1. Ambil Data Order
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      return res.status(404).json({ message: 'Order tidak ditemukan' });
    }

    // 2. Buat Order ID unik untuk Midtrans
    // Format: POSKO-{MONGO_ID}-{TIMESTAMP}
    const midtransOrderId = `POSKO-${order._id}-${Date.now()}`;
    const currentBaseUrl = "http://localhost:3000";
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
// [TAMBAHAN BARU] Ini akan memaksa Midtrans redirect ke sini, mengabaikan Dashboard
      callbacks: {
        finish: `${currentBaseUrl}/orders`,
        error: `${currentBaseUrl}/orders`,
        pending: `${currentBaseUrl}/orders`
      }
    };

    const transaction = await snap.createTransaction(transactionDetails);
    const snapToken = transaction.token;
    const redirectUrl = transaction.redirect_url;

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
        snapToken: snapToken,
        redirectUrl: redirectUrl
      }
    });

  } catch (error) {
    console.error('Midtrans Error:', error);
    next(error);
  }
}

// --- [FUNGSI WEBHOOK DENGAN PERBAIKAN] ---
async function handleNotification(req, res, next) {
  try {
    const notification = req.body;
    
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;
    const orderIdFull = notification.order_id; // Contoh: POSKO-6920f...-1763...

    // 1. Ekstrak Order ID Asli
    // Format split: ["POSKO", "REAL_ORDER_ID", "TIMESTAMP"]
    const splitOrderId = orderIdFull.split('-');
    const realOrderId = splitOrderId[1]; 

    // 2. [FIX CRITICAL ERROR] Validasi apakah ini ID MongoDB yang valid?
    // Jika "569b" masuk sini, dia akan ditolak dengan aman, server tidak crash.
    if (!realOrderId || !mongoose.Types.ObjectId.isValid(realOrderId)) {
        console.log(`⚠️ Mengabaikan notifikasi dengan Order ID tidak valid: ${realOrderId} (Full: ${orderIdFull})`);
        // Return 200 OK agar Midtrans berhenti mengirim ulang (retry) notifikasi sampah ini
        return res.status(200).json({ message: 'Invalid Order ID ignored' });
    }

    // 3. Tentukan Status
    let paymentStatus = 'pending';
    if (transactionStatus == 'capture') {
        if (fraudStatus == 'challenge') {
            paymentStatus = 'pending';
        } else if (fraudStatus == 'accept') {
            paymentStatus = 'paid';
        }
    } else if (transactionStatus == 'settlement') {
        paymentStatus = 'paid';
    } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
        paymentStatus = 'failed';
    } else if (transactionStatus == 'pending') {
        paymentStatus = 'pending';
    }

    console.log(`🔔 Webhook Received: ${realOrderId} -> ${paymentStatus}`);

    // 4. Update Database
    if (paymentStatus === 'paid') {
        await Payment.findOneAndUpdate({ orderId: realOrderId }, { status: 'paid' });
        
        const order = await Order.findById(realOrderId);
        if (order) {
            const nextStatus = order.orderType === 'direct' ? 'accepted' : 'searching';
            await Order.findByIdAndUpdate(realOrderId, { status: nextStatus });
        }
    } else if (paymentStatus === 'failed') {
        await Payment.findOneAndUpdate({ orderId: realOrderId }, { status: 'failed' });
        await Order.findByIdAndUpdate(realOrderId, { status: 'cancelled' });
    }

    res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('❌ Webhook Error:', error);
    // Jangan throw error ke next(error) agar Midtrans tidak retry terus menerus jika error coding
    res.status(200).json({ message: 'Error handled' }); 
  }
}

module.exports = { listPayments, createPayment, handleNotification };