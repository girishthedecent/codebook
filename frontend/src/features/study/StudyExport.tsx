import type { Citation } from '@/api/types';
import { downloadText, fileSlug } from '@/lib/download';
import { Button, Menu, MenuItem, MenuSeparator } from '@/ui';
import type { StudyContent } from './data';
import { flashcardsAnki, flashcardsCsv, quizMarkdown, summaryMarkdown } from './export';
import { mindmapSvg } from './mindmapSvg';
import { s } from './strings';

const MARKDOWN = 'text/markdown;charset=utf-8';

/** Download and print, per kind: what each kind is useful as outside the app. */
export function StudyExport({
  content,
  title,
  index,
}: {
  content: StudyContent;
  title: string;
  index: Map<number, Citation>;
}) {
  const name = fileSlug(title, 'study-set');
  const printable = content.type === 'QUIZ' || content.type === 'SUMMARY';

  return (
    <Menu
      trigger={
        <Button size="sm" variant="ghost">
          {s.exports.label}
        </Button>
      }
    >
      {content.type === 'FLASHCARDS' && (
        <>
          <MenuItem
            onSelect={() =>
              downloadText(
                `${name}.csv`,
                flashcardsCsv(content.data, index),
                'text/csv;charset=utf-8',
              )
            }
          >
            {s.exports.csv}
          </MenuItem>
          <MenuItem
            onSelect={() =>
              downloadText(
                `${name}.txt`,
                flashcardsAnki(content.data),
                'text/tab-separated-values;charset=utf-8',
              )
            }
          >
            {s.exports.anki}
          </MenuItem>
        </>
      )}
      {content.type === 'QUIZ' && (
        <MenuItem
          onSelect={() =>
            downloadText(`${name}.md`, quizMarkdown(content.data, title, index), MARKDOWN)
          }
        >
          {s.exports.markdown}
        </MenuItem>
      )}
      {content.type === 'SUMMARY' && (
        <MenuItem
          onSelect={() =>
            downloadText(`${name}.md`, summaryMarkdown(content.data, title, index), MARKDOWN)
          }
        >
          {s.exports.markdown}
        </MenuItem>
      )}
      {content.type === 'MINDMAP' && (
        <MenuItem
          onSelect={() =>
            downloadText(
              `${name}.svg`,
              mindmapSvg(content.data.root),
              'image/svg+xml;charset=utf-8',
            )
          }
        >
          {s.exports.svg}
        </MenuItem>
      )}
      {printable && (
        <>
          <MenuSeparator />
          {/* After the menu has closed, so it isn't in the printout. */}
          <MenuItem onSelect={() => requestAnimationFrame(() => window.print())}>
            {s.exports.print}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
