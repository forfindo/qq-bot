export function btoa(input: Buffer | string) {
  return Buffer.from(input).toString('base64');
}
