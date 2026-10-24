import { appConfig } from '../../../config/app.config.js';
import { countTokens } from '../../../utils/tokens.js';
import type { CitationRegistry } from '../../citations/citationRegistry.js';
import { renderSource } from '../../citations/citationRegistry.js';
import type { NewCitation } from '../../citations/citations.types.js';

// Room for a <source> block's opening and closing tags.
const TAG_TOKENS = 60;

/**
 * Cuts text to about `maxTokens`, at a line break when one is near the end, or at the last
 * one with `wholeLines` (numbered lines must not end half shown). Tokens are counted again
 * after the cut, so a text full of long identifiers still fits.
 */
export function cutToTokens(text: string, maxTokens: number, wholeLines = false) {
  const tokens = countTokens(text);
  if (tokens <= maxTokens) return { text, cut: false };
  let end = Math.floor((text.length * maxTokens) / tokens);
  let cut = text.slice(0, end);
  while (countTokens(cut) > maxTokens && end > 0) {
    end = Math.floor(end * 0.9);
    cut = text.slice(0, end);
  }
  const lineBreak = cut.lastIndexOf('\n');
  if (lineBreak > (wholeLines ? 0 : cut.length / 2)) cut = cut.slice(0, lineBreak);
  return { text: cut, cut: true };
}

/**
 * A passage cut to fit must not claim the range it was cut from. Numbered lines are one per
 * source line, so what was shown is known; for other text only where it starts is.
 */
function cutCitation(ref: NewCitation, maxTokens: number): NewCitation {
  if (ref.kind === 'LINES' && ref.lineStart !== undefined) {
    const { text } = cutToTokens(ref.text, maxTokens, true);
    return { ...ref, text, lineEnd: ref.lineStart + text.split('\n').length - 1 };
  }
  const { text } = cutToTokens(ref.text, maxTokens);
  // A line range can't be open-ended in a <source> tag, so it goes entirely.
  return { ...ref, text, pageEnd: undefined, lineStart: undefined, lineEnd: undefined };
}

/**
 * The parts of one tool result, up to the tool's token budget. Parts come best first, so
 * what is left out matters least; the first one always goes in, cut if it must be.
 */
export class ToolText {
  private readonly parts: string[] = [];
  private used = 0;
  left = 0;

  constructor(private readonly maxTokens: number = appConfig.tools.resultTokens) {}

  /** Adds plain text; false when it doesn't fit. */
  add(part: string) {
    const tokens = countTokens(part);
    if (this.parts.length > 0 && this.used + tokens > this.maxTokens) {
      this.left += 1;
      return false;
    }
    this.parts.push(this.parts.length === 0 ? cutToTokens(part, this.maxTokens).text : part);
    this.used += Math.min(tokens, this.maxTokens);
    return true;
  }

  /**
   * Numbers the passage and adds its <source> block; null when it doesn't fit. The text is
   * cut before it is registered, so the citation holds exactly what the model saw.
   */
  addSource(registry: CitationRegistry, ref: NewCitation): number | null {
    const room = this.maxTokens - this.used - TAG_TOKENS;
    let shown = ref;
    if (countTokens(ref.text) > room) {
      if (this.parts.length > 0 || room <= 0) {
        this.left += 1;
        return null;
      }
      shown = cutCitation(ref, room);
    }
    const n = registry.add(shown);
    const block = renderSource(registry.get(n)!);
    this.parts.push(block);
    this.used += countTokens(block);
    return n;
  }

  get empty() {
    return this.parts.length === 0;
  }

  join(separator = '\n\n') {
    return this.parts.join(separator);
  }
}
