// src/modules/orders/routes.js
const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');
const authenticate = require('../../middlewares/auth');

// Menggunakan konfigurasi S3 Upload
const uploadS3 = require('../../config/s3Upload');

const router = express.Router();

// Middleware Helper: Parse JSON string dari Multipart Form Data
// Ini diperlukan karena saat upload file, data object (seperti items/address) dikirim sebagai string JSON
const parseMultipartBody = (req, res, next) => {
    // List field yang dikirim sebagai JSON string oleh Frontend
    const jsonFields = [
        'items', 
        'shippingAddress', 
        'location', 
        'customerContact', 
        'propertyDetails', 
        'scheduledTimeSlot'
    ];

    jsonFields.forEach(field => {
        if (req.body[field] && typeof req.body[field] === 'string') {
            try {
                req.body[field] = JSON.parse(req.body[field]);
            } catch (e) {
                console.error(`Gagal parsing field ${field}:`, e);
                // Biarkan error handle oleh validator jika format salah
            }
        }
    });

    next();
};

router.post('/auto-complete', controller.autoCompleteStuckOrders);

router.use(authenticate);

router.get('/incoming', controller.listIncomingOrders);
router.patch('/:orderId/accept', controller.acceptOrder); 
router.patch('/:orderId/reject', controller.rejectOrder);
router.patch('/:orderId/status', controller.updateOrderStatus);

router.post('/:orderId/additional-fee', controller.requestAdditionalFee);
router.delete('/:orderId/fees/:feeId', controller.voidAdditionalFee);
router.put('/:orderId/fees/:feeId/reject', controller.rejectAdditionalFee);

// Upload Bukti Pekerjaan
router.post('/:orderId/completion-evidence', uploadS3.single('image'), controller.uploadCompletionEvidence);

router.get('/', controller.listOrders);
router.get('/:orderId', controller.getOrderById); 

// Create Order dengan attachments (kondisi awal) + Parsing JSON + Validasi
router.post('/', 
    uploadS3.array('attachments', 5), 
    parseMultipartBody, // [PENTING] Parse JSON string sebelum validasi
    validateCreateOrder, 
    controller.createOrder
);

module.exports = router;