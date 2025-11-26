// src/middlewares/validateMidtransSignature.js
const crypto = require('crypto');
const env = require('../config/env');

/**
 * Validasi signature dari Midtrans webhook
 * Midtrans mengirim X-Signature header dengan format: SHA512(order_id+status_code+gross_amount+server_key)
 */
function validateMidtransSignature(req, res, next) {
  try {
    const signature = req. headers['x-signature'];
    
    if (!signature) {
      return res.status(401).json({
        message: 'Missing X-Signature header',
        error: 'Unauthorized'
      });
    }

    const { order_id, status_code, gross_amount } = req.body;

    // Buat signature yang diharapkan
    const expectedSignature = crypto
      .createHash('sha512')
      .update(`${order_id}${status_code}${gross_amount}${env.midtransKey}`)
      .digest('hex');

    // Bandingkan signature (constant-time comparison untuk keamanan)
    const isSignatureValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isSignatureValid) {
      console.warn(`⚠️ Invalid Midtrans signature received`);
      return res.status(401).json({
        message: 'Invalid signature',
        error: 'Unauthorized'
      });
    }

    // Signature valid, lanjutkan ke handler berikutnya
    next();
  } catch (error) {
    console.error('Error validating Midtrans signature:', error);
    return res.status(400).json({
      message: 'Error validating signature',
      error: error.message
    });
  }
}

module.exports = validateMidtransSignature;