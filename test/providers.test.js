'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { ProviderError, getProvider } = require('../src/services/providers');
const { encrypt, decrypt } = require('../src/services/crypto');
const { extractJson } = require('../src/services/analysisService');
const { containsDiagnosticClaim } = require('../src/services/safeLanguage');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function mockFetch(status, body, capture) {
  global.fetch = async (url, init) => {
    capture && capture.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
}

const args = { apiKey: 'k', model: 'm', systemPrompt: 's', instruction: 'i', imageBase64: 'AAA', mediaType: 'image/jpeg', timeoutMs: 5000 };

test('Anthropic: envia imagem em base64 com cabeçalhos corretos', async () => {
  const calls = [];
  mockFetch(200, { content: [{ type: 'text', text: '{"inconclusive":false}' }] }, calls);
  const text = await getProvider('anthropic').analyzeImage(args);
  assert.equal(text, '{"inconclusive":false}');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], 'k');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.messages[0].content[0].source.data, 'AAA');
});

test('OpenAI e Gemini: extraem o texto da resposta', async () => {
  mockFetch(200, { choices: [{ message: { content: '{"a":1}' } }] });
  assert.equal(await getProvider('openai').analyzeImage(args), '{"a":1}');
  mockFetch(200, { candidates: [{ content: { parts: [{ text: '{"b":2}' }] } }] });
  assert.equal(await getProvider('gemini').analyzeImage(args), '{"b":2}');
});

test('erros HTTP viram ProviderError com o tipo certo', async () => {
  mockFetch(401, { error: { message: 'bad key' } });
  await assert.rejects(getProvider('openai').analyzeImage(args), (e) => e instanceof ProviderError && e.kind === 'auth');
  mockFetch(429, {});
  await assert.rejects(getProvider('anthropic').analyzeImage(args), (e) => e.kind === 'rate');
  mockFetch(503, {});
  await assert.rejects(getProvider('gemini').analyzeImage(args), (e) => e.kind === 'unavailable');
});

test('extrai JSON mesmo com texto em volta', () => {
  assert.deepEqual(extractJson('Aqui está:\n```json\n{"x": 1}\n```'), { x: 1 });
  assert.throws(() => extractJson('sem json'), ProviderError);
});

test('criptografia de segredos: ida e volta e chave errada falha', () => {
  const k1 = crypto.randomBytes(32);
  const k2 = crypto.randomBytes(32);
  const enc = encrypt('segredo', k1);
  assert.notEqual(enc, 'segredo');
  assert.equal(decrypt(enc, k1), 'segredo');
  assert.throws(() => decrypt(enc, k2));
});

test('barreira de linguagem', () => {
  assert.ok(containsDiagnosticClaim('Você tem câncer'));
  assert.ok(containsDiagnosticClaim('risco de 80%'));
  assert.ok(!containsDiagnosticClaim('Cor marrom registrada.'));
});
