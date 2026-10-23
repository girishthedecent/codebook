import { extractText, getDocumentProxy } from 'unpdf';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type RawOutlineItem = Awaited<ReturnType<PdfDocument['getOutline']>>[number];

export type PdfOutlineItem = {
  title: string;
  // 1-based physical page; null when the bookmark points nowhere we can resolve (e.g. a URL).
  page: number | null;
  items: PdfOutlineItem[];
};

export type RawPdf = {
  // Text of each page in order, line breaks kept.
  pages: string[];
  outline: PdfOutlineItem[];
};

/** A PDF we can't ingest, with a message that is safe to show the user. */
export class PdfReadError extends Error {
  override name = 'PdfReadError';
}

export async function readPdf(data: Uint8Array): Promise<RawPdf> {
  let pdf: PdfDocument;
  try {
    // pdf.js takes ownership of the buffer it's given, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch (error) {
    if ((error as Error).name === 'PasswordException') {
      throw new PdfReadError('This PDF is password-protected');
    }
    throw new PdfReadError('Could not read this PDF');
  }

  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const outline = await resolveOutline(pdf, (await pdf.getOutline()) ?? []);
    return { pages: text, outline };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function resolveOutline(pdf: PdfDocument, items: RawOutlineItem[]) {
  const resolved: PdfOutlineItem[] = [];
  for (const item of items) {
    resolved.push({
      title: item.title.trim(),
      page: await destinationPage(pdf, item.dest),
      items: await resolveOutline(pdf, item.items as RawOutlineItem[]),
    });
  }
  return resolved;
}

// A destination is either a name to look up or an explicit array whose first entry is the
// page: usually a reference to the page object, sometimes a plain 0-based index.
async function destinationPage(pdf: PdfDocument, dest: RawOutlineItem['dest']) {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    const target: unknown = explicit?.[0];
    if (typeof target === 'number') return target + 1;
    if (!target) return null;
    return (await pdf.getPageIndex(target as Parameters<PdfDocument['getPageIndex']>[0])) + 1;
  } catch {
    return null;
  }
}
