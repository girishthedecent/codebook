import type { ThemeRegistration } from 'shiki/core';

/**
 * Code colours drawn from the app's own palette: ink for plain text, the accent (green in
 * light, ember in dark) for keywords, and the source-kind hues and signal colours for the rest. Every colour clears
 * 4.5:1 on both paper and paper-2 in its own theme.
 */
type Palette = {
  type: 'light' | 'dark';
  ink: string;
  muted: string;
  quiet: string;
  keyword: string;
  string: string;
  fn: string;
  typeName: string;
  number: string;
  attribute: string;
  invalid: string;
  paper: string;
  rule: string;
};

const light: Palette = {
  type: 'light',
  ink: '#1f1c18',
  muted: '#4d4842',
  quiet: '#666057',
  keyword: '#2e5d4b',
  string: '#8a5a12',
  fn: '#3a5f8a',
  typeName: '#7a4466',
  number: '#9b3a2f',
  attribute: '#5f5f1e',
  invalid: '#9b3a2f',
  paper: '#f6f3ec',
  rule: '#e6e1d4',
};

const dark: Palette = {
  type: 'dark',
  ink: '#f2efe9',
  muted: '#c4beb4',
  quiet: '#9c968c',
  keyword: '#ff8a4c',
  string: '#a8d5a2',
  fn: '#8fb6ec',
  typeName: '#e7a0c0',
  number: '#f2c14e',
  attribute: '#c9c26a',
  invalid: '#f47174',
  paper: '#000000',
  rule: '#18181a',
};

function build(name: string, c: Palette): ThemeRegistration {
  return {
    name,
    type: c.type,
    colors: { 'editor.background': c.paper, 'editor.foreground': c.ink },
    settings: [
      { settings: { foreground: c.ink, background: c.paper } },
      {
        scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
        settings: { foreground: c.quiet, fontStyle: 'italic' },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'keyword.control',
          'keyword.operator.new',
          'keyword.operator.expression',
          'variable.language',
          'entity.name.tag',
        ],
        settings: { foreground: c.keyword },
      },
      {
        scope: ['keyword.operator', 'punctuation', 'meta.brace', 'punctuation.definition.tag'],
        settings: { foreground: c.muted },
      },
      {
        scope: [
          'string',
          'string.quoted',
          'punctuation.definition.string',
          'string.regexp',
          'markup.inline.raw',
        ],
        settings: { foreground: c.string },
      },
      {
        scope: [
          'constant.numeric',
          'constant.language',
          'constant.character',
          'constant.other.color',
          'support.constant',
          'markup.heading',
        ],
        settings: { foreground: c.number },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call entity.name.function',
          'variable.function',
          'entity.name.command',
          'meta.function-call.generic',
        ],
        settings: { foreground: c.fn },
      },
      {
        scope: [
          'entity.name.type',
          'entity.name.class',
          'entity.name.namespace',
          'entity.other.inherited-class',
          'support.class',
          'support.type',
          'storage.type.class',
          'meta.type',
        ],
        settings: { foreground: c.typeName },
      },
      {
        scope: [
          'entity.other.attribute-name',
          'support.type.property-name',
          'meta.object-literal.key',
          'entity.name.tag.yaml',
          'variable.other.property',
          'markup.underline.link',
        ],
        settings: { foreground: c.attribute },
      },
      {
        scope: ['entity.name.tag.css', 'entity.other.attribute-name.class.css'],
        settings: { foreground: c.fn },
      },
      { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
      { scope: ['invalid', 'invalid.illegal'], settings: { foreground: c.invalid } },
    ],
  };
}

export const codebookLight = build('codebook-light', light);
export const codebookDark = build('codebook-dark', dark);
