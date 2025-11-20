const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateItem(item, index, errors) {
  const name = normalizeString(item?.name);
  if (!name) {
    addError(errors, `items[${index}].name`, 'validation.item_name_required', 'Nama item wajib diisi');
  }

  const quantity = item?.quantity;
  if (quantity === undefined) {
    addError(
      errors,
      `items[${index}].quantity`,
      'validation.quantity_required',
      'Jumlah item wajib diisi'
    );
  } else if (typeof quantity !== 'number' || Number.isNaN(quantity) || quantity < 1) {
    addError(
      errors,
      `items[${index}].quantity`,
      'validation.quantity_invalid',
      'Jumlah item harus berupa angka minimal 1'
    );
  }

  const price = item?.price;
  if (price === undefined) {
    addError(errors, `items[${index}].price`, 'validation.price_required', 'Harga item wajib diisi');
  } else if (typeof price !== 'number' || Number.isNaN(price) || price < 0) {
    addError(
      errors,
      `items[${index}].price`,
      'validation.price_invalid',
      'Harga item harus berupa angka dan tidak boleh negatif'
    );
  }

  return {
    name,
    quantity: typeof quantity === 'number' ? quantity : undefined,
    price: typeof price === 'number' ? price : undefined,
  };
}

function validateCreateOrder(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const providerId = normalizeString(body.providerId);

  let items = [];
  if (body.items !== undefined && !Array.isArray(body.items)) {
    addError(errors, 'items', 'validation.items_array', 'Items harus berupa array');
  } else if (Array.isArray(body.items)) {
    items = body.items.map((item, index) => validateItem(item, index, errors));
  }

  const totalAmount = body.totalAmount;
  if (totalAmount === undefined || totalAmount === null) {
    addError(errors, 'totalAmount', 'validation.total_amount_required', 'Total belanja wajib diisi');
  } else if (typeof totalAmount !== 'number' || Number.isNaN(totalAmount) || totalAmount < 0) {
    addError(
      errors,
      'totalAmount',
      'validation.total_amount_invalid',
      'Total belanja harus berupa angka dan tidak boleh negatif'
    );
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = {
    ...body,
    providerId,
    items,
    totalAmount,
  };

  return next();
}

module.exports = { validateCreateOrder };