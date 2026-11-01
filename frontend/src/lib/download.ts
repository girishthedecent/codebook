/** Saves text as a file through a temporary link. The type decides the extension the browser suggests. */
export function downloadText(name: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled; revoking at once loses the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A file name from a title: letters, digits and dashes, lower case, never empty. */
export function fileSlug(title: string, fallback = 'untitled') {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
