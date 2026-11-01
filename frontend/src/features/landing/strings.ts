export const landing = {
  github: 'https://github.com/girishthedecent/codebook',
  header: {
    github: 'GitHub',
    signIn: 'Sign in',
    demo: 'Try the demo',
    workspace: 'Open workspace',
    theme: 'Dark mode',
  },
  hero: {
    title: 'Ask the book and the code in one question.',
    lede: 'CodeBook reads a PDF, a GitHub repository and a docs page as one workspace. Each sentence of the answer carries a footnote that opens the page or the lines behind it.',
    label: 'Your question',
    ask: 'Ask the demo',
    note: 'Opens the demo workspace as a guest. No account, ten questions a day.',
    others: 'Or start with one of these',
    member: "You're signed in.",
    memberLink: 'Open your workspace',
    figure: (page: number, path: string, from: number, to: number) =>
      `Page ${page} of the book and lines ${from}–${to} of ${path}: two halves of the same idea, read by the same question.`,
  },
  watch: {
    title: 'Watch one question get answered',
    lede: 'A recording of a real turn on the live demo. The steps, their timings and the answer are as the server sent them, a little compressed where the model was thinking.',
    consulted: 'Consulted',
    notes: 'Notes',
    play: 'Play',
    pause: 'Pause',
    replay: 'Replay',
    skip: 'Skip to the answer',
    working: 'Working…',
    answeredIn: (ms: string) => `Answered in ${ms}`,
    viewer: 'Opens beside the answer',
    emptyViewer: 'Select a footnote to open its source here.',
    of: (n: number, total: number) => `${n} of ${total}`,
    page: (n: number) => `page ${n}`,
    lines: (path: string, a: number, b: number) => `${path}, lines ${a}–${b}`,
  },
  shelf: {
    title: 'Three sources, one question',
    lede: 'The book explains the idea, the code does it, the docs page lists what goes wrong. Ask once and the agent reads all three.',
    citedBy: (n: number, total: number) =>
      n === 0
        ? 'Not cited in this answer'
        : `Cited in ${n} of ${total} sentence${total === 1 ? '' : 's'} above`,
    show: 'Show them',
  },
  proof: {
    title: 'How well it finds things',
    lede: 'Retrieval is tested on 65 hand-checked questions over a book, a repository and a docs page (not the demo’s). Recall@5 is how often the right passage is among the first five results.',
    measured: 'Measured on the 46 tuning questions of the time, 24 October 2026.',
    rows: [
      ['Keyword search only', 0.714],
      ['Hybrid, the default', 0.901],
      ['Hybrid with a reranker', 0.917],
      ['Vector search only', 0.925],
    ] as Array<[string, number]>,
    facts: [
      {
        figure: '0.921',
        text: 'recall@5 on code and cross-source questions when a model-written note is added to each passage before embedding, up from 0.816 without it.',
      },
      {
        figure: '14',
        text: 'questions were held back and looked at once, after the settings were chosen. Vector search scored 0.974 recall@5 on them.',
      },
    ],
    why: 'Vector search alone scores a little higher here. The default is hybrid because exact identifiers and error strings only match by keyword.',
    readme: 'Full tables in the README',
  },
  footer: {
    line: 'Built as a portfolio project.',
    credits:
      'The demo’s book is François Fleuret’s The Little Book of Deep Learning (CC BY-NC-SA 4.0). Its repository is Andrej Karpathy’s nanoGPT (MIT).',
    source: 'Source on GitHub',
  },
  demo: {
    waking: 'Waking the server, this can take up to a minute.',
    opening: 'Opening the demo',
    openingQuestion: 'Opening the demo with your question',
  },
} as const;
