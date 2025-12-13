const Region = require('./model');

exports.getProvinces = async (req, res, next) => {
  try {
    // Mengambil semua wilayah dengan tipe 'province'
    // Diurutkan berdasarkan nama secara ascending (A-Z)
    const provinces = await Region.find({ type: 'province' })
      .select('id name type') // Kita hanya butuh field ini untuk dropdown
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: provinces
    });
  } catch (error) {
    next(error);
  }
};

exports.getRegionsByParent = async (req, res, next) => {
  try {
    const { parentId } = req.params;

    if (!parentId) {
      return res.status(400).json({
        success: false,
        message: 'Parent ID is required'
      });
    }

    // Mengambil wilayah anak (kota/kecamatan/kelurahan) berdasarkan parentId
    const regions = await Region.find({ parentId: parentId })
      .select('id name type parentId')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: regions
    });
  } catch (error) {
    next(error);
  }
};