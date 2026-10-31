/**
 * An inline Content-Disposition for a file name that may not be Latin-1: `filename*` carries
 * the real name (RFC 5987, percent-encoded UTF-8) and `filename` an ASCII stand-in for
 * clients that don't read it. Header values can't hold other characters, and a raw one makes
 * Node throw.
 */
export function inlineDisposition(fileName: string) {
  const name = fileName.trim() || 'document.pdf';
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/gu, '_');
  // encodeURIComponent leaves ' ( ) * alone, which RFC 5987 doesn't allow in a value.
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
