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
