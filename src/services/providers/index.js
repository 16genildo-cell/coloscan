'use strict';

class ProviderError extends Error {
  /** @param {'auth'|'rate'|'unavailable'|'bad_response'|'config'} kind */
  constructor(kind, message, { timedOut = false } = {}) {
    super(message);
    this.kind = kind;
    this.timedOut = timedOut;
  }
}

const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-5-5' },
  openai: { label: 'OpenAI (GPT)', defaultModel: 'gpt-4o-mini' },
  gemini: { label: 'Google (Gemini)', defaultModel: 'gemini-2.5-flash' },
};

async function postJson(url, { headers, body, timeoutMs }) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e.name === 'TimeoutError';
    throw new ProviderError('unavailable', timedOut ? 'tempo esgotado' : 'falha de rede', { timedOut });
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError('auth', 'chave de API inválida ou sem permissão');
  if (res.status === 429) throw new ProviderError('rate', 'limite de uso do provedor atingido');
  if (res.status === 404) throw new ProviderError('config', 'modelo não encontrado — confira o nome do modelo');
  if (res.status >= 500) throw new ProviderError('unavailable', `provedor indisponível (${res.status})`);
  if (!res.ok) {
    const msg = json?.error?.message || `erro ${res.status}`;
    throw new ProviderError('config', String(msg).slice(0, 200));
  }
  return json;
}

function getProvider(name) {
  switch (name) {
    case 'anthropic':
      return require('./anthropic');
    case 'openai':
      return require('./openai');
    case 'gemini':
      return require('./gemini');
    default:
      throw new ProviderError('config', 'nenhum provedor de IA configurado');
  }
}

module.exports = { ProviderError, PROVIDERS, postJson, getProvider };
