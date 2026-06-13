import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";

async function createTempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-telegram-bot-logger-"));
}

async function loadLoggerModule() {
  vi.resetModules();
  return import("../../src/utils/logger.js");
}

describe("utils/logger", () => {
  it("uses info level until LOG_LEVEL is loaded into env", async () => {
    const consoleLogMock = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("LOG_LEVEL", "");

    const { logger, __resetLoggerForTests } = await loadLoggerModule();

    logger.debug("before env");
    expect(consoleLogMock).not.toHaveBeenCalled();

    vi.stubEnv("LOG_LEVEL", "debug");
    logger.debug("after env");

    expect(consoleLogMock).toHaveBeenCalledOnce();
    __resetLoggerForTests();
  });

  it("writes one log file per launch in sources mode", async () => {
    const tempHome = await createTempHome();
    const consoleLogMock = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:34:56.000Z"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("sources");

    const {
      initializeLogger,
      logger,
      getLogFilePath,
      __flushLoggerForTests,
      __resetLoggerForTests,
    } = await loadLoggerModule();

    await initializeLogger();
    logger.info("sources log", { scope: "test" });
    await __flushLoggerForTests();

    const expectedPath = path.join(tempHome, "logs", `bot-2026-04-11_12-34-56_${process.pid}.log`);
    expect(getLogFilePath()).toBe(expectedPath);

    const content = await fs.readFile(expectedPath, "utf-8");
    expect(content).toContain("[INFO] sources log { scope: 'test' }");
    expect(consoleLogMock).toHaveBeenCalledOnce();

    __resetLoggerForTests();
  });

  it("reuses the same launch log file on repeated initialization in sources mode", async () => {
    const tempHome = await createTempHome();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:34:56.000Z"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("sources");

    const {
      initializeLogger,
      getLogFilePath,
      logger,
      __flushLoggerForTests,
      __resetLoggerForTests,
    } = await loadLoggerModule();

    await initializeLogger();
    const firstPath = getLogFilePath();

    vi.setSystemTime(new Date("2026-04-11T12:35:01.000Z"));
    await initializeLogger();
    logger.info("same file");
    await __flushLoggerForTests();

    const secondPath = getLogFilePath();
    const logFiles = (await fs.readdir(path.join(tempHome, "logs"))).sort();

    expect(secondPath).toBe(firstPath);
    expect(logFiles).toEqual([`bot-2026-04-11_12-34-56_${process.pid}.log`]);

    __resetLoggerForTests();
  });

  it("writes installed mode logs into the daily file", async () => {
    const tempHome = await createTempHome();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:34:56.000Z"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("installed");

    const {
      initializeLogger,
      logger,
      getLogFilePath,
      __flushLoggerForTests,
      __resetLoggerForTests,
    } = await loadLoggerModule();

    await initializeLogger();
    logger.info("first line");
    logger.warn("second line");
    await __flushLoggerForTests();

    const expectedPath = path.join(tempHome, "logs", "bot-2026-04-11.log");
    expect(getLogFilePath()).toBe(expectedPath);

    const content = await fs.readFile(expectedPath, "utf-8");
    expect(content).toContain("[INFO] first line");
    expect(content).toContain("[WARN] second line");

    __resetLoggerForTests();
  });

  it("rotates installed mode logs when the date changes", async () => {
    const tempHome = await createTempHome();
    const logsDirPath = path.join(tempHome, "logs");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T23:59:59.000Z"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_RETENTION", "10");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("installed");

    const {
      initializeLogger,
      logger,
      getLogFilePath,
      __flushLoggerForTests,
      __resetLoggerForTests,
    } = await loadLoggerModule();

    await initializeLogger();
    logger.info("before midnight");
    await __flushLoggerForTests();

    const firstPath = path.join(logsDirPath, "bot-2026-04-11.log");
    expect(getLogFilePath()).toBe(firstPath);

    vi.setSystemTime(new Date("2026-04-12T00:00:01.000Z"));
    logger.info("after midnight");
    logger.warn("same new day");
    await __flushLoggerForTests();

    const secondPath = path.join(logsDirPath, "bot-2026-04-12.log");
    expect(getLogFilePath()).toBe(secondPath);

    const firstContent = await fs.readFile(firstPath, "utf-8");
    const secondContent = await fs.readFile(secondPath, "utf-8");
    const logFiles = (await fs.readdir(logsDirPath)).sort();

    expect(firstContent).toContain("[INFO] before midnight");
    expect(firstContent).not.toContain("after midnight");
    expect(secondContent).toContain("[INFO] after midnight");
    expect(secondContent).toContain("[WARN] same new day");
    expect(logFiles).toEqual(["bot-2026-04-11.log", "bot-2026-04-12.log"]);

    __resetLoggerForTests();
  });

  it("cleans up old installed logs after date rotation", async () => {
    const tempHome = await createTempHome();
    const logsDirPath = path.join(tempHome, "logs");

    await fs.mkdir(logsDirPath, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-09.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-10.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "notes.txt"), "keep\n"),
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T23:59:59.000Z"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_RETENTION", "2");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("installed");

    const { initializeLogger, logger, __flushLoggerForTests, __resetLoggerForTests } =
      await loadLoggerModule();

    await initializeLogger();
    logger.info("before midnight");
    await __flushLoggerForTests();

    vi.setSystemTime(new Date("2026-04-12T00:00:01.000Z"));
    logger.info("after midnight");
    await __flushLoggerForTests();

    const remainingFiles = (await fs.readdir(logsDirPath)).sort();
    expect(remainingFiles).toEqual(["bot-2026-04-11.log", "bot-2026-04-12.log", "notes.txt"]);

    __resetLoggerForTests();
  });

  it("keeps only the latest launch log files in sources mode", async () => {
    const tempHome = await createTempHome();
    const logsDirPath = path.join(tempHome, "logs");

    await fs.mkdir(logsDirPath, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-08_01-00-00_1.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-09_01-00-00_1.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-10_01-00-00_1.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "custom.log"), "keep\n"),
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:34:56.000Z"));
    vi.stubEnv("LOG_RETENTION", "2");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("sources");

    const { initializeLogger, __flushLoggerForTests, __resetLoggerForTests } =
      await loadLoggerModule();

    await initializeLogger();
    await __flushLoggerForTests();

    const remainingFiles = (await fs.readdir(logsDirPath)).sort();
    expect(remainingFiles).toEqual([
      `bot-2026-04-10_01-00-00_1.log`,
      `bot-2026-04-11_12-34-56_${process.pid}.log`,
      "custom.log",
    ]);

    __resetLoggerForTests();
  });

  it("keeps only the latest daily log files in installed mode", async () => {
    const tempHome = await createTempHome();
    const logsDirPath = path.join(tempHome, "logs");

    await fs.mkdir(logsDirPath, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-08.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-09.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-10.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "notes.txt"), "keep\n"),
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:34:56.000Z"));
    vi.stubEnv("LOG_RETENTION", "2");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("installed");

    const { initializeLogger, __flushLoggerForTests, __resetLoggerForTests } =
      await loadLoggerModule();

    await initializeLogger();
    await __flushLoggerForTests();

    const remainingFiles = (await fs.readdir(logsDirPath)).sort();
    expect(remainingFiles).toEqual(["bot-2026-04-10.log", "bot-2026-04-11.log", "notes.txt"]);

    __resetLoggerForTests();
  });
});
