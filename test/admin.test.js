'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { config, setupDb, teardownDb, buildApp, createAdmin } = require('./helpers');
const Settings = require('../src/models/Settings');
const { decrypt } = require('../src/services/crypto');

let app;
let creds;
before(async () => {
  await setupDb();
  creds = await createAdmin();
  app = buildApp();
});
after(teardownDb);

function csrfFrom(html) {
  const m = /name="_csrf" value="([^"]+)"/.exec(html);
  assert.ok(m, 'token CSRF ausente');
  return m[1];
}

async function loggedAgent() {
  const agent = request.agent(app);
  const page = await agent.get('/admin/login').expect(200);
  await agent
    .post('/admin/login')
    .type('form')
    .send({ _csrf: csrfFrom(page.text), email: creds.email, password: creds.password })
    .expect(302)
    .expect('Location', '/admin');
  return agent;
}

test('painel exige login', async () => {
  await request(app).get('/admin').expect(302).expect('Location', '/admin/login');
  await request(app).get('/admin/settings').expect(302);
});

test('senha errada é recusada', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/admin/login');
  const res = await agent
    .post('/admin/login')
    .type('form')
    .send({ _csrf: csrfFrom(page.text), email: creds.email, password: 'errada-errada' })
    .expect(401);
  assert.match(res.text, /incorretos/);
});

test('formulário sem token CSRF é bloqueado', async () => {
  const agent = await loggedAgent();
  await agent.post('/admin/settings').type('form').send({ provider: 'openai' }).expect(403);
});

test('admin salva provedor e chave (criptografada, nunca exibida)', async () => {
  const agent = await loggedAgent();
  const dash = await agent.get('/admin').expect(200);
  assert.match(dash.text, /Inativa/);

  const page = await agent.get('/admin/settings').expect(200);
  await agent
    .post('/admin/settings')
    .type('form')
    .send({
      _csrf: csrfFrom(page.text),
      analysisEnabled: 'on',
      provider: 'openai',
      model: 'gpt-teste',
      apiKey_openai: 'sk-segredo-abcd1234',
      maxImageMb: '8',
      analysesPerDevicePerHour: '5',
      retentionDays: '15',
      requestTimeoutSec: '30',
      systemPrompt: 'prompt personalizado',
    })
    .expect(302);

  const s = await Settings.findOne().lean();
  assert.equal(s.provider, 'openai');
  assert.equal(s.analysisEnabled, true);
  assert.notEqual(s.apiKeys.openai, 'sk-segredo-abcd1234');
  assert.equal(decrypt(s.apiKeys.openai, config.encryptionKey), 'sk-segredo-abcd1234');
  assert.equal(s.apiKeyHints.openai, '••••1234');
  assert.equal(s.retentionDays, 15);
  assert.equal(s.systemPrompt, 'prompt personalizado');

  const again = await agent.get('/admin/settings').expect(200);
  assert.ok(!again.text.includes('sk-segredo-abcd1234'), 'a chave não pode aparecer na página');
  assert.match(again.text, /••••1234/);

  const dash2 = await agent.get('/admin').expect(200);
  assert.match(dash2.text, /Ativa/);
  assert.match(dash2.text, /settings.update/);
});

test('campo de chave vazio mantém a chave atual; remover apaga', async () => {
  const agent = await loggedAgent();
  let page = await agent.get('/admin/settings');
  await agent.post('/admin/settings').type('form').send({ _csrf: csrfFrom(page.text), provider: 'openai', apiKey_openai: '' }).expect(302);
  let s = await Settings.findOne().lean();
  assert.ok(s.apiKeys.openai);

  page = await agent.get('/admin/settings');
  await agent.post('/admin/settings').type('form').send({ _csrf: csrfFrom(page.text), provider: 'openai', removeKey_openai: 'on' }).expect(302);
  s = await Settings.findOne().lean();
  assert.equal(s.apiKeys.openai, '');
});

test('páginas de análises, dispositivos e conta abrem', async () => {
  const agent = await loggedAgent();
  for (const p of ['/admin/analyses', '/admin/devices', '/admin/account']) {
    await agent.get(p).expect(200);
  }
});
