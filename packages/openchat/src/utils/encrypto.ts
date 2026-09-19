export function btoa(input: Buffer | string) {
  return Buffer.from(input).toString('base64');
}

export function checksum(content: string): string | undefined {
  if (!content) {
    return void 0;
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function decodeDataUrl(url: string) {
  const idx = url.indexOf(',');
  if (idx === -1) {
    return '';
  }

  const head = url.slice(0, idx);
  const body = url.slice(idx + 1);
  if (head.includes(';base64')) {
    return Buffer.from(body, 'base64').toString('utf8');
  }
  return decodeURIComponent(body);
}
