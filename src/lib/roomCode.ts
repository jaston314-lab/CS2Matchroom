import { customAlphabet } from "nanoid";

// Uppercase alnum, no 0/O/1/I so codes are easy to read/say/type over Discord.
const generate = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 6);

export function generateRoomCode(): string {
  return generate();
}
