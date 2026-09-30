/** Browser helpers for the audit export. User-initiated only; nothing is uploaded anywhere. */

export function saveText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens an HTML document in a new tab (for printing). */
export function openHtml(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
