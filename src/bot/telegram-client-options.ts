// @ts-expect-error — node-fetch v2 ships no TS types and we avoid adding @types/node-fetch
import nodeFetch from "node-fetch";
import { Agent as HttpsAgent } from "https";
import type { Bot, Context } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { logger } from "../utils/logger.js";

export interface TelegramClientConfig {
  apiRoot: string;
  proxySecret: string;
  proxyUrl: string;
  forceIpv4: boolean;
}

export type TelegramBotOptions = NonNullable<ConstructorParameters<typeof Bot<Context>>[1]>;

export function createTelegramIpv4Agent(): HttpsAgent {
  return new HttpsAgent({ family: 4, keepAlive: true });
}

export function createTelegramBotOptions(telegram: TelegramClientConfig): TelegramBotOptions {
  const botOptions: TelegramBotOptions = {};

  if (telegram.apiRoot || telegram.proxySecret) {
    botOptions.client = botOptions.client ?? {};
    if (telegram.apiRoot) {
      botOptions.client.apiRoot = telegram.apiRoot;
      logger.info(`[Bot] Using custom Telegram API root: ${telegram.apiRoot}`);
    }
    if (telegram.proxySecret) {
      // Inject the shared-secret header via a custom fetch wrapper instead of
      // baseFetchConfig.headers, because grammY's client spreads
      // `{...baseFetchConfig, ...config}` and the per-request config.headers
      // (Content-Type/Length) wipes out anything we put on baseFetchConfig.
      // Plain-object headers merge (not the Headers class) keeps this compatible
      // with node-fetch v2's init shape and avoids the DOM lib HeadersInit type.
      const proxySecret = telegram.proxySecret;
      botOptions.client.fetch = (((url: unknown, init: Record<string, unknown> | undefined) => {
        const existing = (init?.headers as Record<string, string> | undefined) ?? {};
        const merged = { ...existing, "X-Proxy-Secret": proxySecret };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (nodeFetch as any)(url, { ...(init ?? {}), headers: merged });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
      logger.info(`[Bot] Sending X-Proxy-Secret header to Telegram API root`);
    }
  }

  if (telegram.proxyUrl) {
    const proxyUrl = telegram.proxyUrl;
    let agent;

    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl);
      logger.info(`[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    } else {
      agent = new HttpsProxyAgent(proxyUrl);
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    }

    botOptions.client = botOptions.client ?? {};
    botOptions.client.baseFetchConfig = {
      agent,
      compress: true,
    };
  } else if (telegram.forceIpv4) {
    botOptions.client = botOptions.client ?? {};
    botOptions.client.baseFetchConfig = {
      ...(botOptions.client.baseFetchConfig ?? {}),
      agent: createTelegramIpv4Agent(),
      compress: true,
    };
    logger.info(`[Bot] Forcing IPv4 for Telegram API requests`);
  }

  return botOptions;
}
