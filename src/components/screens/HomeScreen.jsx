import { useState } from 'react';
import { languages } from '../../data/languages.js';
import { scenariosFor } from '../../data/scenarios.js';
import {
  allPhrases,
  duePhrases,
  langState,
} from '../../lib/storage.js';
import { Book, Forward, Sparkles } from '../Icons.jsx';

const MOMENT_EXAMPLES = [
  'Ask my dad for allowance',
  'Explain why I came home late',
  'Invite my cousin out for lunch',
];
const AUTO_RETRY_CODES = new Set(['provider_busy', 'generation_failed']);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Home is organised around places the learner can use their mother tongue, not around a score.
// Points and milestones still exist for learners who enjoy them, but they live in Progress rather
// than defining the first screen everybody sees.
export default function HomeScreen({
  progress,
  language,
  live,
  customMoments = [],
  t,
  onRoute,
  onStart,
  onCreateMoment,
  onLanguage,
}) {
  const [momentRequest, setMomentRequest] = useState('');
  const [makingMoment, setMakingMoment] = useState(false);
  const [momentError, setMomentError] = useState('');
  const state = langState(progress, language.id);
  const phrases = allPhrases(progress, language.id);
  const due = duePhrases(progress, language.id);
  const scenarios = scenariosFor(language.id);
  const nextScenario = scenarios.find((s) => !state.lessons?.[s.id]) ?? scenarios[0];
  const warmed = [...scenarios, ...customMoments.map((record) => record.scenario)].filter(
    (scenario) => state.lessons?.[scenario.id],
  ).length;
  const outsidePhrase =
    phrases[0] ??
    {
      zh: { text: '最近怎么样？', english: 'How have you been lately?' },
      ms: { text: 'Dah makan?', english: 'Have you eaten?' },
      ta: { text: 'சாப்பிட்டியா?', english: 'Have you eaten?' },
    }[language.id];

  async function makeMoment(event) {
    event.preventDefault();
    const request = momentRequest.trim();
    if (request.length < 6) {
      setMomentError('Describe the moment in a little more detail.');
      return;
    }
    setMakingMoment(true);
    setMomentError('');
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await onCreateMoment(request);
          setMomentRequest('');
          return;
        } catch (error) {
          if (attempt === 0 && (!error?.code || AUTO_RETRY_CODES.has(error.code))) {
            setMomentError('Gemini needs a little longer. Trying again automatically…');
            await wait(4500);
            continue;
          }

          const messages = {
            not_configured: 'Custom moments are taking a break. Ready-made and saved moments still work.',
            slow_down: 'Your request is still here. Give it a minute, then tap the button again.',
            request_too_short: 'Add a little more detail about the conversation you want.',
            request_too_long: 'Shorten the request to 240 characters, then try again.',
            generation_invalid: 'That moment is not ready yet. Rewording the situation may help.',
            generation_failed: 'That moment is not ready yet. Your request is still here, so you can try again.',
            provider_busy: 'That moment is not ready yet. Your request is still here—try again in a minute.',
            provider_limit: 'Custom moments are resting for now. Ready-made and saved moments still work.',
            provider_auth: 'Custom moments are temporarily unavailable. Ready-made and saved moments still work.',
            model_unavailable: 'Custom moments are temporarily unavailable. Ready-made and saved moments still work.',
            storage_failed: 'This browser could not keep the new moment. Free some browser storage and try again.',
          };
          setMomentError(
            messages[error?.code] ??
              'That moment is not ready yet. Your request is still here, so you can try again.',
          );
          return;
        }
      }
    } finally {
      setMakingMoment(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head home-intro">
        <span className="eyebrow">Languages have never been easier.</span>
        <h1 className="page-title">
          Your mother tongue, <span className="hl">No Paiseh.</span>
        </h1>
        <p className="page-sub">
          Hawker stalls, family dinners, group chats and first days at work. Learn the words, hear the
          rhythm, then use {language.name} without the paiseh.
        </p>
      </header>

      <div className="langs mobile-only" role="group" aria-label="Choose a language">
        {languages.map((l) => (
          <button
            key={l.id}
            className={`lang ${l.id === language.id ? 'on' : ''}`}
            aria-pressed={l.id === language.id}
            onClick={() => onLanguage(l.id)}
          >
            <span lang={l.htmlLang}>{l.chip}</span>
          </button>
        ))}
      </div>

      <div className="page-grid">
        <div className="col-main">
          <button className="cta-card" onClick={() => onStart(nextScenario.id)}>
            <span className={`glyph tone-${nextScenario.tone}`} lang={language.htmlLang} aria-hidden="true">
              {nextScenario.glyph}
            </span>
            <span className="cta-body">
              <small>{state.lessons?.[nextScenario.id] ? 'CONTINUE THIS MOMENT' : 'YOUR NEXT REAL-LIFE MOMENT'}</small>
              <b>{nextScenario.title}</b>
              <span>{nextScenario.blurb}</span>
            </span>
            <Forward />
          </button>

          <section className="panel custom-moment" aria-labelledby="custom-moment-head">
            <div className="custom-moment-heading">
              <span className="custom-moment-icon" aria-hidden="true">
                <Sparkles width={20} height={20} />
              </span>
              <span>
                <span className="eyebrow">YOUR LIFE, YOUR LANGUAGE</span>
                <h2 id="custom-moment-head">Make your own moment</h2>
              </span>
            </div>
            <p className="muted small-text">
              Tell Gemini what you need to say. It will make a short {language.name} warm-up and
              conversation just for that situation.
            </p>
            <form className="custom-moment-form" onSubmit={makeMoment}>
              <label className="sr-only" htmlFor="custom-moment-request">
                Describe your conversation
              </label>
              <input
                id="custom-moment-request"
                className="field"
                value={momentRequest}
                onChange={(event) => {
                  setMomentRequest(event.target.value);
                  setMomentError('');
                }}
                placeholder="e.g. Ask my dad for allowance"
                maxLength={240}
                disabled={makingMoment}
              />
              <button className="primary" disabled={makingMoment || momentRequest.trim().length < 6}>
                <Sparkles width={17} height={17} />
                {makingMoment ? 'Making your moment…' : 'Make this moment'}
              </button>
            </form>
            <div className="custom-moment-examples" aria-label="Example moments">
              {MOMENT_EXAMPLES.map((example) => (
                <button key={example} type="button" className="pill" onClick={() => setMomentRequest(example)}>
                  {example}
                </button>
              ))}
            </div>
            {live === false && (
              <p className="custom-moment-note">
                Gemini is not configured yet. Ready-made and previously created moments still work.
              </p>
            )}
            {momentError && (
              <p className="custom-moment-status" role="status" aria-live="polite">
                <Sparkles width={15} height={15} />
                <span>{momentError}</span>
              </p>
            )}

            {customMoments.length > 0 && (
              <div className="saved-moments">
                <h3>Your moments</h3>
                <ul className="scenario-grid compact custom-moment-list">
                  {customMoments.slice(0, 3).map(({ scenario: saved }) => (
                    <li key={saved.id}>
                      <button className={`scenario-card tone-${saved.tone}`} onClick={() => onStart(saved.id)}>
                        <span className="glyph" lang={language.htmlLang} aria-hidden="true">
                          {saved.glyph}
                        </span>
                        <span className="scenario-body">
                          <b>{saved.title}</b>
                          <small>{saved.blurb}</small>
                          <small className="scenario-meta">
                            with {saved.persona.name} · {state.lessons?.[saved.id] ? 'ready to revisit' : 'learn the lines first'}
                          </small>
                        </span>
                        <Forward width={18} height={18} />
                      </button>
                    </li>
                  ))}
                </ul>
                {customMoments.length > 3 && (
                  <button className="link-btn tiny saved-moments-more" onClick={() => onRoute('learn')}>
                    See all {customMoments.length} of your moments
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="moments" aria-labelledby="pick-head">
            <div className="section-head">
              <span>
                <span className="eyebrow">PRACTISE WHERE IT COUNTS</span>
                <h2 id="pick-head">{t('home.pickMoment')}</h2>
              </span>
              <button className="link-btn" onClick={() => onRoute('learn')}>
                See every moment
              </button>
            </div>
            <ul className="scenario-grid compact">
              {scenarios.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <button className={`scenario-card tone-${s.tone}`} onClick={() => onStart(s.id)}>
                    <span className="glyph" lang={language.htmlLang} aria-hidden="true">
                      {s.glyph}
                    </span>
                    <span className="scenario-body">
                      <b>{s.title}</b>
                      <small>{s.blurb}</small>
                      <small className="scenario-meta">
                        with {s.persona.name} · {s.minutes} {t('label.minutes')} ·{' '}
                        <b className={state.lessons?.[s.id] ? 'ok' : ''}>
                          {state.lessons?.[s.id] ? 'ready to revisit' : 'learn the lines first'}
                        </b>
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel phrase-shelf" aria-labelledby="words-head">
            <div className="panel-head">
              <h2 id="words-head">
                <Book width={18} height={18} /> Words you can take into real life
              </h2>
              <button className="link-btn" onClick={() => onRoute('review')}>
                Open phrasebook
              </button>
            </div>
            {phrases.length === 0 ? (
              <p className="muted small-text">
                Your first useful phrases will live here after one warm-up — ready for a family chat,
                lunch order or message to a friend.
              </p>
            ) : (
              <ul className="phrase-preview">
                {phrases.slice(0, 4).map((phrase) => (
                  <li key={phrase.text}>
                    <b lang={language.htmlLang}>{phrase.text}</b>
                    <span>{phrase.english}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="col-side">
          <button className="real-talk-card" onClick={() => onRoute('slang')}>
            <Sparkles width={21} height={21} />
            <span>
              <small>TEXTBOOK → REAL LIFE</small>
              <b>How people actually say it</b>
              <span>Slang, code-switching and who each phrase is safe with.</span>
            </span>
            <Forward width={18} height={18} />
          </button>

          <button className="review-cta" onClick={() => onRoute('review')}>
            <Book />
            <span>
              <b>Keep your phrases fresh</b>
              <small>
                {phrases.length === 0
                  ? 'Your phrasebook starts after one warm-up'
                  : due.length > 0
                    ? `${due.length} ${due.length === 1 ? 'phrase wants' : 'phrases want'} another look`
                    : 'Nothing due — browse what you already know'}
              </small>
            </span>
            {due.length > 0 && <i className="due">{due.length}</i>}
          </button>

          <section className="panel language-footprint" aria-labelledby="footprint-head">
            <div className="panel-head">
              <h2 id="footprint-head">Your {language.name} footprint</h2>
            </div>
            <div className="footprint-grid">
              <span>
                <b>{state.sessions}</b>
                <small>real-life conversations</small>
              </span>
              <span>
                <b>{phrases.length}</b>
                <small>phrases kept</small>
              </span>
              <span>
                <b>{warmed}</b>
                <small>moments ready</small>
              </span>
            </div>
          </section>

          <section className="panel outside-card" aria-labelledby="outside-head">
            <span className="eyebrow">TAKE IT OUTSIDE THE APP</span>
            <h2 id="outside-head">Use one line with a real person</h2>
            <div className="outside-phrase">
              <b lang={language.htmlLang}>{outsidePhrase.text}</b>
              <span>{outsidePhrase.english}</span>
            </div>
            <p className="muted small-text">
              Try it in a family chat, over lunch, or with someone beside you. Nothing to tick off and
              nobody is keeping score.
            </p>
            <button className="link-btn" onClick={() => onRoute(phrases.length > 0 ? 'review' : 'learn')}>
              {phrases.length > 0 ? 'Pick another phrase' : 'Learn a few useful lines'}
            </button>
          </section>

          <div className="home-meta">
            <p className="foot">
              <span className={`dot ${live ? 'live' : ''}`} aria-hidden="true" />
              {live === null
                ? 'Checking Gemini…'
                : live
                  ? 'Gemini configured'
                  : 'Scripted demo, ready offline'}
            </p>
            <button className="link-btn tiny" onClick={() => onRoute('feedback')}>
              Share feedback
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
