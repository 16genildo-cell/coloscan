'use strict';
const { Schema, model } = require('mongoose');

/** Registro de ações administrativas (sem dados de saúde nem segredos). */
const AuditLogSchema = new Schema(
  {
    admin: { type: String, required: true },
    action: { type: String, required: true },
    detail: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports = model('AuditLog', AuditLogSchema);
