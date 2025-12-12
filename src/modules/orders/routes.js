// src/modules/orders/routes.js
const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');
const authenticate = require('../../middlewares/auth');

// [UPDATE] Menggunakan Config S3 yang sudah ada, bukan Local Storage
const uploadS3 = require('../../config/s3Upload');

const router = express.Router();

// [BARU] Public/Internal Route untuk Cron Job
router.post('/auto-complete', controller.autoCompleteStuckOrders);

router.use(authenticate);

router.get('/incoming', controller.listIncomingOrders);
router.patch('/:orderId/accept', controller.acceptOrder); 
router.patch('/:orderId/reject', controller.rejectOrder);
router.patch('/:orderId/status', controller.updateOrderStatus);

// [BARU] Endpoint Request Biaya Tambahan
router.post('/:orderId/additional-fee', controller.requestAdditionalFee);

// [BARU] Endpoint Void Biaya Tambahan (Provider Cancel Request)
router.delete('/:orderId/fees/:feeId', controller.voidAdditionalFee);

// [BARU] Endpoint Reject Biaya Tambahan (Sesuai Frontend)
router.put('/:orderId/fees/:feeId/reject', controller.rejectAdditionalFee);

// [UPDATE] Upload Bukti Pekerjaan (Completion Evidence) menggunakan S3
// Menggunakan 'image' sebagai field name sesuai frontend provider
router.post('/:orderId/completion-evidence', uploadS3.single('image'), controller.uploadCompletionEvidence);

router.get('/', controller.listOrders);
router.get('/:orderId', controller.getOrderById); 

// [UPDATE] Create Order sekarang mendukung upload foto kondisi awal (attachments)
// Menggunakan 'attachments' sebagai field name, max 5 foto
router.post('/', uploadS3.array('attachments', 5), validateCreateOrder, controller.createOrder);

module.exports = router;