// src/modules/regions/routes.js
const express = require('express');
const router = express.Router();
const RegionController = require('./controller');

// Definisi URL Endpoint
// GET /api/regions/provinces
router.get('/provinces', RegionController.listProvinces);

// GET /api/regions/regencies/:provinceId
router.get('/regencies/:provinceId', RegionController.listRegencies);

// GET /api/regions/districts/:regencyId
router.get('/districts/:regencyId', RegionController.listDistricts);

// GET /api/regions/villages/:districtId
router.get('/villages/:districtId', RegionController.listVillages);

module.exports = router;