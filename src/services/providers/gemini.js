'use strict';
const { postJson, ProviderError } = require('./index');

const url = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/**
 * Converte o JSON Schema para o subconjunto OpenAPI aceito em `responseSchema`
 * (tipos em maiúsculas, sem `additionalProperties`).
 */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    } else if (k === 'items') out.items = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

async function analyzeImage({ apiKey, model, systemPrompt, instruction, imageBase64, mediaType, timeoutMs, schema }) {
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 1500 };
  if (schema) generationConfig.responseSchema = toGeminiSchema(schema);
  const json = await postJson(url(model), {
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs,
    body: {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: 'user',
          parts: [{ inline_data: { mime_type: mediaType, data: imageBase64 } }, { text: instruction }],
        },
      ],
      generationConfig,
    },
  });
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new ProviderError('bad_response', 'resposta vazia');
  return text;
}

async function testConnection({ apiKey, model, timeoutMs }) {
  await postJson(url(model), {
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs,
    body: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 5 } },
  });
}

module.exports = { analyzeImage, testConnection, toGeminiSchema };
