'use strict';
const { test, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { analyzeImage, normalize, _resetSchemaSupport } = require('../src/services/analysisService');
const { RESPONSE_SCHEMA, ALLOWED_FEATURES, QUALITY_ISSUES } = require('../src/services/analysisPrompt');
const { ProviderError, getProvider } = require('../src/services/providers');
const { toGeminiSchema } = require('../src/services/providers/gemini');
const { containsDiagnosticClaim } = require('../src/services/safeLanguage');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});
beforeEach(() => _resetSchemaSupport());

/** Simula respostas sequenciais do provedor. */
function fetchSequence(responses, calls = []) {
  let i = 0;
  global.fetch = async (url, init) => {
    const r = responses[Math.min(i++, responses.length - 1)];
    calls.push({ url, body: JSON.parse(init.body) });
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return calls;
}

const anthropicText = (obj) => ({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify(obj) }] } });
const anthropicTool = (obj) => ({ status: 200, body: { content: [{ type: 'tool_use', name: 'x', input: obj }] } });

const providerConfig = (provider = 'anthropic') => ({
  provider,
  model: 'modelo-teste',
  apiKey: 'k',
  systemPrompt: 's',
  timeoutMs: 60_000,
});
const run = (provider) =>
  analyzeImage({ buffer: Buffer.from('img'), mediaType: 'image/jpeg', providerConfig: providerConfig(provider) }, { retryDelayMs: 1 });

const good = {
  image_quality: { adequate: true, issues: [] },
  inconclusive: false,
  reason: '',
  features: [{ code: 'predominant_color_brown', certainty: 'clear', description: 'Tons de marrom.' }],
  message: 'Material marrom.',
};

// --- Saída estruturada ------------------------------------------------------

test('Anthropic: força ferramenta com o schema e lê o JSON estruturado', async () => {
  const calls = fetchSequence([anthropicTool(good)]);
  const r = await run('anthropic');
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.features.map((f) => f.code), ['predominant_color_brown']);
  assert.equal(calls[0].body.tool_choice.type, 'tool');
  assert.deepEqual(calls[0].body.tools[0].input_schema, RESPONSE_SCHEMA);
});

test('OpenAI: usa json_schema estrito', async () => {
  const calls = fetchSequence([{ status: 200, body: { choices: [{ message: { content: JSON.stringify(good) } }] } }]);
  await run('openai');
  assert.equal(calls[0].body.response_format.type, 'json_schema');
  assert.equal(calls[0].body.response_format.json_schema.strict, true);
});

test('Gemini: converte o schema para o formato aceito', async () => {
  const calls = fetchSequence([{ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } }]);
  await run('gemini');
  const schema = calls[0].body.generationConfig.responseSchema;
  assert.equal(schema.type, 'OBJECT');
  assert.equal(schema.properties.features.items.properties.code.type, 'STRING');
  assert.ok(!JSON.stringify(schema).includes('additionalProperties'));
  assert.deepEqual(toGeminiSchema({ type: 'array', items: { type: 'boolean' } }), { type: 'ARRAY', items: { type: 'BOOLEAN' } });
});

test('modelo sem suporte a schema: repete sem schema e lembra da escolha', async () => {
  const calls = fetchSequence([
    { status: 400, body: { error: { message: 'response_format not supported' } } },
    { status: 200, body: { choices: [{ message: { content: JSON.stringify(good) } }] } },
    { status: 200, body: { choices: [{ message: { content: JSON.stringify(good) } }] } },
  ]);
  const r = await run('openai');
  assert.equal(r.status, 'completed');
  assert.equal(calls[0].body.response_format.type, 'json_schema');
  assert.equal(calls[1].body.response_format.type, 'json_object');
  await run('openai');
  assert.equal(calls[2].body.response_format.type, 'json_object', 'não tenta o schema de novo');
});

// --- Nova tentativa ---------------------------------------------------------

test('resposta inválida: tenta mais uma vez', async () => {
  const calls = fetchSequence([
    { status: 200, body: { content: [{ type: 'text', text: 'desculpe, não sei' }] } },
    anthropicTool(good),
  ]);
  const r = await run('anthropic');
  assert.equal(r.status, 'completed');
  assert.equal(calls.length, 2);
});

test('falha temporária do provedor: tenta mais uma vez; persistindo, desiste', async () => {
  const calls = fetchSequence([{ status: 503, body: {} }, { status: 503, body: {} }, anthropicTool(good)]);
  await assert.rejects(run('anthropic'), (e) => e instanceof ProviderError && e.kind === 'unavailable');
  assert.equal(calls.length, 2);
});

test('chave inválida e tempo esgotado não são repetidos', async () => {
  let calls = fetchSequence([{ status: 401, body: {} }, anthropicTool(good)]);
  await assert.rejects(run('anthropic'), (e) => e.kind === 'auth');
  assert.equal(calls.length, 1);

  const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
  calls = fetchSequence([timeout, anthropicTool(good)]);
  await assert.rejects(run('anthropic'), (e) => e.kind === 'unavailable' && e.timedOut);
  assert.equal(calls.length, 1);
});

test('sem tempo restante suficiente, não repete', async () => {
  const calls = fetchSequence([{ status: 503, body: {} }, anthropicTool(good)]);
  const cfg = { ...providerConfig(), timeoutMs: 5_000 };
  await assert.rejects(
    analyzeImage({ buffer: Buffer.from('x'), mediaType: 'image/jpeg', providerConfig: cfg }, { retryDelayMs: 1 }),
  );
  assert.equal(calls.length, 1);
});

// --- Normalização -----------------------------------------------------------

test('problema de qualidade vira orientação padronizada', () => {
  const r = normalize(
    { image_quality: { adequate: false, issues: ['too_dark', 'blurry', 'inventado'] }, inconclusive: false, features: [{ code: 'visible_blood' }] },
    'x',
  );
  assert.equal(r.status, 'inconclusive');
  assert.equal(r.features.length, 0);
  assert.equal(r.message, `${QUALITY_ISSUES.too_dark} ${QUALITY_ISSUES.blurry}`);
});

test('"não é fezes" é inconclusivo mesmo que a IA diga o contrário', () => {
  const r = normalize({ image_quality: { adequate: true, issues: ['not_stool'] }, inconclusive: false, features: [] }, 'x');
  assert.equal(r.inconclusive, true);
});

test('formato antigo (sem image_quality/certainty) continua aceito', () => {
  const r = normalize({ inconclusive: false, features: [{ code: 'pale_color', description: 'Clara.' }], message: 'ok' }, 'x');
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.features.map((f) => f.code), ['pale_color']);
});

test('certeza "possível" é sinalizada e sinais de atenção vêm primeiro', () => {
  const r = normalize(
    {
      image_quality: { adequate: true, issues: ['glare'] },
      inconclusive: false,
      features: [
        { code: 'predominant_color_brown', certainty: 'clear', description: 'Marrom.' },
        { code: 'undigested_food', certainty: 'clear', description: 'Sementes.' },
        { code: 'visible_blood', certainty: 'possible', description: 'Pequena estria avermelhada na borda.' },
      ],
      message: 'Registro feito.',
    },
    'x',
  );
  assert.deepEqual(r.features.map((f) => f.code), ['visible_blood', 'predominant_color_brown', 'undigested_food']);
  const blood = r.features[0];
  assert.match(blood.description, /Pequena estria/);
  assert.match(blood.description, /Procure avaliação médica/);
  assert.match(blood.description, /não permite certeza/);
  assert.match(r.limitations[0], /reflexos/);
});

test('códigos exclusivos: mantém um só (prefere o evidente)', () => {
  const r = normalize(
    {
      inconclusive: false,
      features: [
        { code: 'predominant_color_yellow', certainty: 'possible' },
        { code: 'predominant_color_brown', certainty: 'clear' },
        { code: 'hard_lumps', certainty: 'clear' },
        { code: 'liquid_consistency', certainty: 'clear' },
      ],
    },
    'x',
  );
  assert.deepEqual(r.features.map((f) => f.code), ['predominant_color_brown', 'hard_lumps']);
});

test('textos finais nunca têm linguagem diagnóstica', () => {
  const r = normalize(
    {
      inconclusive: false,
      features: Object.keys(ALLOWED_FEATURES).map((code) => ({ code, certainty: 'possible', description: 'tumor 90%' })),
      message: 'Você tem câncer',
    },
    'x',
  );
  for (const t of [r.message, ...r.limitations, ...r.features.flatMap((f) => [f.label, f.description])]) {
    assert.ok(!containsDiagnosticClaim(t), t);
  }
  assert.ok(r.features.length <= 8);
});

test('getProvider recusa provedor desconhecido', () => {
  assert.throws(() => getProvider('xyz'), (e) => e.kind === 'config');
});
