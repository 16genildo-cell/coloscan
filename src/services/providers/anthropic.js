'use strict';
const { postJson, ProviderError } = require('./index');

const URL = 'https://api.anthropic.com/v1/messages';
const TOOL_NAME = 'registrar_descricao_visual';

function headers(apiKey) {
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
}

/**
 * Com `schema`, força o uso de uma ferramenta cujo `input_schema` é o schema
 * da resposta: o modelo devolve JSON já estruturado. Sem `schema`, pede texto.
 */
async function analyzeImage({ apiKey, model, systemPrompt, instruction, imageBase64, mediaType, timeoutMs, schema }) {
  const body = {
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: instruction },
        ],
      },
    ],
  };
  if (schema) {
    body.tools = [
      { name: TOOL_NAME, description: 'Registra a descrição visual da imagem.', input_schema: schema },
    ];
    body.tool_choice = { type: 'tool', name: TOOL_NAME };
  }

  const json = await postJson(URL, { headers: headers(apiKey), timeoutMs, body });
  const toolUse = json?.content?.find((c) => c.type === 'tool_use' && c.input && typeof c.input === 'object');
  if (toolUse) return JSON.stringify(toolUse.input);
  const text = json?.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new ProviderError('bad_response', 'resposta vazia');
  return text;
}

async function testConnection({ apiKey, model, timeoutMs }) {
  await postJson(URL, {
    headers: headers(apiKey),
    timeoutMs,
    body: { model, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] },
  });
}

module.exports = { analyzeImage, testConnection };
