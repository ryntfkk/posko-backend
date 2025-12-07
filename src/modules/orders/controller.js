// src/modules/orders/controller.js
const OrderService = require('./service');

// 1. LIST ALL ORDERS
async function listOrders(req, res, next) {
  try {
    // [FIX] Destructure result dari Service (data & meta)
    const { data, meta } = await OrderService.listOrders(req.user, req.query);
    
    const messageKey = 'orders.list';
    res.json({ 
      messageKey, 
      message: req.t ? req.t(messageKey) : 'List Orders', 
      data: data, // Kirim array data murni
      meta: meta  // Kirim metadata pagination
    });
  } catch (error) {
    next(error);
  }
}

// 2. CREATE ORDER
async function createOrder(req, res, next) {
  try {
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
      ...result // providerStatus & data
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

// 6. UPDATE ORDER STATUS (Completed/Working/etc)
async function updateOrderStatus(req, res, next) {
  try {
    const result = await OrderService.updateOrderStatus(
      req.user, 
      req.params.orderId, 
      req.body.status
    );
    
    // Service sudah mengembalikan object { message, data } yang sesuai
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

// [BARU] 7b. VOID ADDITIONAL FEE
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

// 8. UPLOAD COMPLETION EVIDENCE
async function uploadCompletionEvidence(req, res, next) {
  try {
    const order = await OrderService.uploadCompletionEvidence(
      req.user, 
      req.params.orderId, 
      req.file, 
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

// 10. AUTO COMPLETE STUCK ORDERS (CRON JOB)
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
  voidAdditionalFee, // Export baru
  uploadCompletionEvidence,
  rejectAdditionalFee,
  autoCompleteStuckOrders,
  rejectOrder 
};