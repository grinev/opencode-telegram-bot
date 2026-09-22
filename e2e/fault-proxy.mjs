#!/usr/bin/env node
/**
 * Fault-injection reverse proxy for the Telegram Bot API.
 *
 * Sits at TELEGRAM_API_ROOT in front of the real Bot API and forwards every call
 * unchanged, unless an active rule matches the call - then the rule's action runs
 * instead: drop the connection, hang, answer with a Bot API error, add latency, or
 * deliver to Telegram and drop the answer. Rules are managed at runtime through the
 * control API under /__fault/. Every call is appended to a per-launch JSON-lines log.
 *
 * Usage:
 *   node e2e/fault-proxy.mjs [--port 8765] [--upstream https://api.telegram.org]
 *                            [--state-dir .tmp/e2e/fault-proxy]
 *
 * See e2e/fault-proxy.md for the control API, the rule shape and the named scenarios.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTROL_PREFIX = "/__fault";
const ACTION_TYPES = new Set(["drop", "hang", "error", "latency", "deliver-then-drop"]);
const SEND_METHODS = ["sendMessage", "sendRichMessage"];

const DEFAULT_ERROR_DESCRIPTIONS = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden: bot was blocked by the user",
  404: "Not Found",
  409: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

const SCENARIOS = {
  "drop-send": () => [{ methods: SEND_METHODS, when: "always", action: { type: "drop" } }],
  blackout: (options) => [
    {
      methods: "*",
      when: "always",
      action: { type: "drop" },
      durationSeconds: options.durationSeconds ?? 90,
    },
  ],
  "no-duplicate": () => [
    { methods: SEND_METHODS, when: "once", action: { type: "deliver-then-drop" } },
  ],
};

function parseArgs(argv) {
  const options = {
    port: 8765,
    upstream: "https://api.telegram.org",
    stateDir: join(projectRoot, ".tmp", "e2e", "fault-proxy"),
  };

  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${name}`);
    }
    index++;

    if (name === "--port") {
      options.port = Number(value);
    } else if (name === "--upstream") {
      options.upstream = value.replace(/\/+$/, "");
    } else if (name === "--state-dir") {
      options.stateDir = resolve(value);
    } else {
      throw new Error(`Unknown option: ${name}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port must be an integer between 0 and 65535");
  }
  new URL(options.upstream);
  return options;
}

function timestampForFileName(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

// --- Rules ------------------------------------------------------------------

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateRule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "rule must be a JSON object";
  }

  const methods = input.methods ?? "*";
  const methodsValid =
    methods === "*" ||
    (typeof methods === "string" && methods.length > 0) ||
    (Array.isArray(methods) &&
      methods.length > 0 &&
      methods.every((method) => typeof method === "string" && method.length > 0));
  if (!methodsValid) {
    return 'methods must be "*", a method name or a non-empty list of method names';
  }

  const when = input.when ?? "always";
  const whenValid =
    when === "always" ||
    when === "once" ||
    (typeof when === "object" &&
      when !== null &&
      ((Number.isInteger(when.every) && when.every > 0) ||
        (Number.isInteger(when.from) && when.from > 0)));
  if (!whenValid) {
    return 'when must be "always", "once", {"every": K} or {"from": N}';
  }

  if (input.payloadContains !== undefined && typeof input.payloadContains !== "string") {
    return "payloadContains must be a string";
  }
  if (input.durationSeconds !== undefined && !isPositiveNumber(input.durationSeconds)) {
    return "durationSeconds must be a positive number";
  }

  const action = typeof input.action === "string" ? { type: input.action } : input.action;
  if (!action || typeof action !== "object" || !ACTION_TYPES.has(action.type)) {
    return `action.type must be one of: ${[...ACTION_TYPES].join(", ")}`;
  }
  if (action.type === "hang" && !isPositiveNumber(action.seconds)) {
    return "hang needs a positive action.seconds";
  }
  if (action.type === "latency" && !isPositiveNumber(action.ms)) {
    return "latency needs a positive action.ms";
  }
  if (action.type === "error") {
    if (!Number.isInteger(action.status) || action.status < 400 || action.status > 599) {
      return "error needs action.status between 400 and 599";
    }
    if (action.description !== undefined && typeof action.description !== "string") {
      return "action.description must be a string";
    }
    if (
      action.retryAfter !== undefined &&
      !(Number.isInteger(action.retryAfter) && action.retryAfter >= 0)
    ) {
      return "action.retryAfter must be a non-negative integer";
    }
  }

  return null;
}

function createRuleStore() {
  let rules = [];
  let nextId = 1;

  function removeExpired(now) {
    rules = rules.filter((rule) => rule.expiresAt === null || rule.expiresAt > now);
  }

  function describe(rule) {
    return {
      id: rule.id,
      methods: rule.methods,
      when: rule.when,
      payloadContains: rule.payloadContains,
      action: rule.action,
      matchedCalls: rule.matchedCalls,
      firedCalls: rule.firedCalls,
      expiresAt: rule.expiresAt === null ? null : new Date(rule.expiresAt).toISOString(),
    };
  }

  function add(input) {
    const now = Date.now();
    const rule = {
      id: `r${nextId++}`,
      methods: input.methods ?? "*",
      when: input.when ?? "always",
      payloadContains: input.payloadContains ?? null,
      action: typeof input.action === "string" ? { type: input.action } : { ...input.action },
      expiresAt: input.durationSeconds ? now + input.durationSeconds * 1000 : null,
      matchedCalls: 0,
      firedCalls: 0,
    };
    rules.push(rule);
    return describe(rule);
  }

  function matchesMethod(rule, method) {
    if (rule.methods === "*") return true;
    if (Array.isArray(rule.methods)) return rule.methods.includes(method);
    return rule.methods === method;
  }

  function shouldFire(rule) {
    const count = rule.matchedCalls;
    if (rule.when === "always") return true;
    if (rule.when === "once") return count === 1;
    if (rule.when.every) return count % rule.when.every === 0;
    return count >= rule.when.from;
  }

  /**
   * Counts the call against every rule it matches and returns the first rule that
   * fires. A payload filter never matches a streamed (multipart) body.
   */
  function select(method, payload) {
    removeExpired(Date.now());
    let selected = null;

    for (const rule of rules) {
      if (!matchesMethod(rule, method)) continue;
      if (
        rule.payloadContains !== null &&
        (payload === null || !payload.includes(rule.payloadContains))
      ) {
        continue;
      }
      rule.matchedCalls++;
      if (selected === null && shouldFire(rule)) {
        rule.firedCalls++;
        selected = rule;
      }
    }

    return selected;
  }

  return {
    add,
    select,
    list() {
      removeExpired(Date.now());
      return rules.map(describe);
    },
    remove(id) {
      const before = rules.length;
      rules = rules.filter((rule) => rule.id !== id);
      return rules.length !== before;
    },
    clear() {
      rules = [];
    },
  };
}

// --- Proxy ------------------------------------------------------------------

function startFaultProxy(options) {
  const upstreamBase = options.upstream.replace(/\/+$/, "");
  const upstreamIsHttps = new URL(upstreamBase).protocol === "https:";
  const upstreamAgent = upstreamIsHttps
    ? new https.Agent({ keepAlive: true })
    : new http.Agent({ keepAlive: true });

  mkdirSync(options.stateDir, { recursive: true });
  const logFile = join(options.stateDir, `calls-${timestampForFileName(new Date())}.jsonl`);
  const pidFile = join(options.stateDir, "proxy.pid");

  const rules = createRuleStore();
  const seenTokens = new Set();
  let stats = {};
  let actualPort = options.port;

  function redact(text) {
    let result = text;
    for (const token of seenTokens) {
      result = result.split(token).join("<token>");
    }
    return result;
  }

  function writeLogLine(entry) {
    appendFileSync(logFile, `${redact(JSON.stringify(entry))}\n`);
  }

  function bumpStat(method, field) {
    stats[method] ??= { calls: 0, injected: 0, reachedUpstream: 0 };
    stats[method][field]++;
  }

  function sendJson(res, status, body) {
    const text = redact(JSON.stringify(body));
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
    });
    res.end(text);
  }

  function readBody(req) {
    return new Promise((resolveBody, rejectBody) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolveBody(Buffer.concat(chunks)));
      req.on("error", rejectBody);
    });
  }

  // --- Control API ----------------------------------------------------------

  async function handleControl(req, res, path) {
    const route = path.slice(CONTROL_PREFIX.length).replace(/\/+$/, "") || "/";
    let body = null;
    const raw = await readBody(req);
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(res, 400, { ok: false, error: "body is not valid JSON" });
        return;
      }
    }

    if (req.method === "GET" && (route === "/" || route === "/state")) {
      sendJson(res, 200, {
        ok: true,
        port: actualPort,
        upstream: upstreamBase,
        logFile,
        rules: rules.list(),
        scenarios: Object.keys(SCENARIOS),
      });
      return;
    }

    if (route === "/rules") {
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, rules: rules.list() });
        return;
      }
      if (req.method === "POST") {
        const error = validateRule(body);
        if (error) {
          sendJson(res, 400, { ok: false, error });
          return;
        }
        sendJson(res, 200, { ok: true, rule: rules.add(body) });
        return;
      }
      if (req.method === "DELETE") {
        rules.clear();
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    const ruleMatch = route.match(/^\/rules\/([^/]+)$/);
    if (ruleMatch && req.method === "DELETE") {
      const removed = rules.remove(ruleMatch[1]);
      sendJson(
        res,
        removed ? 200 : 404,
        removed ? { ok: true } : { ok: false, error: "no such rule" },
      );
      return;
    }

    const scenarioMatch = route.match(/^\/scenarios\/([^/]+)$/);
    if (scenarioMatch && req.method === "POST") {
      const scenario = SCENARIOS[scenarioMatch[1]];
      if (!scenario) {
        sendJson(res, 404, {
          ok: false,
          error: `unknown scenario; known: ${Object.keys(SCENARIOS).join(", ")}`,
        });
        return;
      }
      const scenarioOptions = body ?? {};
      if (
        scenarioOptions.durationSeconds !== undefined &&
        !isPositiveNumber(scenarioOptions.durationSeconds)
      ) {
        sendJson(res, 400, { ok: false, error: "durationSeconds must be a positive number" });
        return;
      }
      const added = scenario(scenarioOptions).map((rule) =>
        rules.add({ durationSeconds: scenarioOptions.durationSeconds, ...rule }),
      );
      sendJson(res, 200, { ok: true, rules: added });
      return;
    }

    if (route === "/stats") {
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, stats });
        return;
      }
      if (req.method === "DELETE") {
        stats = {};
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    sendJson(res, 404, { ok: false, error: "unknown control route" });
  }

  // --- Forwarding -----------------------------------------------------------

  function parseTelegramPath(path) {
    const fileMatch = path.match(/^\/file\/bot([^/]+)\/.+/);
    if (fileMatch) {
      return { token: fileMatch[1], method: "file" };
    }
    const apiMatch = path.match(/^\/bot([^/]+)\/([^/?]+)/);
    if (apiMatch) {
      return { token: apiMatch[1], method: apiMatch[2] };
    }
    return null;
  }

  function isJsonContentType(headers) {
    return String(headers["content-type"] ?? "").includes("application/json");
  }

  function forwardHeaders(headers) {
    const result = { ...headers };
    delete result.host;
    delete result.connection;
    delete result["keep-alive"];
    return result;
  }

  async function handleTelegram(req, res, target) {
    const startedAt = Date.now();
    const { method } = target;
    seenTokens.add(target.token);
    bumpStat(method, "calls");

    // Multipart uploads stream through untouched; every other body is small and is
    // buffered so rules can match on it and the log can record it.
    const streamed = String(req.headers["content-type"] ?? "").startsWith("multipart/");
    const requestBody = streamed ? null : await readBody(req);

    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const payloadText = requestBody === null ? null : requestBody.toString("utf8") + query;
    const rule = rules.select(method, payloadText);
    const action = rule?.action ?? null;
    if (rule) {
      bumpStat(method, "injected");
    }

    const entry = {
      time: new Date(startedAt).toISOString(),
      method,
      path: req.url,
      request: null,
      status: null,
      response: null,
      durationMs: 0,
      injected: rule ? { rule: rule.id, action: action.type } : null,
      reachedUpstream: false,
      error: undefined,
    };
    let streamedBytes = 0;

    const finish = () => {
      entry.durationMs = Date.now() - startedAt;
      if (streamed) {
        entry.request = { streamed: true, bytes: streamedBytes };
      } else if (payloadText !== null && payloadText.length > 0) {
        entry.request = isJsonContentType(req.headers) ? safeJson(requestBody) : payloadText;
      }
      writeLogLine(entry);
    };

    const dropClient = () => {
      req.socket.destroy();
    };

    if (action?.type === "drop") {
      finish();
      dropClient();
      return;
    }

    if (action?.type === "hang") {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        dropClient();
        finish();
      }, action.seconds * 1000);
      req.socket.once("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          entry.error = "client closed during hang";
          finish();
        }
      });
      return;
    }

    if (action?.type === "error") {
      const body = {
        ok: false,
        error_code: action.status,
        description: action.description ?? DEFAULT_ERROR_DESCRIPTIONS[action.status] ?? "Error",
      };
      if (action.retryAfter !== undefined) {
        body.parameters = { retry_after: action.retryAfter };
      }
      entry.status = action.status;
      entry.response = body;
      sendJson(res, action.status, body);
      finish();
      return;
    }

    if (action?.type === "latency") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, action.ms));
    }

    forward(req, res, {
      requestBody,
      entry,
      finish,
      dropAnswer: action?.type === "deliver-then-drop",
      countStreamedBytes: (bytes) => {
        streamedBytes += bytes;
      },
    });
  }

  function forward(req, res, { requestBody, entry, finish, dropAnswer, countStreamedBytes }) {
    const url = new URL(upstreamBase + req.url);
    const transport = upstreamIsHttps ? https : http;
    let finished = false;
    const finishOnce = () => {
      if (!finished) {
        finished = true;
        finish();
      }
    };

    const upstreamReq = transport.request(url, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      agent: upstreamAgent,
    });

    upstreamReq.on("error", (error) => {
      entry.error = `upstream: ${error.message}`;
      req.socket.destroy();
      finishOnce();
    });

    res.on("close", () => {
      if (!res.writableFinished && !dropAnswer) {
        entry.error ??= "client closed before the answer was delivered";
        upstreamReq.destroy();
        finishOnce();
      }
    });

    upstreamReq.on("response", (upstreamRes) => {
      entry.reachedUpstream = true;
      bumpStat(entry.method, "reachedUpstream");
      entry.status = upstreamRes.statusCode;
      const jsonAnswer = isJsonContentType(upstreamRes.headers);
      const chunks = [];
      let responseBytes = 0;

      upstreamRes.on("data", (chunk) => {
        responseBytes += chunk.length;
        if (jsonAnswer) chunks.push(chunk);
      });
      upstreamRes.on("end", () => {
        entry.response = jsonAnswer ? safeJson(Buffer.concat(chunks)) : { bytes: responseBytes };
        if (dropAnswer) {
          req.socket.destroy();
        }
        finishOnce();
      });
      upstreamRes.on("error", (error) => {
        entry.error = `upstream response: ${error.message}`;
        req.socket.destroy();
        finishOnce();
      });

      if (dropAnswer) {
        upstreamRes.resume();
        return;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, forwardHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    });

    if (requestBody === null) {
      // The counter and the pipe attach in the same tick, so no chunk flows before
      // the upstream request is there to take it.
      req.on("data", (chunk) => countStreamedBytes(chunk.length));
      req.pipe(upstreamReq);
    } else {
      upstreamReq.end(requestBody);
    }
  }

  function safeJson(buffer) {
    const text = buffer.toString("utf8");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // --- Server ---------------------------------------------------------------

  async function handleRequest(req, res) {
    const path = (req.url ?? "/").split("?")[0];
    if (path === CONTROL_PREFIX || path.startsWith(`${CONTROL_PREFIX}/`)) {
      await handleControl(req, res, path);
      return;
    }
    const target = parseTelegramPath(path);
    if (!target) {
      sendJson(res, 404, { ok: false, error_code: 404, description: "Not Found" });
      return;
    }
    await handleTelegram(req, res, target);
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: `proxy: ${error.message}` });
      } else {
        req.socket.destroy();
      }
    });
  });

  // The bot keeps pooled keep-alive sockets and long-polls getUpdates for 30 s.
  // The proxy must never close those on its own, or it injects faults nobody asked for.
  server.keepAliveTimeout = 10 * 60 * 1000;
  server.requestTimeout = 0;
  server.headersTimeout = 60 * 1000;

  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(options.port, "127.0.0.1", () => {
      actualPort = server.address().port;
      writeFileSync(pidFile, String(process.pid));
      resolveStart({ server, port: actualPort, logFile, pidFile });
    });
  });
}

// --- Entry point ------------------------------------------------------------

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  let started;
  try {
    started = await startFaultProxy(options);
  } catch (error) {
    process.stderr.write(`Fault proxy failed to start: ${error.message}\n`);
    process.exit(1);
  }

  const removePidFile = () => {
    if (
      existsSync(started.pidFile) &&
      readFileSync(started.pidFile, "utf8").trim() === String(process.pid)
    ) {
      rmSync(started.pidFile, { force: true });
    }
  };
  process.on("exit", removePidFile);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  process.stdout.write(
    `Fault proxy listening on http://127.0.0.1:${started.port} -> ${options.upstream}\n`,
  );
  process.stdout.write(`Call log: ${started.logFile}\n`);
}

main();
