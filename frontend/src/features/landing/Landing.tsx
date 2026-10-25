// The landing page. Prerendered to static HTML at build time, so it uses plain anchors and
// nothing from the router: it has to read without any JavaScript.

const whatYouGet: Array<[string, string]> = [
  [
    'Cited answers',
    'Every claim points at a page of the book or a file and line range in the code.',
  ],
  [
    'The agent picks how to search',
    'Vector search, keywords, the table of contents, the call graph or the web, chosen per question and retried when the first pass is weak.',
  ],
  [
    'Code graph',
    'Callers, dependencies and the path between two functions, built from the repository itself.',
  ],
  [
    'Study tools',
    'A quiz, flashcards, a mind map or a summary of any source, with the same citations.',
  ],
  [
    'Memory',
    'What you tell it about yourself carries over between conversations, and you can edit or clear it.',
  ],
];

export function Landing() {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <main className="mx-auto max-w-[720px] px-4 pt-10 pb-16 sm:pt-16">
        <p className="font-mono text-xs tracking-wide text-ink-3">CodeBook</p>

        <h1 className="mt-6 font-serif text-xl font-semibold text-balance sm:text-2xl">
          Ask a book and its code together.
        </h1>

        <p className="prose mt-6 max-w-[60ch] text-ink-2">
          Put a PDF book, a GitHub repository and a few documentation pages in one workspace and ask
          questions across them. Answers come back with page numbers and file:line references you
          can open in place. The agent decides how to search for each question, and the same sources
          turn into quizzes, flashcards and summaries.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/demo"
            className="inline-flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-medium text-paper hover:bg-accent-2"
          >
            Try the demo
          </a>
          <a
            href="/sign-in"
            className="inline-flex h-10 items-center rounded-sm border border-rule-2 px-4 text-sm font-medium hover:bg-paper-2"
          >
            Sign in
          </a>
        </div>

        <section className="mt-16" aria-labelledby="what-you-get">
          <h2 id="what-you-get" className="text-xs font-medium tracking-wide text-ink-3 uppercase">
            What you get
          </h2>
          <dl className="mt-3 border-t border-rule">
            {whatYouGet.map(([term, detail]) => (
              <div
                key={term}
                className="grid grid-cols-1 gap-1 border-b border-rule py-3 sm:grid-cols-[200px_1fr] sm:gap-6"
              >
                <dt className="text-sm font-medium">{term}</dt>
                <dd className="m-0 text-sm text-ink-2">{detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-16" aria-label="Example">
          <h2 className="text-xs font-medium tracking-wide text-ink-3 uppercase">An exchange</h2>
          <div className="mt-3 border-t border-rule pt-5">
            <p className="font-serif text-base font-semibold">
              Does Express&rsquo;s{' '}
              <code className="font-mono text-[0.85em] font-normal">next()</code> chain behave like
              a replication log, where each layer sees the request in order?
            </p>
            <ol className="mt-4 space-y-1 pl-3 font-mono text-xs text-ink-3">
              <li>
                search_sources&ensp;
                <span className="text-ink-2">&ldquo;router stack next follower log&rdquo;</span>
                &ensp;42 ms
              </li>
              <li>
                read_source&ensp;<span className="text-ink-2">lib/router/index.js:139–183</span>
                &ensp;11 ms
              </li>
            </ol>
            <div className="prose mt-5 border-l-2 border-rule-2 pl-4">
              <p>
                Not really. Express walks its router&rsquo;s <code>stack</code> in order and hands
                the request to each matching layer, which passes control on with <code>next()</code>
                ; nothing is recorded, so a layer that ends the response simply stops the chain
                <Cite n={1} where="express · lib/router/index.js:139–183" />. A replication log is
                the opposite: every change is appended durably, so a follower that was down can ask
                the leader for everything after the last transaction it processed and catch up
                <Cite n={2} where="Designing Data-Intensive Applications · p. 157" />. The two share
                only the idea of ordered processing.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[720px] border-t border-rule px-4 py-6 text-xs text-ink-3">
        Built as a portfolio project ·{' '}
        <a
          href="https://github.com/girishthedecent/codebook"
          className="text-accent underline underline-offset-2"
        >
          source on GitHub
        </a>
      </footer>
    </div>
  );
}

function Cite({ n, where }: { n: number; where: string }) {
  return (
    <sup className="ml-0.5 font-sans text-[0.7em] font-medium text-accent" title={where}>
      {n}
    </sup>
  );
}
