import type { ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { s } from './strings';

const PANELS = ['main', 'viewer'];

/**
 * The desktop columns beside the navigation: the page and, when something is cited, the
 * viewer with a drag handle between them. The width is remembered. Pass `viewer` only while
 * the viewer is open; `main` stays mounted either way. It has no pdf.js or Shiki in it, so
 * the shell can import it directly and keep the viewer itself lazy.
 */
export function ViewerLayout({ main, viewer }: { main: ReactNode; viewer?: ReactNode }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'codebook-viewer',
    panelIds: PANELS,
  });

  return (
    <Group
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      // Visible, so the viewer can stick to the screen while the page scrolls.
      style={{ overflow: 'visible', flex: '1 1 0%', minWidth: 0, height: 'auto' }}
    >
      {/* A column, so the page fills the height and its composer sits at the bottom. */}
      <Panel id="main" minSize="360px" className="flex flex-col" style={{ overflow: 'visible' }}>
        {main}
      </Panel>
      {viewer && (
        <>
          <Separator
            aria-label={s.resize}
            className="w-1 shrink-0 bg-rule transition-colors duration-150 hover:bg-accent data-[separator=active]:bg-accent"
          />
          <Panel
            id="viewer"
            defaultSize="42%"
            minSize="320px"
            maxSize="70%"
            style={{ overflow: 'visible' }}
          >
            {viewer}
          </Panel>
        </>
      )}
    </Group>
  );
}
