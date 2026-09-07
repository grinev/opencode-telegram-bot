import { randomUUID } from "node:crypto";

export function createOpencodeMessageId(): string {
  return `msg_${randomUUID()}`;
}
