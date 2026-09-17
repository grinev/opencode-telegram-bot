import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config } from "../config.js";
import type { BotOpenCodeClient } from "./types.js";
import { createV2Client } from "./v2-client.js";

const getAuth = () => {
  if (!config.opencode.password) {
    return undefined;
  }
  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

const options = {
  baseUrl: config.opencode.apiUrl,
  headers: config.opencode.password ? { Authorization: getAuth()! } : undefined,
};

export const opencodeClient: BotOpenCodeClient = config.opencode.apiV2Enabled
  ? createV2Client(options)
  : createOpencodeClient(options);
