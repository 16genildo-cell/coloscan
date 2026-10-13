'use strict';
const Device = require('../models/Device');
const { hashToken } = require('../services/crypto');

/** Autentica o app pelo token do dispositivo (Authorization: Bearer ...). */
async function deviceAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const device = await Device.findOne({ tokenHash: hashToken(token) });
    if (!device) return res.status(401).json({ error: 'unauthorized' });
    req.device = device;
    // Atualiza "visto por último" no máximo uma vez por hora.
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 3600_000) {
      device.lastSeenAt = new Date();
      device.save().catch(() => {});
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { deviceAuth };
