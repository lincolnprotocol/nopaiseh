// Calls to the Node server. Any failure (server down, no AI config, slow reply, bad JSON)
// throws, and the caller falls back to the scripted demo or saves retryable feedback for later.

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', retryable = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function post(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(`${url} failed: ${res.status}`, {
        status: res.status,
        code: data?.error ?? '',
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Asks the server (which calls Gemini) for the next conversation turn.
export async function fetchTurn(payload, { timeoutMs = 14_000 } = {}) {
  const data = await post('/api/chat', payload, timeoutMs);
  if (!data?.ai?.text) throw new Error('chat reply had the wrong shape');
  return data;
}

export async function postFeedback(entry) {
  const data = await post('/api/feedback', entry, 6000);
  if (!data?.ok) throw new Error('feedback not accepted');
}

export async function generateMoment(payload, { timeoutMs = 55_000 } = {}) {
  const data = await post('/api/moments', payload, timeoutMs);
  if (!data?.scenario?.id || !data?.scenarioRef) {
    throw new Error('generated moment had the wrong shape');
  }
  return data;
}
