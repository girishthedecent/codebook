// Copy for the workspace search panel.
export const searchStrings = {
  title: 'Search the sources',
  hint: "Finds passages in the demo's sources. Each result opens beside this page.",
  ownerHint: 'The same search the agent runs. Pick how it matches, and see how each result scored.',
  placeholder: 'Words from a passage, or a question',
  search: 'Search',
  searching: 'Searching',
  noHits: 'Nothing matched. Try other words from the passage.',
  mode: 'Matching',
  modes: {
    hybrid: 'By meaning and words',
    keyword: 'By words only',
    vector: 'By meaning only',
  },
  rerank: 'Rerank the results',
  rerankHint: 'Slower, but puts the closest passage first.',
  weak: 'weak match',
  reranked: 'reranked',
  rerankUnavailable: 'rerank unavailable',
} as const;
