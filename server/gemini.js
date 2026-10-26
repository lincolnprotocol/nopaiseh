// Small, dependency-free Gemini REST client. The API key stays on the server and is never
// included in a browser response.

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_NAME = /^[a-zA-Z0-9._-]+$/;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryableStatus = (status) => status === 429 || [500, 502, 503, 504].includes(status);
const fallbackStatus = (status) => !status || status === 404 || retryableStatus(status);

function timeoutError(model) {
  const error = new Error(`Gemini model timed out (${model})`);
  error.name = 'GeminiTimeoutError';
  error.model = model;
  error.timeout = true;
  return error;
}

export async function generateGeminiTurn({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  fallbackModels = [],
  systemPrompt,
  userPrompt,
  timeoutMs = 8500,
  attemptTimeoutMs = 5500,
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

  const deadline = Date.now() + timeoutMs;
  let lastError;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const modelName = models[modelIndex];
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw lastError ?? timeoutError(modelName);

      const controller = new AbortController();
      const attemptTimer = setTimeout(
        () => controller.abort(),
        Math.max(1, Math.min(attemptTimeoutMs, remainingMs)),
      );
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
      } catch (caught) {
        const error = caught?.name === 'AbortError' ? timeoutError(modelName) : caught;
        lastError = error;

        // A timeout moves directly to the next model. Retrying the same stalled model would consume
        // the whole request budget and was the cause of repeated AbortError failures.
        if (error.timeout) break;
        if (attempt < retries && (!error?.status || retryableStatus(error.status))) {
          const delay = retryBaseMs * 2 ** attempt + Math.round(Math.random() * 180);
          if (Date.now() + delay < deadline) {
            await wait(delay);
            continue;
          }
        }
        break;
      } finally {
        clearTimeout(attemptTimer);
      }
    }

    if (modelIndex < models.length - 1 && fallbackStatus(lastError?.status)) continue;
    throw lastError;
  }

  throw lastError ?? new Error('Gemini request failed');
}
