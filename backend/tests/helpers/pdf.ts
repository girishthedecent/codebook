// A tiny one-page PDF, built in memory so no binary file lives in the repo. Enough for the
// upload checks; Phase 5 brings real fixtures with text and an outline.
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
