import { customAlphabet } from "nanoid";

// Uppercase alnum, no 0/O/1/I so codes are easy to read/say/type over
// Discord. Longer than the old room codes since this is a standing secret
// (gates every new signup) rather than a short-lived per-match code.
const generate = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

export function generateInviteCode(): string {
  return generate();
}
