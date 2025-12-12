// src/modules/orders/controller.js
const OrderService = require('./service');

// 1. LIST ALL ORDERS
async function listOrders(req, res, next) {
  try {
    const { data, meta } = await OrderService.listOrders(req.user, req.query);
    
    const messageKey = 'orders.list';
    res.json({ 
      messageKey, 
      message: req.t ? req.t(messageKey) : 'List Orders', 
      data: data, 
      meta: meta 
    });
  } catch (error) {
    next(error);
  }
}

// 2. CREATE ORDER (Updated for S3 Attachments)
async function createOrder(req, res, next) {
  try {
    // [UPDATE] Cek apakah ada file attachments dari S3
    if (req.files && req.files.length > 0) {
      // Mapping file S3 ke format attachments database
      const attachments = req.files.map(file => ({
        url: file.location, // URL publik S3 (multer-s3 menggunakan properti .location)
        type: 'image'
      }));
      
      // Masukkan ke req.body agar Service menyimpannya
      req.body.attachments = attachments;
    }

    const order = await OrderService.createOrder(req.user, req.body);
    
    res.status(201).json({ 
      message: 'Pesanan berhasil dibuat', 
      data: {
        ...order.toObject(),
        orderNumber: order.orderNumber
      }
    });
  } catch (error) {
    next(error);
  }
}

// 3. GET ORDER BY ID
async function getOrderById(req, res, next) {
  try {
    const order = await OrderService.getOrderById(req.params.orderId);
    res.json({ message: 'Detail pesanan ditemukan', data: order });
  } catch (error) {
    next(error);
  }
}

// 4. LIST INCOMING ORDERS
async function listIncomingOrders(req, res, next) {
  try {
    const result = await OrderService.listIncomingOrders(req.user);
    
    res.json({ 
      message: 'Daftar order masuk berhasil diambil',
      ...result 
    });
  } catch (error) {
    next(error);
  }
}

// 5. ACCEPT ORDER
async function acceptOrder(req, res, next) {
  try {
    const order = await OrderService.acceptOrder(req.user, req.params.orderId);
    res.json({ message: 'Pesanan berhasil diterima! Segera hubungi pelanggan.', data: order });
  } catch (error) {
    next(error);
  }
}

// 6. UPDATE ORDER STATUS
async function updateOrderStatus(req, res, next) {
  try {
    const result = await OrderService.updateOrderStatus(
      req.user, 
      req.params.orderId, 
      req.body.status
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// 7. REQUEST ADDITIONAL FEE
async function requestAdditionalFee(req, res, next) {
  try {
    const order = await OrderService.requestAdditionalFee(
      req.user, 
      req.params.orderId, 
      req.body
    );

    res.status(201).json({ 
      message: 'Permintaan biaya tambahan berhasil diajukan.',
      data: order
    });
  } catch (error) {
    next(error);
  }
}

// 7b. VOID ADDITIONAL FEE
async function voidAdditionalFee(req, res, next) {
  try {
    const order = await OrderService.voidAdditionalFee(
      req.user, 
      req.params.orderId, 
      req.params.feeId
    );

    res.json({ 
      message: 'Pengajuan biaya tambahan dibatalkan.',
      data: order
    });
  } catch (error) {
    next(error);
  }
}

// 8. UPLOAD COMPLETION EVIDENCE (Updated for S3)
async function uploadCompletionEvidence(req, res, next) {
  try {
    // Pastikan file ada
    if (!req.file) {
      throw new Error('File gambar tidak ditemukan.');
    }

    // [UPDATE] Service harus menerima object file atau URL. 
    // Karena req.file dari multer-s3 memiliki .location (URL), kita pastikan Service bisa menggunakannya.
    const order = await OrderService.uploadCompletionEvidence(
      req.user, 
      req.params.orderId, 
      req.file, // Service akan membaca req.file.location
      req.body.description
    );

    res.status(201).json({ 
      message: 'Bukti pekerjaan berhasil diupload.',
      data: order
    });
  } catch (error) {
    next(error);
  }
}

// 9. REJECT ADDITIONAL FEE
async function rejectAdditionalFee(req, res, next) {
  try {
    const order = await OrderService.rejectAdditionalFee(
      req.user, 
      req.params.orderId, 
      req.params.feeId
    );

    res.json({ message: 'Biaya tambahan berhasil ditolak.', data: order });
  } catch (error) {
    next(error);
  }
}

// 10. AUTO COMPLETE STUCK ORDERS
async function autoCompleteStuckOrders(req, res, next) {
  try {
    const result = await OrderService.autoCompleteStuckOrders(req.headers['x-cron-secret']);
    
    res.json({
      message: 'Auto-complete process finished',
      stats: result
    });
  } catch (error) {
    next(error);
  }
}

// 11. REJECT ORDER
async function rejectOrder(req, res, next) {
  try {
    const result = await OrderService.rejectOrder(req.user, req.params.orderId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { 
  listOrders, 
  createOrder, 
  getOrderById, 
  listIncomingOrders,
  acceptOrder,
  updateOrderStatus,
  requestAdditionalFee, 
  voidAdditionalFee,
  uploadCompletionEvidence,
  rejectAdditionalFee,
  autoCompleteStuckOrders,
  rejectOrder 
};