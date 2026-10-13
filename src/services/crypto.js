'use strict';
const crypto = require('crypto');

/** Criptografia AES-256-GCM para segredos guardados no banco. */
function encrypt(plain, key) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

function decrypt(payload, key) {
  if (!payload) return '';
  const [version, iv, tag, data] = payload.split(':');
  if (version !== 'v1') throw new Error('formato de segredo desconhecido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Token aleatório e seu hash (só o hash é salvo). */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function keyHint(secret) {
  if (!secret) return '';
  const s = String(secret);
  return s.length <= 8 ? '••••' : `••••${s.slice(-4)}`;
}

module.exports = { encrypt, decrypt, newToken, hashToken, keyHint };
