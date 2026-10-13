'use strict';
const { postJson, ProviderError } = require('./index');

const URL = 'https://api.openai.com/v1/chat/completions';

async function analyzeImage({ apiKey, model, systemPrompt, instruction, imageBase64, mediaType, timeoutMs }) {
  const json = await postJson(URL, {
    headers: { authorization: `Bearer ${apiKey}` },
    timeoutMs,
    body: {
      model,
      max_completion_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          ],
        },
      ],
    },
  });
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError('bad_response', 'resposta vazia');
  return text;
}

async function testConnection({ apiKey, model, timeoutMs }) {
  await postJson(URL, {
    headers: { authorization: `Bearer ${apiKey}` },
    timeoutMs,
    body: { model, max_completion_tokens: 5, messages: [{ role: 'user', content: 'ping' }] },
  });
}

module.exports = { analyzeImage, testConnection };
