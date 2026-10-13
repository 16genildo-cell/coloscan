'use strict';
const { ALLOWED_FEATURES, userInstruction } = require('./analysisPrompt');
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

/** Valida e normaliza a resposta da IA para o contrato do app. */
function normalize(raw, modelVersion) {
  if (!raw || typeof raw !== 'object') throw new ProviderError('bad_response', 'formato inesperado');
  const inconclusive = raw.inconclusive === true;

  if (inconclusive) {
    return {
      status: 'inconclusive',
      inconclusive: true,
      features: [],
      message: sanitize(
        raw.reason || raw.message,
        'Não foi possível avaliar a imagem. Tente outra foto, com boa iluminação e foco.',
      ) || 'Não foi possível avaliar a imagem. Tente outra foto, com boa iluminação e foco.',
      limitations: LIMITATIONS,
      modelVersion,
    };
  }

  const seen = new Set();
  const features = [];
  for (const f of Array.isArray(raw.features) ? raw.features : []) {
    const code = typeof f?.code === 'string' ? f.code.trim() : '';
    if (!ALLOWED_FEATURES[code] || seen.has(code)) continue;
    seen.add(code);
    const description =
      sanitize(typeof f.description === 'string' ? f.description.slice(0, 300) : '', '') ||
      DEFAULT_DESCRIPTIONS[code] ||
      '';
    features.push({ code, label: ALLOWED_FEATURES[code], description });
    if (features.length >= 8) break;
  }

  return {
    status: 'completed',
    inconclusive: false,
    features,
    message: sanitize(typeof raw.message === 'string' ? raw.message.slice(0, 500) : '') ||
      'Descrição visual gerada. Ela não constitui diagnóstico.',
    limitations: LIMITATIONS,
    modelVersion,
  };
}

/** Executa a análise com o provedor configurado. A imagem não é salva. */
async function analyzeImage({ buffer, mediaType, providerConfig }) {
  const provider = getProvider(providerConfig.provider);
  const text = await provider.analyzeImage({
    apiKey: providerConfig.apiKey,
    model: providerConfig.model,
    systemPrompt: providerConfig.systemPrompt,
    instruction: userInstruction(),
    imageBase64: buffer.toString('base64'),
    mediaType,
    timeoutMs: providerConfig.timeoutMs,
  });
  return normalize(extractJson(text), `${providerConfig.provider}:${providerConfig.model}`);
}

module.exports = { analyzeImage, normalize, extractJson, LIMITATIONS };
