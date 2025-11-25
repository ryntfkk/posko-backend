// src/modules/orders/validators.js
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
  
  // --- [UPDATE BARU] Validasi ScheduledAt (Tanggal Kunjungan) ---
  const scheduledAt = normalizeString(body.scheduledAt);
  if (!scheduledAt) {
    addError(errors, 'scheduledAt', 'validation.scheduled_at_required', 'Tanggal kunjungan wajib diisi');
  } else if (isNaN(Date.parse(scheduledAt))) {
    addError(errors, 'scheduledAt', 'validation.scheduled_at_invalid', 'Format tanggal kunjungan tidak valid');
  } else if (new Date(scheduledAt) < new Date()) {
      addError(errors, 'scheduledAt', 'validation.scheduled_at_past', 'Tanggal kunjungan tidak boleh di masa lalu');
  }


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
    scheduledAt: new Date(scheduledAt) // Simpan sebagai objek Date
  };

  return next();
}

module.exports = { validateCreateOrder };