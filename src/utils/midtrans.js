const midtransClient = require('midtrans-client');
const env = require('../config/env');

// Inisialisasi Core Snap
const snap = new midtransClient.Snap({
  isProduction: env.nodeEnv === 'production',
  serverKey: env.midtransKey,
  clientKey: env.midtransClientKey
});

module.exports = snap;