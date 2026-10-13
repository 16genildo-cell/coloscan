'use strict';
const { Schema, model } = require('mongoose');

/**
 * Instalação do app. Não guarda dados pessoais: apenas um identificador
 * aleatório e o HASH do token (o token em si fica só no celular).
 */
const DeviceSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['android', 'ios', 'other'], default: 'other' },
    appVersion: { type: String, maxlength: 32 },
    lastSeenAt: Date,
  },
  { timestamps: true },
);

module.exports = model('Device', DeviceSchema);
