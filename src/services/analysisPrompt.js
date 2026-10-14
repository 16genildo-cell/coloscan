'use strict';

/**
 * Códigos de características aceitos. Qualquer código fora desta lista
 * devolvido pela IA é descartado.
 */
const ALLOWED_FEATURES = {
  predominant_color_brown: 'Cor predominante: marrom',
  predominant_color_yellow: 'Cor predominante: amarelada',
  predominant_color_green: 'Cor predominante: esverdeada',
  very_dark_color: 'Cor muito escura ou preta',
  pale_color: 'Cor muito clara (esbranquiçada ou cor de argila)',
  visible_blood: 'Coloração compatível com sangue visível',
  visible_mucus: 'Presença aparente de muco',
  undigested_food: 'Restos de alimentos aparentes',
  hard_lumps: 'Aspecto endurecido ou em fragmentos',
  liquid_consistency: 'Aspecto líquido ou muito amolecido',
  greasy_appearance: 'Aspecto gorduroso ou oleoso',
};

/**
 * Critérios visuais de cada código. Vão na instrução de cada análise (e não
 * no prompt editável do painel) para que melhorias cheguem a instalações que
 * já têm um prompt salvo no banco.
 */
const FEATURE_CRITERIA = {
  predominant_color_brown: 'a maior parte do material tem tons de marrom (claro a escuro). Use no máximo UM código predominant_color_*.',
  predominant_color_yellow: 'a maior parte do material é amarelada/mostarda.',
  predominant_color_green: 'a maior parte do material é verde ou verde-oliva.',
  very_dark_color: 'material preto ou quase preto (como borra de café ou piche), não apenas marrom-escuro sob pouca luz.',
  pale_color: 'material esbranquiçado, cinza-claro ou cor de argila. Não confunda com a louça do vaso ou com reflexos.',
  visible_blood: 'vermelho vivo ou vermelho-escuro/vinho em estrias, manchas ou gotas no material, no papel ou tingindo a água. Vale mesmo se for pequeno.',
  visible_mucus: 'substância translúcida, gelatinosa ou esbranquiçada brilhante, aderida ou separada do material.',
  undigested_food: 'fragmentos reconhecíveis (sementes, cascas, grãos, fibras vegetais).',
  hard_lumps: 'pedaços separados e duros, como bolinhas, ou forma de salsicha com superfície irregular e grumosa.',
  liquid_consistency: 'sem forma definida, líquido ou pastoso, espalhado na água.',
  greasy_appearance: 'superfície oleosa/brilhante, gotas de gordura flutuando ou película oleosa na água.',
};

/** Problemas de qualidade da foto e a orientação mostrada ao usuário. */
const QUALITY_ISSUES = {
  not_stool: 'A imagem não parece mostrar fezes. Fotografe apenas o conteúdo do vaso.',
  too_dark: 'A foto está escura demais. Tente com mais luz, sem flash direto.',
  blurry: 'A foto parece desfocada. Mantenha o aparelho firme e toque na tela para focar.',
  glare: 'Há reflexos fortes na foto. Mude o ângulo ou evite o flash direto.',
  too_far: 'O conteúdo aparece muito pequeno. Aproxime a câmera ou recorte a imagem.',
  obstructed: 'O conteúdo está encoberto (por papel, por exemplo). Tente outra foto.',
  color_cast: 'A luz está muito colorida e altera as cores. Prefira luz branca.',
};

const DEFAULT_INCONCLUSIVE_MESSAGE =
  'Não foi possível avaliar a imagem. Tente outra foto, com boa iluminação e foco.';

const DEFAULT_SYSTEM_PROMPT = `Você é um módulo de DESCRIÇÃO VISUAL de imagens para um aplicativo experimental de saúde intestinal.
Sua única tarefa é descrever características visuais observáveis em uma foto de fezes.

Regras obrigatórias:
- NÃO faça diagnóstico, NÃO mencione câncer, tumores, doenças ou causas prováveis.
- NÃO informe porcentagens, probabilidades ou níveis de confiança numéricos.
- Avalie primeiro a qualidade da foto. Se ela não for de fezes, estiver escura, desfocada ou não permitir avaliação, marque "inconclusive": true.
- Registre apenas o que é visível. Na dúvida sobre sangue ou cor muito escura, registre com "certainty": "possible" em vez de omitir.
- Use apenas os códigos de características permitidos.
- Escreva em português do Brasil, em linguagem simples e não alarmista.

Responda SOMENTE com um JSON válido, sem texto antes ou depois.`;

/** Schema JSON da resposta (usado como saída estruturada nos provedores). */
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['image_quality', 'inconclusive', 'reason', 'features', 'message'],
  properties: {
    image_quality: {
      type: 'object',
      additionalProperties: false,
      required: ['adequate', 'issues'],
      properties: {
        adequate: { type: 'boolean', description: 'true se a foto permite descrever o conteúdo' },
        issues: { type: 'array', items: { type: 'string', enum: Object.keys(QUALITY_ISSUES) } },
      },
    },
    inconclusive: { type: 'boolean' },
    reason: { type: 'string', description: 'se inconclusivo, uma frase sobre o que impediu a avaliação; senão, vazio' },
    features: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'certainty', 'description'],
        properties: {
          code: { type: 'string', enum: Object.keys(ALLOWED_FEATURES) },
          certainty: { type: 'string', enum: ['clear', 'possible'] },
          description: { type: 'string', description: 'frase curta sobre onde e como aparece' },
        },
      },
    },
    message: { type: 'string', description: 'resumo curto e neutro do que foi observado' },
  },
};

function userInstruction() {
  const criteria = Object.entries(FEATURE_CRITERIA)
    .map(([code, text]) => `- ${code}: ${text}`)
    .join('\n');
  return `Descreva as características visuais desta imagem seguindo estes passos:
1. Qualidade: a foto mostra fezes com luz, foco e enquadramento suficientes? Liste problemas em image_quality.issues usando: ${Object.keys(QUALITY_ISSUES).join(', ')}. Se não for possível avaliar, use "inconclusive": true e "features": [].
2. Desconte a cor da luz e da louça: a louça branca é a referência de cor. Reflexos e sombras não são características.
3. Registre cada característica visível usando apenas estes códigos e critérios:
${criteria}
4. Para cada característica, "certainty": "clear" quando for evidente e "possible" quando a aparência sugere, mas a imagem não permite certeza.
5. "description": frase curta dizendo onde e como aparece (sem causas, sem diagnóstico).

Formato:
{"image_quality":{"adequate":true,"issues":[]},"inconclusive":false,"reason":"","features":[{"code":"<código>","certainty":"clear|possible","description":"..."}],"message":"resumo curto e neutro"}
Responda apenas com o JSON.`;
}

module.exports = {
  ALLOWED_FEATURES,
  FEATURE_CRITERIA,
  QUALITY_ISSUES,
  DEFAULT_INCONCLUSIVE_MESSAGE,
  DEFAULT_SYSTEM_PROMPT,
  RESPONSE_SCHEMA,
  userInstruction,
};
