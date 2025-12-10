const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');

// Inisialisasi Client S3
const s3Config = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Konfigurasi Multer dengan S3 Storage
const upload = multer({
  storage: multerS3({
    s3: s3Config,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE, // Otomatis deteksi mime-type (image/png, dll)
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      // Format nama file: uploads/timestamp-namafileasli
      // Contoh: uploads/171542332-foto.jpg
      const cleanFileName = path.basename(file.originalname).replace(/\s+/g, '-');
      const fileName = `uploads/${Date.now()}-${cleanFileName}`;
      cb(null, fileName);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024 // Batas ukuran file 5MB
  },
  fileFilter: (req, file, cb) => {
    // Validasi hanya menerima gambar
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung! Hanya file gambar yang diperbolehkan.'), false);
    }
  }
});

module.exports = upload;