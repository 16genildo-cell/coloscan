'use strict';
const Analysis = require('../models/Analysis');

/** Apaga resultados cuja data de retenção já passou. */
async function purgeExpired(now = new Date()) {
  const { deletedCount } = await Analysis.deleteMany({ expiresAt: { $lte: now } });
  return deletedCount || 0;
}

function startRetentionJob(intervalMs = 60 * 60 * 1000) {
  const run = () =>
    purgeExpired()
      .then((n) => n && console.log(`[retenção] ${n} resultado(s) expirado(s) apagado(s).`))
      .catch((e) => console.error('[retenção] falha:', e.message));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { purgeExpired, startRetentionJob };
