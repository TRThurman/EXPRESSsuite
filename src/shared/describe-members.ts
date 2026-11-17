/* The members step of Describe Declaration, without vscode imports so it can be tested. */

/**
 * The parameter or item keys to ask text for, and those already described (ruling R13): a member
 * whose own block exists is not asked for, so its block is only ever written as a new one; to change
 * it, the author describes the member itself. Keys compare without regard to case; role blocks
 * (`.__note`, ...) do not count as a description.
 */
export function splitMembers(members: readonly string[], existing: readonly string[]): { ask: string[]; described: string[] } {
  const described = new Set(existing.map((key) => key.toLowerCase()));
  const result: { ask: string[]; described: string[] } = { ask: [], described: [] };
  for (const key of members) (described.has(key.toLowerCase()) ? result.described : result.ask).push(key);
  return result;
}
