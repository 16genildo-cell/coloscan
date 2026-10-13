'use strict';
const { postJson, ProviderError } = require('./index');

const url = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

async function analyzeImage({ apiKey, model, systemPrompt, instruction, imageBase64, mediaType, timeoutMs }) {
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
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
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

module.exports = { analyzeImage, testConnection };
