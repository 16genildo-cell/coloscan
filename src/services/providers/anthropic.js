'use strict';
const { postJson, ProviderError } = require('./index');

const URL = 'https://api.anthropic.com/v1/messages';

function headers(apiKey) {
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
}

async function analyzeImage({ apiKey, model, systemPrompt, instruction, imageBase64, mediaType, timeoutMs }) {
  const json = await postJson(URL, {
    headers: headers(apiKey),
    timeoutMs,
    body: {
      model,
      max_tokens: 1024,
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
    },
  });
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
