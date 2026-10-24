// Small, dependency-free Gemini REST client. The API key stays on the server and is never
// included in a browser response.

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_NAME = /^[a-zA-Z0-9._-]+$/;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryableStatus = (status) => status === 429 || [500, 502, 503, 504].includes(status);
const fallbackStatus = (status) => !status || status === 404 || retryableStatus(status);

export async function generateGeminiTurn({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  fallbackModels = [],
  systemPrompt,
  userPrompt,
  timeoutMs = 8500,
  maxOutputTokens = 1000,
  temperature = 0.6,
  retries = 1,
  retryBaseMs = 450,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('Gemini is not configured');
  const models = [...new Set([model, ...fallbackModels].filter(Boolean))];
  if (models.length === 0 || models.some((name) => !MODEL_NAME.test(name))) {
    throw new Error('Invalid Gemini model name');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let lastError;
  try {
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const modelName = models[modelIndex];
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const response = await fetchImpl(`${API_ROOT}/${encodeURIComponent(modelName)}:generateContent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
              generationConfig: {
                temperature,
                maxOutputTokens,
                responseMimeType: 'application/json',
              },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            const error = new Error(`Gemini request failed (${response.status})`);
            error.status = response.status;
            error.detail = detail.slice(0, 500);
            error.model = modelName;
            throw error;
          }

          const payload = await response.json();
          const text = (payload.candidates?.[0]?.content?.parts ?? [])
            .map((part) => part.text ?? '')
            .join('')
            .trim();
          if (!text) {
            const error = new Error(
              `Gemini returned no text (${payload.candidates?.[0]?.finishReason ?? 'unknown'})`,
            );
            error.model = modelName;
            throw error;
          }
          return text;
        } catch (error) {
          lastError = error;
          if (error?.name === 'AbortError') throw error;
          if (attempt < retries && (!error?.status || retryableStatus(error.status))) {
            const jitter = Math.round(Math.random() * 180);
            await wait(retryBaseMs * 2 ** attempt + jitter);
            continue;
          }
          break;
        }
      }

      if (modelIndex < models.length - 1 && fallbackStatus(lastError?.status)) continue;
      throw lastError;
    }
    throw lastError ?? new Error('Gemini request failed');
  } finally {
    clearTimeout(timer);
  }
}
