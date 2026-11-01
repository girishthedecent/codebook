import { useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { textLinkClass } from '@/ui/textLinkClass';
import { CodeListing } from './CodeListing';
import { fixtures } from './fixtures';
import { landing } from './strings';
import { useReducedMotion, type Visitor } from './hooks';

const t = landing.hero;

export function Hero({ visitor }: { visitor: Visitor }) {
  const questions = fixtures.demo?.starterQuestions ?? [];
  const [question, setQuestion] = useState(questions[0] ?? '');
  // The suggestion walks through the starters until the visitor touches the form: hover or
  // focus holds it, and typing or picking one ends it for good. Reduced motion never starts it.
  // The pace is set by the line filling beside the current starter, so the two never drift and
  // holding is just pausing that animation.
  const [held, setHeld] = useState(false);
  const [chosen, setChosen] = useState(false);
  const reduced = useReducedMotion();
  const rotating = !reduced && !chosen && questions.length > 1;
  const next = () => {
    if (rotating) {
      setQuestion((current) => questions[(questions.indexOf(current) + 1) % questions.length]!);
    }
  };
  const pick = (q: string) => {
    setChosen(true);
    setQuestion(q);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto grid w-full max-w-wide gap-10 px-4 pt-6 pb-16 sm:px-8 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-14 lg:pb-24"
    >
      <div className="min-w-0">
        <h1 id="hero-title" className="heading-display max-w-[16em]">
          {t.title}
        </h1>
        <p className="prose mt-5 max-w-[34em] text-ink-2">{t.lede}</p>

        {questions.length > 0 && (
          <form
            action="/demo"
            method="get"
            className="mt-8 max-w-[40rem]"
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
          >
            <div className="rounded-md border border-edge bg-paper-2 transition-colors focus-within:border-accent">
              <label htmlFor="hero-question" className="sr-only">
                {t.label}
              </label>
              <textarea
                id="hero-question"
                name="q"
                rows={3}
                maxLength={1000}
                value={question}
                onChange={(e) => {
                  setChosen(true);
                  setQuestion(e.target.value);
                }}
                onKeyDown={onKeyDown}
                className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 font-serif text-base leading-snug text-ink outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3">
                <p className="max-w-[26em] text-xs text-ink-3">{t.note}</p>
                <Button type="submit" variant="primary">
                  {t.ask}
                </Button>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-xs text-ink-3">{t.others}</p>
              <ol className="mt-1 list-none p-0">
                {questions.map((q) => {
                  const current = q === question;
                  return (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => pick(q)}
                        aria-pressed={current}
                        className={cn(
                          'relative w-full py-1.5 pl-3.5 text-left font-serif text-base text-balance transition-colors max-sm:min-h-11',
                          current ? 'text-ink' : 'text-ink-2 hover:text-ink',
                        )}
                      >
                        {current && (
                          <span
                            aria-hidden
                            className="absolute inset-y-1 left-0 w-0.5 overflow-hidden rounded-full bg-rule-2"
                          >
                            <span
                              onAnimationEnd={next}
                              className={cn(
                                'block size-full origin-top bg-accent',
                                rotating && 'animate-[fill-down_6s_linear_both]',
                                held && '[animation-play-state:paused]',
                              )}
                            />
                          </span>
                        )}
                        {q}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </form>
        )}

        {visitor === 'member' && (
          <p className="mt-6 text-sm text-ink-2">
            {t.member}{' '}
            <a href="/w" className={textLinkClass}>
              {t.memberLink}
            </a>
          </p>
        )}
      </div>

      <Specimen />
    </section>
  );
}

/** The two things one question reads: a page of the book and the code that does the same. */
function Specimen() {
  const page = fixtures.book?.pages[0];
  const slice = fixtures.code?.slices[0];
  if (!page || !slice || !fixtures.code) return null;
  const forward = slice.lines.findIndex((line) => line.some(([text]) => text === 'forward'));
  const start = slice.lineStart + Math.max(forward, 0);
  return (
    <figure className="m-0 hidden min-w-0 sm:block lg:pt-2">
      <div className="relative h-[27rem] max-lg:mx-auto max-lg:max-w-[36rem]">
        <div className="absolute top-0 left-0 w-[14.5rem] overflow-hidden rounded-md border border-rule bg-paper-3 shadow-float">
          <img
            src={page.image}
            width={page.width}
            height={Math.round(page.height * 0.62)}
            alt=""
            decoding="async"
            className="block w-full object-cover object-top"
            style={{ aspectRatio: `${page.width} / ${page.height * 0.62}` }}
          />
        </div>
        <div className="absolute right-0 bottom-0 w-[20rem] max-w-[calc(100%-5rem)] overflow-hidden rounded-md border border-rule bg-paper-2 shadow-float">
          <div
            className="py-3"
            style={{ maskImage: 'linear-gradient(to right, #000 82%, transparent)' }}
          >
            <CodeListing slice={slice} from={start} to={start + 12} className="overflow-hidden" />
          </div>
        </div>
      </div>
      <figcaption className="mt-4 max-w-[26rem] text-xs text-ink-3">
        {t.figure(page.page, slice.path, start, start + 12)}
      </figcaption>
    </figure>
  );
}
