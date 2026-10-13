'use strict';

/**
 * Mesma barreira do app (lib/features/image_analysis/domain/safe_language.dart):
 * bloqueia diagnóstico, confirmação/exclusão de câncer e porcentagens.
 */
const FORBIDDEN = [
  /c[aâ]ncer\s+confirmado/i,
  /voc[eê]\s+(tem|possui|est[aá]\s+com)\s+c[aâ]ncer/i,
  /livre\s+de\s+c[aâ]ncer/i,
  /sem\s+c[aâ]ncer/i,
  /diagn[oó]stico\s+(de|confirmado|positivo|negativo)/i,
  /\b\d{1,3}([.,]\d+)?\s*%/,
  /cancer\s+(confirmed|detected|free)/i,
  /\b(tumor|tumour|malign)/i,
];

const NEUTRAL_MESSAGE =
  'O sistema registrou as características visuais listadas abaixo. Elas não constituem ' +
  'diagnóstico. Em caso de dúvida ou sintomas, procure um profissional de saúde.';

function containsDiagnosticClaim(text) {
  return FORBIDDEN.some((r) => r.test(String(text || '')));
}

function sanitize(text, fallback = NEUTRAL_MESSAGE) {
  const t = String(text || '').trim();
  return containsDiagnosticClaim(t) ? fallback : t;
}

module.exports = { containsDiagnosticClaim, sanitize, NEUTRAL_MESSAGE };
