'use strict';
const express = require('express');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const mongoose = require('mongoose');

const Device = require('../models/Device');
const Analysis = require('../models/Analysis');
const { deviceAuth } = require('../middleware/deviceAuth');
const { newToken, hashToken } = require('../services/crypto');
const { getSettings, resolveProviderConfig } = require('../services/settingsService');
const { detectImageType } = require('../services/imageValidation');
const { analyzeImage } = require('../services/analysisService');
const { ProviderError } = require('../services/providers');
const providerStatus = require('../services/providerStatus');

const HARD_MAX_BYTES = 15 * 1024 * 1024;

function buildApiRouter({ encryptionKey, analyze = analyzeImage }) {
  const router = express.Router();
  router.use(express.json({ limit: '20kb' }));

  const upload = multer({
    storage: multer.memoryStorage(), // a imagem fica só na memória
    limits: { fileSize: HARD_MAX_BYTES, files: 1, fields: 10 },
  });

  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { error: 'rate_limited' },
  });

  const analysisLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: async () => (await getSettings()).analysesPerDevicePerHour,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `device:${req.device.id}`,
    message: { error: 'rate_limited' },
  });

  router.get('/health', async (req, res, next) => {
    try {
      const s = await getSettings();
      const available = s.analysisEnabled && !!resolveProviderConfig(s, encryptionKey);
      res.json({ status: 'ok', analysis_available: available, consent_version: s.consentVersion });
    } catch (e) {
      next(e);
    }
  });

  router.post('/devices/register', registerLimiter, async (req, res, next) => {
    try {
      const platform = ['android', 'ios'].includes(req.body?.platform) ? req.body.platform : 'other';
      const appVersion = typeof req.body?.app_version === 'string' ? req.body.app_version.slice(0, 32) : undefined;
      const token = newToken();
      const device = await Device.create({ tokenHash: hashToken(token), platform, appVersion, lastSeenAt: new Date() });
      res.status(201).json({ device_id: device.id, token });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/devices/me', deviceAuth, async (req, res, next) => {
    try {
      await Analysis.deleteMany({ device: req.device._id });
      await Device.deleteOne({ _id: req.device._id });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/image-analysis',
    deviceAuth,
    analysisLimiter,
    (req, res, next) =>
      upload.single('image')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ error: 'invalid_upload' });
        }
        return next(err);
      }),
    async (req, res, next) => {
      try {
        const file = req.file;
        if (!file) return res.status(422).json({ error: 'image_required' });

        const consentVersion = String(req.body?.consent_version || '').trim().slice(0, 40);
        const consentAt = new Date(String(req.body?.consent_at || ''));
        if (!consentVersion || Number.isNaN(consentAt.getTime())) {
          return res.status(422).json({ error: 'consent_required' });
        }

        const settings = await getSettings();
        const providerConfig = settings.analysisEnabled ? resolveProviderConfig(settings, encryptionKey) : null;
        if (!providerConfig) return res.status(503).json({ error: 'service_unavailable' });

        const mediaType = detectImageType(file.buffer);
        if (!mediaType) return res.status(415).json({ error: 'unsupported_image' });
        if (file.size > settings.maxImageMb * 1024 * 1024) return res.status(413).json({ error: 'image_too_large' });

        let result;
        try {
          result = await analyze({ buffer: file.buffer, mediaType, providerConfig });
          providerStatus.clear();
        } catch (e) {
          if (e instanceof ProviderError) {
            providerStatus.record(e.kind, e.message);
            return res.status(e.kind === 'bad_response' ? 502 : 503).json({ error: 'service_unavailable' });
          }
          throw e;
        } finally {
          file.buffer = null; // descarta a imagem
        }

        const analysis = await Analysis.create({
          device: req.device._id,
          ...result,
          consentVersion,
          consentAt,
          expiresAt: new Date(Date.now() + settings.retentionDays * 24 * 3600 * 1000),
        });
        return res.status(200).json(analysis.toApi());
      } catch (e) {
        return next(e);
      }
    },
  );

  async function findOwned(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return null;
    }
    const a = await Analysis.findOne({ _id: req.params.id, device: req.device._id });
    if (!a) res.status(404).json({ error: 'not_found' });
    return a;
  }

  router.get('/image-analysis/:id', deviceAuth, async (req, res, next) => {
    try {
      const a = await findOwned(req, res);
      if (a) res.json(a.toApi());
    } catch (e) {
      next(e);
    }
  });

  router.delete('/image-analysis/:id', deviceAuth, async (req, res, next) => {
    try {
      const a = await findOwned(req, res);
      if (a) {
        await a.deleteOne();
        res.status(204).end();
      }
    } catch (e) {
      next(e);
    }
  });

  router.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, _next) => {
    // Nunca devolve detalhes internos nem registra o corpo da requisição.
    console.error('[api] erro:', err?.name || 'Error', err?.message ? String(err.message).slice(0, 200) : '');
    res.status(500).json({ error: 'internal_error' });
  });

  return router;
}

module.exports = { buildApiRouter };
