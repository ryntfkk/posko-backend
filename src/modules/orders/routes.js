const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');
const authenticate = require('../../middlewares/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// [SETUP] Multer untuk Upload Gambar (Mirip Auth)
const uploadDir = 'public/uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Penamaan file: evidence-orderID-timestamp.ext
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'evidence-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diperbolehkan!'));
    }
  }
});

const router = express.Router();

// [BARU] Public/Internal Route untuk Cron Job (Harus di atas middleware auth jika dipanggil oleh scheduler eksternal tanpa token user)
// Di production, sebaiknya dilindungi oleh middleware khusus yang mengecek header secret key
router.post('/auto-complete', controller.autoCompleteStuckOrders);

router.use(authenticate);

router.get('/incoming', controller.listIncomingOrders);
router.patch('/:orderId/accept', controller.acceptOrder); 
// [BARU] Route Reject
router.patch('/:orderId/reject', controller.rejectOrder);
router.patch('/:orderId/status', controller.updateOrderStatus);

// [BARU] Endpoint Request Biaya Tambahan
router.post('/:orderId/additional-fee', controller.requestAdditionalFee);

// [BARU] Endpoint Void Biaya Tambahan (Provider Cancel Request)
router.delete('/:orderId/fees/:feeId', controller.voidAdditionalFee);

// [BARU] Endpoint Reject Biaya Tambahan (Sesuai Frontend)
router.put('/:orderId/fees/:feeId/reject', controller.rejectAdditionalFee);

// [BARU] Endpoint Upload Bukti Pekerjaan
router.post('/:orderId/completion-evidence', upload.single('image'), controller.uploadCompletionEvidence);

router.get('/', controller.listOrders);
router.get('/:orderId', controller.getOrderById); 
router.post('/', validateCreateOrder, controller.createOrder);

module.exports = router;