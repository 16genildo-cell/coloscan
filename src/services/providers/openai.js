'use strict';
const { postJson, ProviderError } = require('./index');

const URL = 'https://api.openai.com/v1/chat/completions';

/** Com `schema`, usa Structured Outputs (json_schema estrito); senão, json_object. */
async function analyzeImage({ apiKey, model, systemPrompt, instruction, imageBase64, mediaType, timeoutMs, schema }) {
  const json = await postJson(URL, {
    headers: { authorization: `Bearer ${apiKey}` },
    timeoutMs,
    body: {
      model,
      max_completion_tokens: 1500,
      response_format: schema
        ? { type: 'json_schema', json_schema: { name: 'descricao_visual', strict: true, schema } }
        : { type: 'json_object' },
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
  const message = json?.choices?.[0]?.message;
  if (message?.refusal) throw new ProviderError('bad_response', 'o modelo recusou a solicitação');
  const text = message?.content;
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
