const { addError, respondValidationErrors, normalizeString } = require('../../utils/validation');

function validateItem(item, index, errors) {
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
    serviceId,
    name,
    quantity: typeof quantity === 'number' ? quantity : undefined,
    price: typeof price === 'number' ? price : undefined,
    note: normalizeString(item?.note) || ''
  };
}

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
  const numericCoordinates = hasCoordinates ?  coordinates.map(Number) : [];
  const coordinatesAreValid = numericCoordinates.every(Number.isFinite);

  if (!hasCoordinates || ! coordinatesAreValid) {
    addError(errors, 'location', 'validation.invalid_coordinates', 'Titik lokasi wajib berupa [longitude, latitude] yang valid');
  } else {
    const [lng, lat] = numericCoordinates;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      addError(errors, 'location', 'validation.coordinates_out_of_range', 'Koordinat di luar rentang yang valid');
    }
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

// [BARU] Validasi Customer Contact (CRITICAL)
function validateCustomerContact(body, errors) {
  const contact = body.customerContact || {};
  
  const phone = normalizeString(contact.phone);
  if (!phone) {
    addError(errors, 'customerContact.phone', 'validation.phone_required', 'Nomor HP wajib diisi');
  } else if (!/^[0-9+\-\s]{8,15}$/.test(phone.replace(/\s/g, ''))) {
    addError(errors, 'customerContact.phone', 'validation.phone_invalid', 'Format nomor HP tidak valid');
  }

  return {
    name: normalizeString(contact.name) || '',
    phone: phone || '',
    alternatePhone: normalizeString(contact.alternatePhone) || ''
  };
}

// [BARU] Validasi Property Details (MEDIUM)
function validatePropertyDetails(body) {
  const property = body.propertyDetails || {};
  const validTypes = ['rumah', 'apartemen', 'kantor', 'ruko', 'kendaraan', 'lainnya', ''];
  
  return {
    type: validTypes.includes(property.type) ? property.type : '',
    floor: typeof property.floor === 'number' && property.floor >= 0 ? property.floor : null,
    hasParking: typeof property.hasParking === 'boolean' ? property.hasParking : true,
    hasElevator: typeof property.hasElevator === 'boolean' ? property.hasElevator : false,
    accessNote: normalizeString(property.accessNote) || ''
  };
}

// [BARU] Validasi Scheduled Time Slot (MEDIUM)
function validateScheduledTimeSlot(body) {
  const slot = body.scheduledTimeSlot || {};
  const timeRegex = /^([01]? [0-9]|2[0-3]):[0-5][0-9]$/;
  
  return {
    preferredStart: timeRegex.test(slot.preferredStart) ?  slot.preferredStart : '',
    preferredEnd: timeRegex.test(slot.preferredEnd) ? slot.preferredEnd : '',
    isFlexible: typeof slot.isFlexible === 'boolean' ? slot.isFlexible : true
  };
}

// [BARU] Validasi Attachments (HIGH)
function validateAttachments(body, errors) {
  const attachments = body.attachments || [];
  
  if (! Array.isArray(attachments)) {
    return [];
  }
  
  // Batas maksimal 5 lampiran
  if (attachments.length > 5) {
    addError(errors, 'attachments', 'validation.attachments_max', 'Maksimal 5 lampiran per order');
  }
  
  return attachments.slice(0, 5).map((att, index) => {
    const url = normalizeString(att.url);
    if (!url) {
      addError(errors, `attachments[${index}].url`, 'validation.attachment_url_required', 'URL lampiran wajib diisi');
    }
    
    return {
      url: url || '',
      type: ['photo', 'video'].includes(att.type) ? att.type : 'photo',
      description: normalizeString(att.description) || '',
      uploadedAt: new Date()
    };
  }).filter(att => att.url);
}

function validateCreateOrder(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const providerId = normalizeString(body.providerId);
  
  const orderType = normalizeString(body.orderType);
  if (!orderType || !['direct', 'basic'].includes(orderType)) {
    addError(errors, 'orderType', 'validation.order_type_invalid', 'Tipe order harus direct atau basic');
  }

  let items = [];
  if (! body.items || !Array.isArray(body.items) || body.items.length === 0) {
    addError(errors, 'items', 'validation.items_required', 'Items wajib diisi minimal satu');
  } else {
    items = body.items.map((item, index) => validateItem(item, index, errors));
  }

  const totalAmount = body.totalAmount;
  if (totalAmount === undefined || totalAmount === null) {
    addError(errors, 'totalAmount', 'validation.total_amount_required', 'Total belanja wajib diisi');
  } else if (typeof totalAmount !== 'number' || totalAmount < 0) {
    addError(errors, 'totalAmount', 'validation.total_amount_invalid', 'Total belanja harus angka positif');
  }
  
  const scheduledAt = normalizeString(body.scheduledAt);
  if (! scheduledAt) {
    addError(errors, 'scheduledAt', 'validation.scheduled_at_required', 'Tanggal kunjungan wajib diisi');
  } else if (isNaN(Date.parse(scheduledAt))) {
    addError(errors, 'scheduledAt', 'validation.scheduled_at_invalid', 'Format tanggal kunjungan tidak valid');
  } else {
    const scheduledDate = new Date(scheduledAt);
    const nowWithMargin = new Date(Date.now() - 5 * 60 * 1000);
    
    if (scheduledDate < nowWithMargin) {
      addError(errors, 'scheduledAt', 'validation.scheduled_at_past', 'Tanggal kunjungan tidak boleh di masa lalu');
    }
  }
  
  const { shippingAddress, location } = validateAddressAndLocation(body, errors);
  
  // [BARU] Validasi field tambahan
  const customerContact = validateCustomerContact(body, errors);
  const propertyDetails = validatePropertyDetails(body);
  const scheduledTimeSlot = validateScheduledTimeSlot(body);
  const attachments = validateAttachments(body, errors);
  const orderNote = normalizeString(body.orderNote) || '';
  
  // Validasi panjang orderNote
  if (orderNote.length > 500) {
    addError(errors, 'orderNote', 'validation.order_note_too_long', 'Catatan order maksimal 500 karakter');
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body = {
    ...body,
    orderType,
    providerId,
    items,
    totalAmount,
    scheduledAt: new Date(scheduledAt),
    shippingAddress,
    location,
    // [BARU] Field tambahan
    customerContact,
    propertyDetails,
    scheduledTimeSlot,
    attachments,
    orderNote: orderNote.slice(0, 500),
  };

  return next();
}

module.exports = { validateCreateOrder };