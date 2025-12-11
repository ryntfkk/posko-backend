const jwt = require('jsonwebtoken');
const env = require('../config/env');

function unauthorizedResponse(req, res, messageKey, defaultMessage, status = 401) {
  return res.status(status).json({
    messageKey,
    message: req.t ? req.t(messageKey) : defaultMessage,
  });
}

// 1. Fungsi Utama (Dulu namanya authenticate)
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return unauthorizedResponse(req, res, 'auth.unauthorized', 'Authorization token is required');
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    req.user = decoded;
    return next();
  } catch (error) {
    return unauthorizedResponse(req, res, 'auth.invalid_token', 'Invalid or expired token');
  }
}

// 2. Fungsi Tambahan (Admin Check)
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return unauthorizedResponse(req, res, 'auth.forbidden', 'Admin access required', 403);
  }
  next();
}

// --- HYBRID EXPORT MAGIC ---

// A. Default Export: Agar kode lama (const authenticate = require(...)) tetap jalan!
module.exports = authenticate;

// B. Named Properties: Agar kode baru (const { isAuthenticated } = require(...)) juga jalan!
// Kita tempelkan fungsi 'authenticate' ke properti 'isAuthenticated'
module.exports.isAuthenticated = authenticate;

// C. Kita tempelkan juga 'requireAdmin'
module.exports.requireAdmin = requireAdmin;