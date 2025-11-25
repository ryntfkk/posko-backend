const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateItem(item, index, errors) {
  // 1. Validasi Service ID di dalam item
  const serviceId = normalizeString(item?.serviceId);
  if (!serviceId) {
    addError(errors, `items[${index}].serviceId`, 'validation.service_id_required', 'Service ID pada item wajib diisi');
  }

  const name = normalizeString(item?.name);
  if (!name) {
    addError(errors, `items[${index}].name`, 'validation.item_name_required', 'Nama item wajib diisi');
  }

  const quantity = item?.quantity;
  if (quantity === undefined) {
    addError(errors, `items[${index}].quantity`, 'validation.quantity_required', 'Jumlah item wajib diisi');
  } else if (typeof quantity !== 'number' || Number.isNaN(quantity) || quantity < 1) {
    addError(errors, `items[${index}].quantity`, 'validation.quantity_invalid', 'Jumlah item harus angka minimal 1');
  }

  const price = item?.price;
  if (price === undefined) {
    addError(errors, `items[${index}].price`, 'validation.price_required', 'Harga item wajib diisi');
  } else if (typeof price !== 'number' || Number.isNaN(price) || price < 0) {
    addError(errors, `items[${index}].price`, 'validation.price_invalid', 'Harga item harus angka positif');
  }

  return {
    serviceId, // Return serviceId yang sudah dinormalisasi
    name,
    quantity: typeof quantity === 'number' ? quantity : undefined,
    price: typeof price === 'number' ? price : undefined,
    note: normalizeString(item?.note) || ''
  };
}

// --- [BARU] Helper Validasi Alamat ---
function validateAddressAndLocation(body, errors) {
  const address = body.shippingAddress || {};
  const location = body.location || {};

  const province = normalizeString(address.province);
  const city = normalizeString(address.city);
  const detail = normalizeString(address.detail);

  if (!province || !city || !detail) {
    addError(errors, 'shippingAddress', 'validation.address_incomplete', 'Alamat pengiriman (province, city, detail) wajib diisi');
  }

  const coordinates = location.coordinates;
  const hasCoordinates = Array.isArray(coordinates) && coordinates.length === 2;
  const numericCoordinates = hasCoordinates ? coordinates.map(Number) : [];
  const coordinatesAreValid = numericCoordinates.every(Number.isFinite);

  if (!hasCoordinates || !coordinatesAreValid) {
    addError(errors, 'location', 'validation.invalid_coordinates', 'Titik lokasi wajib berupa [longitude, latitude] yang valid');
  }

  return {
    shippingAddress: {
      province: province || '',
      city: city || '',
      district: normalizeString(address.district) || '',
      village: normalizeString(address.village) || '',
      postalCode: normalizeString(address.postalCode) || '',
      detail: detail || '',
    },
    location: {
      type: normalizeString(location.type) || 'Point',
      coordinates: numericCoordinates.length === 2 ? numericCoordinates : [0, 0],
    },
  };
}

function validateCreateOrder(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const providerId = normalizeString(body.providerId);
  
  // Validasi Order Type
  const orderType = normalizeString(body.orderType);
  if (!orderType || !['direct', 'basic'].includes(orderType)) {
    addError(errors, 'orderType', 'validation.order_type_invalid', 'Tipe order harus direct atau basic');
  }

  // Validasi Items (Array)
  let items = [];
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    addError(errors, 'items', 'validation.items_required', 'Items wajib diisi minimal satu');
  } else {
    items = body.items.map((item, index) => validateItem(item, index, errors));
  }

  // Validasi Total Amount
  const totalAmount = body.totalAmount;
  if (totalAmount === undefined || totalAmount === null) {
    addError(errors, 'totalAmount', 'validation.total_amount_required', 'Total belanja wajib diisi');
  } else if (typeof totalAmount !== 'number' || totalAmount < 0) {
    addError(errors, 'totalAmount', 'validation.total_amount_invalid', 'Total belanja harus angka positif');
  }
  
  // Validasi ScheduledAt (Tanggal Kunjungan)
  const scheduledAt = normalizeString(body.scheduledAt);
  if (!scheduledAt) {
    addError(errors, 'scheduledAt', 'validation.scheduled_at_required', 'Tanggal kunjungan wajib diisi');
  } else if (isNaN(Date.parse(scheduledAt))) {
    addError(errors, 'scheduledAt', 'validation.scheduled_at_invalid', 'Format tanggal kunjungan tidak valid');
  } else if (new Date(scheduledAt) < new Date()) {
      addError(errors, 'scheduledAt', 'validation.scheduled_at_past', 'Tanggal kunjungan tidak boleh di masa lalu');
  }
  
  // --- [UPDATE BARU] Validasi Alamat dan Lokasi ---
  const { shippingAddress, location } = validateAddressAndLocation(body, errors);


  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  // Susun ulang body agar sesuai Model
  req.body = {
    ...body,
    orderType,
    providerId,
    items,
    totalAmount,
    scheduledAt: new Date(scheduledAt), // Simpan sebagai objek Date
    shippingAddress, // Simpan objek alamat
    location,        // Simpan objek lokasi
  };

  return next();
}

module.exports = { validateCreateOrder };