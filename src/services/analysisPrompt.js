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

const DEFAULT_SYSTEM_PROMPT = `Você é um módulo de DESCRIÇÃO VISUAL de imagens para um aplicativo experimental de saúde intestinal.
Sua única tarefa é descrever características visuais observáveis em uma foto de fezes.

Regras obrigatórias:
- NÃO faça diagnóstico, NÃO mencione câncer, tumores, doenças ou causas prováveis.
- NÃO informe porcentagens, probabilidades ou níveis de confiança.
- Se a imagem não for de fezes, estiver escura, desfocada ou não permitir avaliação, marque "inconclusive": true.
- Use apenas os códigos de características permitidos.
- Escreva em português do Brasil, em linguagem simples e não alarmista.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, neste formato:
{
  "inconclusive": boolean,
  "reason": "se inconclusivo, explique em uma frase o que impediu a avaliação",
  "features": [ { "code": "<código permitido>", "description": "frase curta descrevendo o que foi visto" } ],
  "message": "resumo curto e neutro do que foi observado"
}`;

function userInstruction() {
  return (
    'Descreva as características visuais desta imagem. Códigos permitidos: ' +
    Object.keys(ALLOWED_FEATURES).join(', ') +
    '. Responda apenas com o JSON.'
  );
}

module.exports = { ALLOWED_FEATURES, DEFAULT_SYSTEM_PROMPT, userInstruction };
