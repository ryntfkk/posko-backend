// src/modules/upload/controller.js

async function uploadImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: 'Tidak ada file yang diunggah',
        error: 'No file uploaded'
      });
    }

    // Jika berhasil, multer-s3 akan menambahkan properti 'location' pada req.file
    // 'location' berisi URL publik gambar di S3
    const fileUrl = req.file.location;

    res.status(201).json({
      message: 'Upload berhasil',
      data: {
        url: fileUrl,
        key: req.file.key,     // Nama file di S3
        mimetype: req.file.mimetype,
        size: req.file.size
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { uploadImage };