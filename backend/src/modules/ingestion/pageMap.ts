// PDF documents store their pages joined with \f, so a character offset tells its page.

/** Offsets where each page starts; entry 0 is page 1. */
export function pageStarts(content: string) {
  const starts = [0];
  for (let i = content.indexOf('\f'); i !== -1; i = content.indexOf('\f', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/** The 1-based page that holds the character at `offset`. */
export function pageAt(starts: number[], offset: number) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}
