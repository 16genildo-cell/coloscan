'use strict';
const { Schema, model } = require('mongoose');

/** Documento único com a configuração editável pelo painel. */
const SettingsSchema = new Schema(
  {
    singleton: { type: String, default: 'main', unique: true },
    analysisEnabled: { type: Boolean, default: false },
    provider: { type: String, enum: ['none', 'anthropic', 'openai', 'gemini'], default: 'none' },
    model: { type: String, default: '' },
    // Chaves CRIPTOGRAFADAS (AES-256-GCM). Nunca exibidas no painel.
    apiKeys: {
      anthropic: { type: String, default: '' },
      openai: { type: String, default: '' },
      gemini: { type: String, default: '' },
    },
    apiKeyHints: {
      anthropic: { type: String, default: '' },
      openai: { type: String, default: '' },
      gemini: { type: String, default: '' },
    },
    systemPrompt: { type: String, default: '' },
    maxImageMb: { type: Number, default: 10, min: 1, max: 15 },
    analysesPerDevicePerHour: { type: Number, default: 10, min: 1, max: 500 },
    retentionDays: { type: Number, default: 30, min: 1, max: 3650 },
    requestTimeoutSec: { type: Number, default: 60, min: 10, max: 180 },
    consentVersion: { type: String, default: '2026-10-draft-1' },
  },
  { timestamps: true },
);

module.exports = model('Settings', SettingsSchema);
