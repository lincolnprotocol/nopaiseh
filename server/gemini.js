// Small, dependency-free Gemini REST client. The API key stays on the server and is never
// included in a browser response.

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export async function generateGeminiTurn({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  systemPrompt,
  userPrompt,
  timeoutMs = 8500,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('Gemini is not configured');
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid Gemini model name');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API_ROOT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 1000,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`Gemini request failed (${response.status})`);
      error.status = response.status;
      error.detail = detail.slice(0, 300);
      throw error;
    }

    const payload = await response.json();
    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) throw new Error(`Gemini returned no text (${payload.candidates?.[0]?.finishReason ?? 'unknown'})`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}
