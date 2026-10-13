'use strict';
const bcrypt = require('bcryptjs');
const { load } = require('./config');
const { connect } = require('./db');
const { createApp } = require('./app');
const Admin = require('./models/Admin');
const { getSettings } = require('./services/settingsService');
const { startRetentionJob } = require('./services/retention');

async function ensureFirstAdmin(config) {
  if ((await Admin.countDocuments()) > 0) return;
  if (!config.adminEmail || !config.adminPassword) {
    console.warn('[init] Nenhum administrador. Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env e reinicie.');
    return;
  }
  if (config.adminPassword.length < 10) {
    throw new Error('ADMIN_PASSWORD deve ter pelo menos 10 caracteres.');
  }
  await Admin.create({ email: config.adminEmail, passwordHash: await bcrypt.hash(config.adminPassword, 12) });
  console.log(`[init] Administrador inicial criado: ${config.adminEmail}`);
}

async function main() {
  const config = load();
  await connect(config.mongoUri);
  await ensureFirstAdmin(config);
  await getSettings();
  startRetentionJob();
  const app = createApp(config);
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[init] ColoScan API em http://localhost:${config.port}  (painel: /admin)`);
  });
}

main().catch((e) => {
  console.error('[init] Falha ao iniciar:', e.message);
  process.exit(1);
});
