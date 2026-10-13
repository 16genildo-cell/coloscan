'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const mongoose = require('mongoose');

const { buildApiRouter } = require('./routes/apiV1');
const { buildAdminRouter } = require('./routes/admin');

/**
 * Monta a aplicação Express. `options.analyze` permite substituir o
 * provedor de IA nos testes.
 */
function createApp(config, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'"], scriptSrc: ["'self'"] },
      },
    }),
  );
  app.use('/public', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));

  // API do app móvel (sem sessão/cookies).
  app.use(
    '/api/v1',
    buildApiRouter({ encryptionKey: config.encryptionKey, ...(options.analyze ? { analyze: options.analyze } : {}) }),
  );

  // Painel administrativo (sessão em cookie httpOnly, guardada no MongoDB).
  app.use(
    '/admin',
    session({
      name: 'coloscan.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: options.sessionStore || MongoStore.create({
        client: mongoose.connection.getClient(),
        ttl: 8 * 3600,
        autoRemove: 'interval',
        autoRemoveInterval: 10,
      }),
      cookie: { httpOnly: true, sameSite: 'strict', secure: config.isProduction, maxAge: 8 * 3600 * 1000 },
    }),
    buildAdminRouter({ encryptionKey: config.encryptionKey }),
  );

  app.get('/', (req, res) => res.redirect('/admin'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error('[admin] erro:', err?.name || 'Error', err?.message ? String(err.message).slice(0, 200) : '');
    res.status(500).render('error', { title: 'Erro', message: 'Ocorreu um erro inesperado.' });
  });
  app.use((req, res) => res.status(404).render('error', { title: 'Não encontrado', message: 'Página não encontrada.' }));

  return app;
}

module.exports = { createApp };
