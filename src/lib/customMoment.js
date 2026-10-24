import { looksLikeTarget } from '../data/languages.js';
import { MAX_TILES, MIN_TILES, tokenize } from './tiles.js';

export const MAX_CUSTOM_MOMENTS = 8;
export const CUSTOM_MOMENT_STEPS = 5;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const VOICE_PROFILES = new Set(['coach', 'elder', 'friend', 'stall', 'colleague']);
const INSTRUCTION_TEXT =
  /(ignore|disregard|override).{0,30}(instructions|rules|prompt)|system\s+(prompt|message)|developer\s+message|act\s+as\s+(an?\s+)?(assistant|system)/i;
const BLOCKED_OUTPUT =
  /\b(explicit sexual|sexual roleplay|make (a )?bomb|build (a )?bomb|suicide instructions|kill yourself)\b/i;

const clean = (value, max) =>
  typeof value === 'string'
    ? value.normalize('NFKC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const required = (value, max, label) => {
  const result = clean(value, max);
  if (!result) throw new Error(`${label} is missing`);
  if (INSTRUCTION_TEXT.test(result) || BLOCKED_OUTPUT.test(result)) {
    throw new Error(`${label} contains unsupported instructions or content`);
  }
  return result;
};

function targetScriptCount(languageId, text) {
  const pattern = languageId === 'zh' ? /[一-鿿]/gu : languageId === 'ta' ? /[஀-௿]/gu : null;
  return pattern ? (text.match(pattern) ?? []).length : 0;
}

function requireTargetLanguage(language, text, label) {
  if (language.id === 'ms') {
    if (!looksLikeTarget('ms', text)) throw new Error(`${label}.text is mostly English`);
    return;
  }
  const target = targetScriptCount(language.id, text);
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  if (target < 2 || target / Math.max(1, target + latin) < 0.55) {
    throw new Error(`${label}.text is not mainly written in ${language.name}`);
  }
}

function requireEnglishMetadata(language, value, label) {
  if (!/[a-z]/i.test(value) || (language.scriptRe && targetScriptCount(language.id, value) > 0)) {
    throw new Error(`${label} must be in English`);
  }
  return value;
}

function fallbackChineseTokens(text) {
  const chars = [...text.replace(/[\p{P}\p{S}\s]/gu, '')];
  return Math.ceil(chars.length / 2);
}

function normalizePhrase(language, raw, label, { buildable = false } = {}) {
  const text = required(raw?.text, 120, `${label}.text`);
  const english = requireEnglishMetadata(
    language,
    required(raw?.english, 160, `${label}.english`),
    `${label}.english`,
  );
  const roman = language.romanName ? required(raw?.roman, 180, `${label}.roman`) : '';
  if (language.romanName && (targetScriptCount(language.id, roman) > 0 || !/[a-z]/i.test(roman))) {
    throw new Error(`${label}.roman must use readable Latin letters`);
  }

  requireTargetLanguage(language, text, label);
  if (buildable) {
    const counts = [tokenize(language.id, text).length];
    if (language.id === 'zh') counts.push(fallbackChineseTokens(text));
    if (counts.some((count) => count < MIN_TILES || count > MAX_TILES)) {
      throw new Error(`${label}.text must fit ${MIN_TILES}-${MAX_TILES} word tiles`);
    }
  }
  return { text, roman, english };
}

export function normalizeCustomScenario(language, raw, { id = raw?.id } = {}) {
  if (!language || !raw || typeof raw !== 'object') throw new Error('Moment data is missing');
  const safeId = clean(id, 90);
  if (!/^custom:[a-z0-9-]{8,80}$/i.test(safeId)) throw new Error('Moment ID is invalid');
  if (!Array.isArray(raw.script) || raw.script.length !== CUSTOM_MOMENT_STEPS) {
    throw new Error(`Moment needs exactly ${CUSTOM_MOMENT_STEPS} conversation steps`);
  }

  const suggestionTexts = new Set();
  const suggestionMeanings = new Set();
  const script = raw.script.map((step, index) => {
    const final = index === CUSTOM_MOMENT_STEPS - 1;
    const suggestions = Array.isArray(step?.suggestions) ? step.suggestions : [];
    if (suggestions.length !== (final ? 0 : 2)) {
      throw new Error(`Step ${index + 1} has the wrong number of replies`);
    }
    const normalizedSuggestions = suggestions.map((phrase, phraseIndex) => {
      const normalized = normalizePhrase(language, phrase, `Step ${index + 1} reply ${phraseIndex + 1}`, {
        buildable: true,
      });
      const meaning = normalized.english.toLocaleLowerCase('en');
      if (suggestionTexts.has(normalized.text) || suggestionMeanings.has(meaning)) {
        throw new Error('Every suggested reply must be unique');
      }
      suggestionTexts.add(normalized.text);
      suggestionMeanings.add(meaning);
      return normalized;
    });

    const learned = Array.isArray(step?.learned) ? step.learned : [];
    if (learned.length < 1 || learned.length > 2) {
      throw new Error(`Step ${index + 1} needs one or two useful phrases`);
    }
    return {
      ai: normalizePhrase(language, step?.ai, `Step ${index + 1} partner line`),
      suggestions: normalizedSuggestions,
      learned: learned.map((phrase, phraseIndex) =>
        normalizePhrase(language, phrase, `Step ${index + 1} useful phrase ${phraseIndex + 1}`),
      ),
    };
  });

  const name = required(raw.persona?.name, 50, 'Character name');
  const native = required(raw.persona?.native, 50, 'Character name in the learning language');
  requireTargetLanguage(language, native, 'Character name');
  const role = requireEnglishMetadata(
    language,
    required(raw.persona?.role, 80, 'Character role'),
    'Character role',
  );
  const voiceProfile = VOICE_PROFILES.has(raw.voiceProfile) ? raw.voiceProfile : 'coach';

  return {
    id: safeId,
    custom: true,
    tone: 'sky',
    glyph: '✦',
    title: requireEnglishMetadata(language, required(raw.title, 70, 'Moment title'), 'Moment title'),
    blurb: requireEnglishMetadata(
      language,
      required(raw.blurb, 140, 'Moment description'),
      'Moment description',
    ),
    doneLine: requireEnglishMetadata(
      language,
      required(raw.doneLine, 140, 'Completion message'),
      'Completion message',
    ),
    tip: requireEnglishMetadata(language, required(raw.tip, 220, 'Language tip'), 'Language tip'),
    minutes: 3,
    voiceProfile,
    persona: {
      name,
      native,
      initial: [...native][0] ?? [...name][0] ?? '✦',
      role,
    },
    setting: requireEnglishMetadata(
      language,
      required(raw.setting, 300, 'Moment setting'),
      'Moment setting',
    ),
    script,
  };
}

function decodeScenarioRef(ref) {
  if (typeof ref !== 'string' || ref.length > 30_000) throw new Error('Moment verification is invalid');
  const [body, signature, extra] = ref.split('.');
  if (!body || !signature || extra) throw new Error('Moment verification is invalid');
  const base64 = body.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function normalizeCustomMomentRecord(language, raw) {
  const scenarioRef = clean(raw?.scenarioRef, 30_000);
  if (!scenarioRef) throw new Error('Moment verification is missing');
  const payload = decodeScenarioRef(scenarioRef);
  if (payload?.v !== 1 || payload?.languageId !== language.id) {
    throw new Error('Moment verification has the wrong language');
  }
  const canonicalScenario = normalizeCustomScenario(language, payload.scenario);
  const displayedScenario = normalizeCustomScenario(language, raw?.scenario);
  if (JSON.stringify(canonicalScenario) !== JSON.stringify(displayedScenario)) {
    throw new Error('Saved moment does not match its verification');
  }
  const createdAt = Number(raw?.createdAt);
  return {
    scenario: canonicalScenario,
    scenarioRef,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

export function normalizeCustomMomentCollection(language, raw) {
  const records = [];
  const values = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  for (const value of values) {
    try {
      records.push(normalizeCustomMomentRecord(language, value));
    } catch {
      // Imported or old malformed moments are ignored rather than crashing the app.
    }
  }
  return Object.fromEntries(
    records
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_CUSTOM_MOMENTS)
      .map((record) => [record.scenario.id, record]),
  );
}
