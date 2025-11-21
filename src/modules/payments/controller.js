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
async function handleNotification(req, res, next) {
  try {
    const notification = req.body;
    
    // 1. Ambil status transaksi dari payload Midtrans
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;
    const orderIdFull = notification.order_id; // Format: POSKO-ORDERID-TIMESTAMP

    // 2. Ekstrak Order ID asli dari format POSKO-{id}-{timestamp}
    // Kita split berdasarkan '-' dan ambil bagian tengah (index 1)
    const splitOrderId = orderIdFull.split('-');
    const realOrderId = splitOrderId[1]; 

    if (!realOrderId) {
        return res.status(400).json({ message: 'Invalid Order ID format' });
    }

    // 3. Tentukan Status Pembayaran Baru
    let paymentStatus = 'pending';
    if (transactionStatus == 'capture') {
        if (fraudStatus == 'challenge') {
            paymentStatus = 'pending'; // Challenge = belum pasti sukses
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

    // 4. Update Status di Database (Payment & Order)
    if (paymentStatus === 'paid') {
        // Update Payment jadi 'paid'
        await Payment.findOneAndUpdate({ orderId: realOrderId }, { status: 'paid' });
        
        // Update Order. Jika Direct -> 'accepted', Jika Basic -> 'searching' (atau sesuai logika bisnis Anda)
        // Di sini kita set default ke 'searching' atau biarkan frontend handle logic selanjutnya.
        // Untuk contoh ini, kita anggap pesanan TERKONFIRMASI jika sudah dibayar.
        const order = await Order.findById(realOrderId);
        if (order) {
            // Jika direct order, status lsg 'accepted' (menunggu mitra kerja). 
            // Jika basic, 'searching' (mencari mitra).
            const nextStatus = order.orderType === 'direct' ? 'accepted' : 'searching';
            await Order.findByIdAndUpdate(realOrderId, { status: nextStatus });
        }
    } else if (paymentStatus === 'failed') {
        await Payment.findOneAndUpdate({ orderId: realOrderId }, { status: 'failed' });
        await Order.findByIdAndUpdate(realOrderId, { status: 'cancelled' });
    }

    // 5. Wajib response 200 OK ke Midtrans agar tidak dikirim notifikasi berulang
    res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('Webhook Error:', error);
    next(error);
  }
}

// Jangan lupa tambahkan ke exports
module.exports = { listPayments, createPayment, handleNotification };