import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

export const GATEWAY_SECRET_HEADER = "x-gateway-secret";

export function hasValidGatewaySecret(req: IncomingMessage, expectedSecret: string): boolean {
  const header = req.headers[GATEWAY_SECRET_HEADER];
  if (typeof header !== "string") {
    return false;
  }

  const received = crypto.createHash("sha256").update(header).digest();
  const expected = crypto.createHash("sha256").update(expectedSecret).digest();
  return crypto.timingSafeEqual(received, expected);
}
