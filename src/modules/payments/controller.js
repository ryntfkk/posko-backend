const Payment = require('./model');
const Order = require('../orders/model'); // Kita butuh data Order untuk detail
const snap = require('../../utils/midtrans'); // Import konfigurasi snap tadi

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
    const { orderId } = req.body; // Frontend cukup kirim orderId

    // 1. Ambil Data Order untuk memastikan jumlah tagihan
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      return res.status(404).json({ message: 'Order tidak ditemukan' });
    }

    // 2. Cek apakah sudah ada payment pending untuk order ini? (Opsional, untuk mencegah double token)
    // Untuk simplifikasi, kita buat baru terus atau update yang ada.

    // 3. Persiapkan Parameter Midtrans
    // Documentation: https://docs.midtrans.com/en/snap/integration-guide?id=sample-request
    const transactionDetails = {
      transaction_details: {
        order_id: `POSKO-${order._id}-${Date.now()}`, // Order ID harus unik setiap transaksi
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
        name: item.name.substring(0, 50) // Midtrans ada limit karakter nama item
      }))
    };

    // 4. Minta Token ke Midtrans
    const transaction = await snap.createTransaction(transactionDetails);
    const snapToken = transaction.token;
    const redirectUrl = transaction.redirect_url;

    // 5. Simpan Record Payment di Database Kita (Status Pending)
    const payment = new Payment({
      orderId: order._id,
      amount: order.totalAmount,
      method: 'midtrans_snap',
      status: 'pending',
      // Kita bisa simpan snapToken jika perlu, tapi biasanya langsung dikirim ke frontend
    });
    await payment.save();

    // 6. Kirim Token ke Frontend
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

module.exports = { listPayments, createPayment };