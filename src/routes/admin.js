'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const Admin = require('../models/Admin');
const Device = require('../models/Device');
const Analysis = require('../models/Analysis');
const AuditLog = require('../models/AuditLog');
const { requireAdmin, csrf } = require('../middleware/adminAuth');
const { getSettings, updateSettings, resolveProviderConfig } = require('../services/settingsService');
const { PROVIDERS, getProvider, ProviderError } = require('../services/providers');
const { DEFAULT_SYSTEM_PROMPT, ALLOWED_FEATURES } = require('../services/analysisPrompt');
const providerStatus = require('../services/providerStatus');

const PAGE_SIZE = 25;

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function buildAdminRouter({ encryptionKey }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '64kb' }));
  router.use((req, res, next) => {
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.path = req.path;
    next();
  });
  router.use(csrf);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (req, res) =>
      res.status(429).render('login', { title: 'Entrar', error: 'Muitas tentativas. Aguarde 15 minutos.', email: '' }),
  });

  // ---- Login ---------------------------------------------------------
  router.get('/login', (req, res) => {
    if (req.session.adminEmail) return res.redirect('/admin');
    return res.render('login', { title: 'Entrar', error: null, email: '' });
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const admin = await Admin.findOne({ email });
      const ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
      if (!ok) {
        return res.status(401).render('login', { title: 'Entrar', error: 'E-mail ou senha incorretos.', email });
      }
      return req.session.regenerate(async (err) => {
        if (err) return next(err);
        req.session.adminEmail = admin.email;
        admin.lastLoginAt = new Date();
        await admin.save();
        await AuditLog.create({ admin: admin.email, action: 'login' });
        return res.redirect('/admin');
      });
    } catch (e) {
      return next(e);
    }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
  });

  router.use(requireAdmin);

  // ---- Painel --------------------------------------------------------
  router.get('/', async (req, res, next) => {
    try {
      const s = await getSettings();
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const [devices, total, week, inconclusiveWeek, audit] = await Promise.all([
        Device.countDocuments(),
        Analysis.countDocuments(),
        Analysis.countDocuments({ createdAt: { $gte: since } }),
        Analysis.countDocuments({ createdAt: { $gte: since }, inconclusive: true }),
        AuditLog.find().sort({ createdAt: -1 }).limit(8).lean(),
      ]);
      res.render('dashboard', {
        title: 'Painel',
        settings: s,
        providerLabel: PROVIDERS[s.provider]?.label || 'Nenhum',
        ready: s.analysisEnabled && !!resolveProviderConfig(s, encryptionKey),
        hasKey: !!s.apiKeys?.[s.provider],
        stats: { devices, total, week, inconclusiveWeek },
        audit,
        lastError: providerStatus.get(),
      });
    } catch (e) {
      next(e);
    }
  });

  // ---- Configurações de IA -----------------------------------------
  router.get('/settings', async (req, res, next) => {
    try {
      res.render('settings', {
        title: 'Configurações de IA',
        s: await getSettings(),
        providers: PROVIDERS,
        defaultPrompt: DEFAULT_SYSTEM_PROMPT,
        featureCodes: Object.entries(ALLOWED_FEATURES),
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/settings', async (req, res, next) => {
    try {
      await updateSettings(req.body, { encryptionKey, adminEmail: req.session.adminEmail });
      flash(req, 'success', 'Configurações salvas.');
      res.redirect('/admin/settings');
    } catch (e) {
      next(e);
    }
  });

  router.post('/settings/test', async (req, res, next) => {
    try {
      const s = await getSettings();
      const cfg = resolveProviderConfig(s, encryptionKey);
      if (!cfg) {
        flash(req, 'error', 'Escolha um provedor e cadastre a chave de API antes de testar.');
        return res.redirect('/admin/settings');
      }
      try {
        await getProvider(cfg.provider).testConnection({ apiKey: cfg.apiKey, model: cfg.model, timeoutMs: 20000 });
        providerStatus.clear();
        flash(req, 'success', `Conexão com ${PROVIDERS[cfg.provider].label} (modelo ${cfg.model}) funcionando.`);
      } catch (e) {
        const msg = e instanceof ProviderError ? e.message : 'erro inesperado';
        flash(req, 'error', `Falha ao conectar: ${msg}.`);
      }
      await AuditLog.create({ admin: req.session.adminEmail, action: 'settings.test', detail: cfg.provider });
      return res.redirect('/admin/settings');
    } catch (e) {
      return next(e);
    }
  });

  // ---- Análises (somente resultados em texto; imagens não são guardadas) ----
  router.get('/analyses', async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const [items, count] = await Promise.all([
        Analysis.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
        Analysis.countDocuments(),
      ]);
      res.render('analyses', { title: 'Análises', items, page, pages: Math.max(1, Math.ceil(count / PAGE_SIZE)), count });
    } catch (e) {
      next(e);
    }
  });

  router.post('/analyses/:id/delete', async (req, res, next) => {
    try {
      if (mongoose.isValidObjectId(req.params.id)) {
        await Analysis.deleteOne({ _id: req.params.id });
        await AuditLog.create({ admin: req.session.adminEmail, action: 'analysis.delete', detail: req.params.id });
        flash(req, 'success', 'Análise excluída.');
      }
      res.redirect('/admin/analyses');
    } catch (e) {
      next(e);
    }
  });

  // ---- Dispositivos -------------------------------------------------
  router.get('/devices', async (req, res, next) => {
    try {
      const items = await Device.find().sort({ createdAt: -1 }).limit(200).lean();
      const counts = await Analysis.aggregate([{ $group: { _id: '$device', n: { $sum: 1 } } }]);
      const byDevice = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
      res.render('devices', { title: 'Dispositivos', items, byDevice });
    } catch (e) {
      next(e);
    }
  });

  router.post('/devices/:id/delete', async (req, res, next) => {
    try {
      if (mongoose.isValidObjectId(req.params.id)) {
        await Analysis.deleteMany({ device: req.params.id });
        await Device.deleteOne({ _id: req.params.id });
        await AuditLog.create({ admin: req.session.adminEmail, action: 'device.revoke', detail: req.params.id });
        flash(req, 'success', 'Dispositivo revogado e análises excluídas.');
      }
      res.redirect('/admin/devices');
    } catch (e) {
      next(e);
    }
  });

  // ---- Conta ---------------------------------------------------------
  router.get('/account', async (req, res, next) => {
    try {
      const admins = await Admin.find().sort({ createdAt: 1 }).lean();
      res.render('account', { title: 'Conta', admins });
    } catch (e) {
      next(e);
    }
  });

  router.post('/account/password', async (req, res, next) => {
    try {
      const admin = await Admin.findOne({ email: req.session.adminEmail });
      const { current, password, confirm } = req.body;
      if (!admin || !(await bcrypt.compare(String(current || ''), admin.passwordHash))) {
        flash(req, 'error', 'Senha atual incorreta.');
      } else if (String(password || '').length < 10) {
        flash(req, 'error', 'A nova senha deve ter pelo menos 10 caracteres.');
      } else if (password !== confirm) {
        flash(req, 'error', 'A confirmação não confere.');
      } else {
        admin.passwordHash = await bcrypt.hash(String(password), 12);
        await admin.save();
        await AuditLog.create({ admin: admin.email, action: 'account.password' });
        flash(req, 'success', 'Senha alterada.');
      }
      res.redirect('/admin/account');
    } catch (e) {
      next(e);
    }
  });

  router.post('/account/admins', async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        flash(req, 'error', 'E-mail inválido.');
      } else if (password.length < 10) {
        flash(req, 'error', 'A senha deve ter pelo menos 10 caracteres.');
      } else if (await Admin.exists({ email })) {
        flash(req, 'error', 'Já existe um administrador com esse e-mail.');
      } else {
        await Admin.create({ email, passwordHash: await bcrypt.hash(password, 12) });
        await AuditLog.create({ admin: req.session.adminEmail, action: 'admin.create', detail: email });
        flash(req, 'success', `Administrador ${email} criado.`);
      }
      res.redirect('/admin/account');
    } catch (e) {
      next(e);
    }
  });

  return router;
}

module.exports = { buildAdminRouter };
