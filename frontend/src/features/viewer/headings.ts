export type Heading = { level: number; text: string };

/** The `#` headings of a markdown text, in order, leaving out lines inside code fences. */
export function markdownHeadings(markdown: string): Heading[] {
  const found: Heading[] = [];
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      const mark = open[1]![0]!;
      if (!fence) fence = mark;
      else if (fence === mark) fence = undefined;
      continue;
    }
    if (fence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[2]) found.push({ level: m[1]!.length, text: m[2] });
  }
  return found;
}

/** Lowercased, with runs of whitespace collapsed: how headings are compared. */
export const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
