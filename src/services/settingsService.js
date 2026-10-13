'use strict';
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const { encrypt, decrypt, keyHint } = require('./crypto');
const { DEFAULT_SYSTEM_PROMPT } = require('./analysisPrompt');
const { PROVIDERS } = require('./providers');

async function getSettings() {
  let s = await Settings.findOne({ singleton: 'main' });
  if (!s) s = await Settings.create({ singleton: 'main', systemPrompt: DEFAULT_SYSTEM_PROMPT });
  if (!s.systemPrompt) s.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  return s;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Atualiza a configuração a partir do formulário do painel.
 * Campo de chave vazio = mantém a chave atual. Retorna lista de alterações.
 */
async function updateSettings(form, { encryptionKey, adminEmail }) {
  const s = await getSettings();
  const changes = [];

  const provider = ['none', 'anthropic', 'openai', 'gemini'].includes(form.provider) ? form.provider : s.provider;
  if (provider !== s.provider) changes.push(`provedor: ${s.provider} → ${provider}`);
  s.provider = provider;

  const model = String(form.model || '').trim().slice(0, 100);
  if (model !== s.model) changes.push(`modelo: ${model || '(padrão)'}`);
  s.model = model;

  const enabled = form.analysisEnabled === 'on' || form.analysisEnabled === true;
  if (enabled !== s.analysisEnabled) changes.push(`análise ${enabled ? 'ativada' : 'desativada'}`);
  s.analysisEnabled = enabled;

  for (const name of Object.keys(PROVIDERS)) {
    const newKey = String(form[`apiKey_${name}`] || '').trim();
    if (form[`removeKey_${name}`] === 'on') {
      s.apiKeys[name] = '';
      s.apiKeyHints[name] = '';
      changes.push(`chave ${name} removida`);
    } else if (newKey) {
      s.apiKeys[name] = encrypt(newKey, encryptionKey);
      s.apiKeyHints[name] = keyHint(newKey);
      changes.push(`chave ${name} atualizada`);
    }
  }

  if (form.resetPrompt === 'on') {
    s.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    changes.push('prompt restaurado ao padrão');
  } else if (typeof form.systemPrompt === 'string' && form.systemPrompt.trim() && form.systemPrompt !== s.systemPrompt) {
    s.systemPrompt = form.systemPrompt.slice(0, 8000);
    changes.push('prompt alterado');
  }

  s.maxImageMb = clampInt(form.maxImageMb, 1, 15, s.maxImageMb);
  s.analysesPerDevicePerHour = clampInt(form.analysesPerDevicePerHour, 1, 500, s.analysesPerDevicePerHour);
  s.retentionDays = clampInt(form.retentionDays, 1, 3650, s.retentionDays);
  s.requestTimeoutSec = clampInt(form.requestTimeoutSec, 10, 180, s.requestTimeoutSec);
  const consent = String(form.consentVersion || '').trim().slice(0, 40);
  if (consent) s.consentVersion = consent;

  await s.save();
  await AuditLog.create({ admin: adminEmail, action: 'settings.update', detail: changes.join('; ') || 'limites/ajustes' });
  return s;
}

/** Configuração pronta para chamar o provedor (com a chave descriptografada). */
function resolveProviderConfig(s, encryptionKey) {
  const provider = s.provider;
  if (!PROVIDERS[provider]) return null;
  const encrypted = s.apiKeys?.[provider];
  if (!encrypted) return null;
  let apiKey;
  try {
    apiKey = decrypt(encrypted, encryptionKey);
  } catch {
    return null; // chave de criptografia mudou — o admin precisa cadastrar de novo
  }
  return {
    provider,
    model: s.model || PROVIDERS[provider].defaultModel,
    apiKey,
    systemPrompt: s.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    timeoutMs: s.requestTimeoutSec * 1000,
  };
}

module.exports = { getSettings, updateSettings, resolveProviderConfig };
