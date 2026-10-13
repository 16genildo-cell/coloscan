'use strict';
require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v.trim();
}

function load() {
  const env = process.env.NODE_ENV || 'development';
  const encKey = required('SETTINGS_ENCRYPTION_KEY');
  const keyBuf = Buffer.from(encKey, 'base64');
  if (keyBuf.length !== 32) {
    throw new Error('SETTINGS_ENCRYPTION_KEY deve ter 32 bytes em base64 (veja .env.example).');
  }
  const sessionSecret = required('SESSION_SECRET');
  if (env === 'production' && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET muito curto para produção (mínimo 32 caracteres).');
  }
  return {
    env,
    isProduction: env === 'production',
    port: Number(process.env.PORT || 3000),
    mongoUri: required('MONGODB_URI'),
    sessionSecret,
    encryptionKey: keyBuf,
    adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    trustProxy: process.env.TRUST_PROXY === '1',
  };
}

module.exports = { load };
