const tokens = (value: string): string[] => value.normalize("NFC").toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
export function localSearchMatches(query: string, ...fields: string[]): boolean {
  const wanted = tokens(query);
  if (wanted.length > 12) return false;
  const available = fields.flatMap(tokens);
  return wanted.every(term => available.some(word => word.startsWith(term)));
}
