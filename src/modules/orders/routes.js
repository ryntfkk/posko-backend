const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');
const authenticate = require('../../middlewares/auth');
// [UBAH] Gunakan Config S3
const uploadS3 = require('../../config/s3Upload'); 

const router = express.Router();

// [BARU] Public/Internal Route untuk Cron Job (Harus di atas middleware auth)
// Di production, sebaiknya dilindungi oleh middleware khusus yang mengecek header secret key
router.post('/auto-complete', controller.autoCompleteStuckOrders);

// Middleware Auth untuk route di bawahnya
router.use(authenticate);

router.get('/incoming', controller.listIncomingOrders);
router.patch('/:orderId/accept', controller.acceptOrder); 
// Route Reject
router.patch('/:orderId/reject', controller.rejectOrder);
router.patch('/:orderId/status', controller.updateOrderStatus);

// Endpoint Request Biaya Tambahan
router.post('/:orderId/additional-fee', controller.requestAdditionalFee);

// Endpoint Void Biaya Tambahan (Provider Cancel Request)
router.delete('/:orderId/fees/:feeId', controller.voidAdditionalFee);

// Endpoint Reject Biaya Tambahan
router.put('/:orderId/fees/:feeId/reject', controller.rejectAdditionalFee);

// [UBAH] Endpoint Upload Bukti Pekerjaan menggunakan Middleware S3
router.post('/:orderId/completion-evidence', uploadS3.single('image'), controller.uploadCompletionEvidence);

router.get('/', controller.listOrders);
router.get('/:orderId', controller.getOrderById); 
router.post('/', validateCreateOrder, controller.createOrder);

module.exports = router;