'use strict';
const {
  ALLOWED_FEATURES,
  QUALITY_ISSUES,
  DEFAULT_INCONCLUSIVE_MESSAGE,
  RESPONSE_SCHEMA,
  userInstruction,
} = require('./analysisPrompt');
const { sanitize } = require('./safeLanguage');
const { getProvider, ProviderError } = require('./providers');

const LIMITATIONS = [
  'Descrição gerada por inteligência artificial de uso geral, sem validação clínica.',
  'Luz, câmera, água e louça do vaso alteram a aparência da foto.',
  'Alimentos, corantes, suplementos e medicamentos podem mudar a cor e o aspecto das fezes.',
  'Não detecta sangue oculto (invisível a olho nu) e não substitui exames.',
];

const DEFAULT_DESCRIPTIONS = {
  visible_blood:
    'A cor vermelha também pode vir de alimentos (como beterraba) ou corantes. Procure avaliação médica.',
  very_dark_color:
    'Pode ocorrer com suplementos de ferro ou medicamentos, mas também pode indicar sangramento. Procure avaliação médica, principalmente se persistir.',
  pale_color: 'Se persistir ou vier com pele ou olhos amarelados, procure avaliação médica.',
};

/** Características que pedem atenção aparecem primeiro no resultado. */
const PRIORITY = ['visible_blood', 'very_dark_color', 'pale_color', 'visible_mucus'];

/** Grupos mutuamente exclusivos: só um código de cada grupo é mantido. */
const EXCLUSIVE_GROUPS = [
  ['predominant_color_brown', 'predominant_color_yellow', 'predominant_color_green'],
  ['hard_lumps', 'liquid_consistency'],
];

const POSSIBLE_SUFFIX = 'A imagem sugere essa característica, mas não permite certeza.';

const MAX_ATTEMPTS = 2;
const MIN_RETRY_BUDGET_MS = 10_000;

/** Provedor/modelo que recusou a saída estruturada (memória do processo). */
const schemaUnsupported = new Set();

/** Extrai o primeiro objeto JSON do texto devolvido pela IA. */
function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ProviderError('bad_response', 'resposta sem JSON');
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new ProviderError('bad_response', 'JSON inválido');
  }
}

function qualityIssues(raw) {
  const issues = raw?.image_quality?.issues;
  if (!Array.isArray(issues)) return [];
  return [...new Set(issues.filter((i) => typeof i === 'string' && QUALITY_ISSUES[i]))];
}

function inconclusiveResult(message, modelVersion) {
  return {
    status: 'inconclusive',
    inconclusive: true,
    features: [],
    message,
    limitations: LIMITATIONS,
    modelVersion,
  };
}

/** Valida e normaliza a resposta da IA para o contrato do app. */
function normalize(raw, modelVersion) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProviderError('bad_response', 'formato inesperado');
  }

  const issues = qualityIssues(raw);
  const qualityInadequate = raw.image_quality?.adequate === false || issues.includes('not_stool');

  if (raw.inconclusive === true || qualityInadequate) {
    // Orientação padronizada para o problema de qualidade, quando informado;
    // senão, o motivo escrito pela IA (filtrado).
    const guidance = issues.map((i) => QUALITY_ISSUES[i]).slice(0, 2).join(' ');
    const message =
      guidance ||
      sanitize(String(raw.reason || raw.message || '').slice(0, 300), DEFAULT_INCONCLUSIVE_MESSAGE) ||
      DEFAULT_INCONCLUSIVE_MESSAGE;
    return inconclusiveResult(message, modelVersion);
  }

  // Coleta, remove duplicados e códigos desconhecidos.
  const byCode = new Map();
  for (const f of Array.isArray(raw.features) ? raw.features : []) {
    const code = typeof f?.code === 'string' ? f.code.trim() : '';
    if (!ALLOWED_FEATURES[code] || byCode.has(code)) continue;
    byCode.set(code, {
      code,
      possible: f.certainty === 'possible',
      text: typeof f.description === 'string' ? f.description.slice(0, 300) : '',
    });
  }

  // Grupos exclusivos: prefere o código "claro"; empate = o primeiro citado.
  for (const group of EXCLUSIVE_GROUPS) {
    const present = group.filter((c) => byCode.has(c));
    if (present.length < 2) continue;
    const keep = present.find((c) => !byCode.get(c).possible) || present[0];
    for (const c of present) if (c !== keep) byCode.delete(c);
  }

  const ordered = [...byCode.values()].sort((a, b) => {
    const pa = PRIORITY.indexOf(a.code);
    const pb = PRIORITY.indexOf(b.code);
    return (pa < 0 ? PRIORITY.length : pa) - (pb < 0 ? PRIORITY.length : pb);
  });

  const features = ordered.slice(0, 8).map(({ code, possible, text }) => {
    let description = sanitize(text, '') || DEFAULT_DESCRIPTIONS[code] || '';
    // Sinais de atenção sempre trazem a orientação padrão.
    if (DEFAULT_DESCRIPTIONS[code] && description !== DEFAULT_DESCRIPTIONS[code]) {
      description = `${description} ${DEFAULT_DESCRIPTIONS[code]}`.trim();
    }
    if (possible) description = `${description} ${POSSIBLE_SUFFIX}`.trim();
    return { code, label: ALLOWED_FEATURES[code], description: description.slice(0, 600) };
  });

  const limitations = [...LIMITATIONS];
  const minorIssues = issues.map((i) => QUALITY_ISSUES[i]);
  if (minorIssues.length) limitations.unshift(`Qualidade da foto: ${minorIssues.join(' ')}`);

  return {
    status: 'completed',
    inconclusive: false,
    features,
    message:
      sanitize(typeof raw.message === 'string' ? raw.message.slice(0, 500) : '') ||
      'Descrição visual gerada. Ela não constitui diagnóstico.',
    limitations,
    modelVersion,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Executa a análise com o provedor configurado. A imagem não é salva.
 *
 * - Pede saída estruturada (schema JSON); se o modelo recusar, repete sem
 *   schema e lembra disso para as próximas análises.
 * - Uma nova tentativa em resposta inválida, limite de uso ou falha
 *   temporária, respeitando o tempo total configurado no painel.
 */
async function analyzeImage({ buffer, mediaType, providerConfig }, { retryDelayMs = 1500 } = {}) {
  const provider = getProvider(providerConfig.provider);
  const modelVersion = `${providerConfig.provider}:${providerConfig.model}`;
  const schemaKey = modelVersion;
  const deadline = Date.now() + providerConfig.timeoutMs;
  const base = {
    apiKey: providerConfig.apiKey,
    model: providerConfig.model,
    systemPrompt: providerConfig.systemPrompt,
    instruction: userInstruction(),
    imageBase64: buffer.toString('base64'),
    mediaType,
  };

  let attempt = 0;
  for (;;) {
    attempt++;
    const useSchema = !schemaUnsupported.has(schemaKey);
    const remaining = Math.max(1000, deadline - Date.now());
    try {
      const text = await provider.analyzeImage({
        ...base,
        timeoutMs: remaining,
        schema: useSchema ? RESPONSE_SCHEMA : undefined,
      });
      return normalize(extractJson(text), modelVersion);
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;

      // Modelo sem suporte a saída estruturada: repete sem schema (não conta tentativa).
      if (e.kind === 'config' && useSchema) {
        schemaUnsupported.add(schemaKey);
        attempt--;
        continue;
      }

      const retriable =
        e.kind === 'bad_response' || e.kind === 'rate' || (e.kind === 'unavailable' && !e.timedOut);
      const budgetLeft = deadline - Date.now() - retryDelayMs;
      if (retriable && attempt < MAX_ATTEMPTS && budgetLeft >= MIN_RETRY_BUDGET_MS) {
        await sleep(retryDelayMs);
        continue;
      }
      throw e;
    }
  }
}

function _resetSchemaSupport() {
  schemaUnsupported.clear();
}

module.exports = { analyzeImage, normalize, extractJson, LIMITATIONS, _resetSchemaSupport };
