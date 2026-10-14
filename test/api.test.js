'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { config, setupDb, teardownDb, buildApp, fakeJpeg } = require('./helpers');
const Settings = require('../src/models/Settings');
const Analysis = require('../src/models/Analysis');
const { encrypt } = require('../src/services/crypto');
const { getSettings } = require('../src/services/settingsService');
const { normalize } = require('../src/services/analysisService');
const { purgeExpired } = require('../src/services/retention');

let analyzeCalls = 0;
const stubAnalyze = async ({ mediaType, providerConfig }) => {
  analyzeCalls++;
  assert.equal(mediaType, 'image/jpeg');
  assert.equal(providerConfig.apiKey, 'sk-test-123456');
  return normalize(
    {
      inconclusive: false,
      features: [
        { code: 'predominant_color_brown', description: 'Tons de marrom.' },
        { code: 'visible_blood', description: 'Você tem câncer' },
        { code: 'codigo_inventado', description: 'x' },
      ],
      message: 'Características registradas.',
    },
    'anthropic:modelo-teste',
  );
};

let app;
before(async () => {
  await setupDb();
  app = buildApp({ analyze: stubAnalyze });
});
after(teardownDb);
beforeEach(async () => {
  await Settings.deleteMany({});
  await Analysis.deleteMany({});
  analyzeCalls = 0;
});

async function enableProvider() {
  const s = await getSettings();
  s.provider = 'anthropic';
  s.analysisEnabled = true;
  s.apiKeys.anthropic = encrypt('sk-test-123456', config.encryptionKey);
  await s.save();
}

async function register(platform = 'android') {
  const res = await request(app).post('/api/v1/devices/register').send({ platform, app_version: '0.1.0' }).expect(201);
  assert.ok(res.body.token);
  return res.body.token;
}

function postImage(token, { image = fakeJpeg, consent = true } = {}) {
  const r = request(app).post('/api/v1/image-analysis').set('Authorization', `Bearer ${token}`);
  if (consent) r.field('consent_version', '2026-10-draft-1').field('consent_at', new Date().toISOString());
  return r.attach('image', image, { filename: 'image.jpg', contentType: 'image/jpeg' });
}

test('health informa indisponível sem provedor e disponível quando configurado', async () => {
  let res = await request(app).get('/api/v1/health').expect(200);
  assert.equal(res.body.analysis_available, false);
  await enableProvider();
  res = await request(app).get('/api/v1/health').expect(200);
  assert.equal(res.body.analysis_available, true);
});

test('análise exige token de dispositivo', async () => {
  await request(app).post('/api/v1/image-analysis').expect(401);
  await postImage('token-invalido').expect(401);
});

test('sem provedor configurado responde 503 e não chama a IA', async () => {
  const token = await register();
  await postImage(token).expect(503);
  assert.equal(analyzeCalls, 0);
});

test('análise completa segue o contrato e filtra linguagem/códigos', async () => {
  await enableProvider();
  const token = await register();
  const res = await postImage(token).expect(200);
  const b = res.body;
  assert.ok(b.analysis_id);
  assert.equal(b.status, 'completed');
  assert.equal(b.inconclusive, false);
  assert.equal(b.clinically_validated, false);
  assert.equal(b.recommend_medical_evaluation, false);
  assert.equal(b.model_version, 'anthropic:modelo-teste');
  // Sinais de atenção vêm primeiro; código inventado é descartado.
  assert.deepEqual(b.features.map((f) => f.code), ['visible_blood', 'predominant_color_brown']);
  assert.ok(!JSON.stringify(b).includes('câncer'), 'texto diagnóstico deve ser removido');
  assert.ok(b.limitations.length > 0);
  // Imagem não é salva: o documento só tem texto.
  const doc = await Analysis.findById(b.analysis_id).lean();
  assert.ok(!('image' in doc));
  assert.ok(doc.expiresAt > new Date());
});

test('exige consentimento e imagem válida', async () => {
  await enableProvider();
  const token = await register();
  await postImage(token, { consent: false }).expect(422);
  await postImage(token, { image: Buffer.from('isto não é uma imagem, só texto qualquer') }).expect(415);
  assert.equal(analyzeCalls, 0);
});

test('cada dispositivo só acessa e exclui as próprias análises', async () => {
  await enableProvider();
  const a = await register();
  const b = await register('ios');
  const { body } = await postImage(a).expect(200);
  const id = body.analysis_id;

  await request(app).get(`/api/v1/image-analysis/${id}`).set('Authorization', `Bearer ${a}`).expect(200);
  await request(app).get(`/api/v1/image-analysis/${id}`).set('Authorization', `Bearer ${b}`).expect(404);
  await request(app).delete(`/api/v1/image-analysis/${id}`).set('Authorization', `Bearer ${b}`).expect(404);
  await request(app).get('/api/v1/image-analysis/nao-e-um-id').set('Authorization', `Bearer ${a}`).expect(404);

  await request(app).delete(`/api/v1/image-analysis/${id}`).set('Authorization', `Bearer ${a}`).expect(204);
  await request(app).get(`/api/v1/image-analysis/${id}`).set('Authorization', `Bearer ${a}`).expect(404);
});

test('excluir dispositivo apaga os dados e invalida o token', async () => {
  await enableProvider();
  const token = await register();
  await postImage(token).expect(200);
  await request(app).delete('/api/v1/devices/me').set('Authorization', `Bearer ${token}`).expect(204);
  assert.equal(await Analysis.countDocuments(), 0);
  await request(app).delete('/api/v1/devices/me').set('Authorization', `Bearer ${token}`).expect(401);
});

test('respeita o limite de tamanho configurado', async () => {
  await enableProvider();
  await Settings.updateOne({}, { maxImageMb: 1 });
  const token = await register();
  const big = Buffer.concat([fakeJpeg.subarray(0, 4), Buffer.alloc(1.5 * 1024 * 1024)]);
  await postImage(token, { image: big }).expect(413);
});

test('normalize: resultado inconclusivo não traz características', () => {
  const r = normalize({ inconclusive: true, reason: 'Imagem escura.', features: [{ code: 'visible_blood' }] }, 'x');
  assert.equal(r.status, 'inconclusive');
  assert.equal(r.features.length, 0);
  assert.equal(r.message, 'Imagem escura.');
});

test('rotina de retenção apaga resultados expirados', async () => {
  const Device = require('../src/models/Device');
  const d = await Device.create({ tokenHash: 'h1' });
  const base = { device: d._id, status: 'completed', consentVersion: 'v', consentAt: new Date() };
  await Analysis.create({ ...base, expiresAt: new Date(Date.now() - 1000) });
  await Analysis.create({ ...base, expiresAt: new Date(Date.now() + 86400000) });
  assert.equal(await purgeExpired(), 1);
  assert.equal(await Analysis.countDocuments(), 1);
});
