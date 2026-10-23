// PDFs built in memory, so no binary fixtures live in the repo.

// A tiny one-page PDF without text. Enough for the upload checks.
export function minimalPdf(note = 'test') {
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
      '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
      '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]>> endobj',
      `% ${note}`,
      'trailer <</Root 1 0 R>>',
      '%%EOF',
    ].join('\n'),
  );
}

export type OutlineItem = { title: string; page: number; items?: OutlineItem[] };

type PdfSpec = {
  // One string per page; each line becomes a line of text. ASCII only (WinAnsi font).
  pages: string[];
  outline?: OutlineItem[];
  // Draw a filled box instead of text on every page, like a scanned book without OCR.
  imageOnly?: boolean;
};

/** A real PDF with text pages and, optionally, an outline (bookmarks). */
export function buildPdf({ pages, outline = [], imageOnly = false }: PdfSpec) {
  // Object bodies by number; numbers are reserved first so objects can point at each other.
  const objects: string[] = [];
  const reserve = () => objects.push('');
  const set = (id: number, body: string) => (objects[id - 1] = body);

  const catalogId = reserve();
  const pagesId = reserve();
  const fontId = reserve();
  set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  const pageIds = pages.map((text) => {
    const stream = imageOnly ? '0.5 g 72 72 468 648 re f' : textStream(text);
    const contentId = reserve();
    set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = reserve();
    set(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    return pageId;
  });
  set(pagesId, `<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${pageIds.length} >>`);

  let outlineEntry = '';
  if (outline.length > 0) {
    const rootId = reserve();
    const top = addOutlineItems(outline, rootId);
    set(
      rootId,
      `<< /Type /Outlines /First ${ref(top[0]!)} /Last ${ref(top.at(-1)!)} /Count ${top.length} >>`,
    );
    outlineEntry = ` /Outlines ${ref(rootId)}`;
  }
  set(catalogId, `<< /Type /Catalog /Pages ${ref(pagesId)}${outlineEntry} >>`);

  function addOutlineItems(items: OutlineItem[], parentId: number): number[] {
    const ids = items.map(() => reserve());
    items.forEach((item, i) => {
      const fields = [
        `/Title (${escape(item.title)})`,
        `/Parent ${ref(parentId)}`,
        `/Dest [${ref(pageIds[item.page - 1]!)} /XYZ 0 792 0]`,
      ];
      if (i > 0) fields.push(`/Prev ${ref(ids[i - 1]!)}`);
      if (i < ids.length - 1) fields.push(`/Next ${ref(ids[i + 1]!)}`);
      if (item.items?.length) {
        const kids = addOutlineItems(item.items, ids[i]!);
        fields.push(`/First ${ref(kids[0]!)} /Last ${ref(kids.at(-1)!)} /Count ${kids.length}`);
      }
      set(ids[i]!, `<< ${fields.join(' ')} >>`);
    });
    return ids;
  }

  return serialize(objects, catalogId);
}

function ref(id: number) {
  return `${id} 0 R`;
}

function escape(text: string) {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

// Helvetica 11pt, 14pt leading; the ' operator moves to the next line and shows the string.
function textStream(text: string) {
  const lines = text.split('\n').map((line) => `(${escape(line)}) '`);
  return ['BT', '/F1 11 Tf', '14 TL', '72 740 Td', ...lines, 'ET'].join('\n');
}

// Writes the objects with a cross-reference table, so pdf.js doesn't have to repair the file.
function serialize(objects: string[], catalogId: number) {
  let out = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(out, 'latin1');
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${ref(catalogId)} >>\n`;
  out += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
