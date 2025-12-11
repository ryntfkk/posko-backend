// src/modules/regions/controller.js
const Region = require('./model');

// 1. Ambil Semua Provinsi
async function listProvinces(req, res, next) {
  try {
    const provinces = await Region.find({ type: 'province' })
      .select('id name')
      .sort({ name: 1 });
    
    res.json(provinces);
  } catch (error) {
    next(error);
  }
}

// 2. Ambil Kota berdasarkan ID Provinsi
async function listRegencies(req, res, next) {
  try {
    const { provinceId } = req.params;
    const regencies = await Region.find({ 
      type: 'regency', 
      parentId: provinceId 
    })
      .select('id name')
      .sort({ name: 1 });

    res.json(regencies);
  } catch (error) {
    next(error);
  }
}

// 3. Ambil Kecamatan berdasarkan ID Kota
async function listDistricts(req, res, next) {
  try {
    const { regencyId } = req.params;
    const districts = await Region.find({ 
      type: 'district', 
      parentId: regencyId 
    })
      .select('id name')
      .sort({ name: 1 });

    res.json(districts);
  } catch (error) {
    next(error);
  }
}

// 4. Ambil Kelurahan berdasarkan ID Kecamatan
async function listVillages(req, res, next) {
  try {
    const { districtId } = req.params;
    const villages = await Region.find({ 
      type: 'village', 
      parentId: districtId 
    })
      .select('id name')
      .sort({ name: 1 });

    res.json(villages);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listProvinces,
  listRegencies,
  listDistricts,
  listVillages
};