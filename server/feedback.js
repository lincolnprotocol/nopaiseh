// Feedback storage: one JSON object per line in a local file. No database needed.
// Kept free of Express and provider code so it can be tested on its own.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// 'correction' lets a native speaker flag a wrong or unnatural line from inside the app. The
// scenario data ships with a "not yet proof-read" caveat, so the fastest route to accurate content
// is letting the people who speak it tell us, in one tap, exactly which line is off.
const TYPES = ['language', 'feature', 'bug', 'correction', 'other'];

// Strips control characters, trims and caps the length.
const clip = (v, max) =>
  typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';

const isoDate = (value) => {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

// Returns { entry } or { error }.
export function validateFeedback(body) {
  if (!body || typeof body !== 'object') return { error: 'bad_body' };
  const type = TYPES.includes(body.type) ? body.type : null;
  if (!type) return { error: 'bad_type' };

  const message = clip(body.message, 600);
  const language = clip(body.language, 40);
  const phrase = clip(body.phrase, 200);
  if (type === 'language' && !language) return { error: 'no_language' };
  if (type === 'correction' && !phrase) return { error: 'no_phrase' };
  if (!message && !language && !phrase) return { error: 'empty' };

  const rating = Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null;
  const receivedAt = new Date().toISOString();
  return {
    entry: {
      id: clip(body.id, 80) || randomUUID(),
      type,
      language,
      message,
      phrase,
      contact: clip(body.contact, 100),
      rating,
      appLanguage: clip(body.appLanguage, 10),
      submittedAt: isoDate(body.submittedAt ?? body.at) ?? receivedAt,
      receivedAt,
      // Retained for old reporting tools and existing exported data.
      at: receivedAt,
    },
  };
}

export function appendFeedback(file, entry) {
  // A client may retry after the server stored an item but its response was lost. The stable ID
  // makes those retries idempotent instead of adding duplicate feedback rows.
  if (entry?.id && readFeedback(file).some((saved) => saved.id === entry.id)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  return true;
}

export function readFeedback(file, limit = 500) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip a damaged line
    }
  }
  return out.slice(-limit);
}

export function summarize(entries) {
  const languages = {};
  const types = {};
  let ratingSum = 0;
  let ratingCount = 0;
  for (const e of entries) {
    types[e.type] = (types[e.type] ?? 0) + 1;
    if (e.type === 'language' && e.language) {
      const key = e.language.toLowerCase();
      languages[key] = (languages[key] ?? 0) + 1;
    }
    if (e.rating) {
      ratingSum += e.rating;
      ratingCount += 1;
    }
  }
  const requestedLanguages = Object.entries(languages)
    .map(([language, votes]) => ({ language, votes }))
    .sort((a, b) => b.votes - a.votes);
  return {
    total: entries.length,
    types,
    requestedLanguages,
    averageRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
  };
}
