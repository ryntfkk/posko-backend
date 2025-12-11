const jwt = require('jsonwebtoken');
const env = require('../config/env');

function unauthorizedResponse(req, res, messageKey, defaultMessage, status = 401) {
  return res.status(status).json({
    messageKey,
    message: req.t ? req.t(messageKey) : defaultMessage,
  });
}

// 1. Ini fungsi utamanya (dulu namanya authenticate)
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

// 2. Ini fungsi tambahannya
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return unauthorizedResponse(req, res, 'auth.forbidden', 'Admin access required', 403);
  }
  next();
}

// --- BAGIAN PENTING (HYBRID EXPORT) ---

// A. Export default adalah fungsi 'authenticate' agar KODE LAMA (Services, Orders, dll) TIDAK ERROR.
module.exports = authenticate;

// B. Kita tempelkan 'requireAdmin' ke fungsi tersebut agar bisa dipakai jika butuh.
module.exports.requireAdmin = requireAdmin;

// C. Kita juga tempelkan dirinya sendiri dengan nama 'isAuthenticated' untuk kompatibilitas kode baru
module.exports.isAuthenticated = authenticate;