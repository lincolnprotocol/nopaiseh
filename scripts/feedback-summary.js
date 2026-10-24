// Prints what learners have sent: npm run feedback
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFeedback, summarize } from '../server/feedback.js';

const file =
  process.env.FEEDBACK_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'feedback.jsonl');
const entries = readFeedback(file);
if (entries.length === 0) {
  console.log(`No feedback yet (${file}).`);
} else {
  const s = summarize(entries);
  console.log(`${s.total} message(s). Average rating: ${s.averageRating ?? 'none yet'}`);
  console.log('Languages people asked for:');
  if (s.requestedLanguages.length === 0) console.log('  none yet');
  for (const { language, votes } of s.requestedLanguages) console.log(`  ${votes} x ${language}`);
  console.log('\nLatest messages:');
  for (const entry of entries.slice(-10).reverse()) {
    const when = entry.submittedAt ?? entry.at ?? 'unknown time';
    const subject = entry.language || entry.phrase || '';
    const rating = entry.rating ? ` · ${entry.rating}/5` : '';
    console.log(`  [${when}] [${entry.type}${rating}] ${subject}${subject && entry.message ? ': ' : ''}${entry.message}`);
  }
}
