// BiLingos API: Gemini for adaptive conversation, Amazon Polly for Mandarin voice,
// and a small feedback inbox. All integrations are optional; the app falls back to its
// authored conversation and browser voice when they are not configured.

import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { languages } from '../src/data/languages.js';
import { buildNaturalSsml, normaliseVoiceRequest } from './tts.js';
import { getScenario } from '../src/data/scenarios.js';
import { buildSystemPrompt, buildUserPrompt, extractJson, normalizeTurn } from './prompt.js';
import { DEFAULT_GEMINI_MODEL, generateGeminiTurn } from './gemini.js';
import { appendFeedback, readFeedback, summarize, validateFeedback } from './feedback.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const FEEDBACK_FILE = process.env.FEEDBACK_FILE || path.join(here, 'feedback.jsonl');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

let polly = null;
const pollyClient = () =>
  (polly ??= new PollyClient({ region: process.env.POLLY_REGION || REGION }));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

// Small per-IP rate limits so a public demo link cannot burn through AI credits or fill the disk.
function makeLimiter(maxPerMinute) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of hits) if (!times.some((t) => now - t < 60_000)) hits.delete(ip);
  }, 300_000).unref();
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= maxPerMinute) return res.status(429).json({ error: 'slow_down' });
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}
const apiLimit = makeLimiter(60);
const feedbackLimit = makeLimiter(6);

app.get('/api/health', (_req, res) => {
  res.json({
    conversation: {
      provider: 'gemini',
      configured: Boolean(GEMINI_API_KEY),
      model: GEMINI_API_KEY ? GEMINI_MODEL : null,
    },
    languages: languages.map((l) => l.id),
  });
});

app.post('/api/chat', apiLimit, async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'not_configured' });

  const { languageId = 'zh', scenarioId, history, final = false, slow = false } = req.body ?? {};
  const language = languages.find((l) => l.id === languageId);
  const scenario = language && getScenario(language.id, scenarioId);
  if (!scenario || !Array.isArray(history) || history.length === 0 || history.length > 30) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    const text = await generateGeminiTurn({
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
      systemPrompt: buildSystemPrompt(language, scenario, {
        slow: Boolean(slow),
        final: Boolean(final),
      }),
      userPrompt: buildUserPrompt(history, { final: Boolean(final) }),
    });
    res.json({ ...normalizeTurn(extractJson(text), { final: Boolean(final) }), source: 'gemini' });
  } catch (err) {
    console.error('chat failed:', err?.name, err?.message);
    res.status(502).json({ error: 'model_failed' });
  }
});

const ttsCache = new Map();

// Polly currently covers Mandarin in this app. Profile and style are allowlisted server-side;
// clients cannot choose arbitrary voices or inject SSML.
app.get('/api/tts', apiLimit, async (req, res) => {
  const langId = String(req.query.lang ?? 'zh');
  const language = languages.find((l) => l.id === langId);
  if (!language) return res.status(400).json({ error: 'bad_language' });
  if (!language.polly) return res.status(404).json({ error: 'no_voice' });

  const text = String(req.query.text ?? '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'no_text' });
  const voice = normaliseVoiceRequest({
    profile: String(req.query.profile ?? ''),
    style: String(req.query.style ?? ''),
    slow: req.query.slow === '1',
  });
  const key = `${language.id}:${voice.profile}:${voice.style}:${voice.slow ? 's' : 'n'}:${text}`;

  let audio = ttsCache.get(key);
  if (!audio) {
    try {
      const out = await pollyClient().send(
        new SynthesizeSpeechCommand({
          Engine: process.env.POLLY_ENGINE || 'neural',
          LanguageCode: 'cmn-CN',
          VoiceId: process.env.POLLY_VOICE || 'Zhiyu',
          OutputFormat: 'mp3',
          TextType: 'ssml',
          Text: buildNaturalSsml(text, voice),
        }),
      );
      audio = Buffer.from(await out.AudioStream.transformToByteArray());
      if (ttsCache.size > 500) ttsCache.clear();
      ttsCache.set(key, audio);
    } catch (err) {
      console.error('tts failed:', err?.name, err?.message);
      return res.status(502).json({ error: 'tts_failed' });
    }
  }
  res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
  res.send(audio);
});

// Learners send feedback and language suggestions here. Stored in a local file.
app.post('/api/feedback', feedbackLimit, (req, res) => {
  const { entry, error } = validateFeedback(req.body);
  if (error) return res.status(400).json({ error });
  try {
    appendFeedback(FEEDBACK_FILE, entry);
    res.json({ ok: true });
  } catch (err) {
    console.error('feedback save failed:', err?.message);
    res.status(500).json({ error: 'save_failed' });
  }
});

// Organisers read feedback with an Authorization: Bearer ADMIN_KEY header. Off unless ADMIN_KEY is set.
const sameKey = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest(),
  );

app.get('/api/feedback', (req, res) => {
  const authorization = req.get('authorization') ?? '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  if (!ADMIN_KEY || !sameKey(token, ADMIN_KEY)) return res.status(404).json({ error: 'not_found' });
  const entries = readFeedback(FEEDBACK_FILE);
  res.json({ summary: summarize(entries), entries });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// In production, serve the built React app from the same server.
const dist = path.join(here, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`BiLingos API on http://localhost:${PORT}`);
  console.log(
    GEMINI_API_KEY
      ? `Gemini: on (${GEMINI_MODEL})`
      : 'Gemini: off. Set GEMINI_API_KEY in .env. The app will use scripted demo replies.',
  );
  console.log(`Feedback file: ${FEEDBACK_FILE}${ADMIN_KEY ? ' (admin view on)' : ''}`);
});
