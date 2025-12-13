// src/modules/orders/routes.js
const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');
const authenticate = require('../../middlewares/auth');

// Menggunakan konfigurasi S3 Upload
const uploadS3 = require('../../config/s3Upload');

const router = express.Router();

// Middleware Helper: Parse JSON string dari Multipart Form Data
const parseMultipartBody = (req, res, next) => {
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
            }
        }
    });

    next();
};

// [HELPER] Wrapper untuk Upload Single dengan Error Handling
const uploadEvidenceMiddleware = (req, res, next) => {
    const upload = uploadS3.single('image');
    
    upload(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                message: 'Gagal mengupload bukti pekerjaan',
                error: err.message
            });
        }
        next();
    });
};

// [HELPER] Wrapper untuk Upload Array dengan Error Handling
const uploadAttachmentsMiddleware = (req, res, next) => {
    const upload = uploadS3.array('attachments', 5);

    upload(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                message: 'Gagal mengupload lampiran order',
                error: err.message
            });
        }
        next();
    });
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

// [UPDATE] Upload Bukti Pekerjaan dengan Error Handling S3
router.post('/:orderId/completion-evidence', uploadEvidenceMiddleware, controller.uploadCompletionEvidence);

router.get('/', controller.listOrders);
router.get('/:orderId', controller.getOrderById); 

// [UPDATE] Create Order dengan Error Handling S3
router.post('/', 
    uploadAttachmentsMiddleware, 
    parseMultipartBody, 
    validateCreateOrder, 
    controller.createOrder
);

module.exports = router;