/**
 * Has the browser save some text as a file. CSV gets a UTF-8 BOM so Excel shows Chinese correctly;
 * JSON doesn't, so it can be imported as is later.
 */
export function downloadText(filename: string, text: string, mime: string, { bom = false } = {}): void {
  const blob = new Blob([bom ? `﻿${text}` : text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
