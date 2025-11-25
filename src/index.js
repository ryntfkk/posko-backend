// src/index.js - VERSI DARURAT
const express = require('express');
const app = express();

// Ambil port dari Railway, atau default 3000
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  console.log('🔔 PING DITERIMA!');
  res.send('Server Hidup!');
});

// Listen di 0.0.0.0 (Wajib)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server DARURAT Jalan di Port ${PORT}`);
});