function write(level: "INFO" | "WARN" | "ERROR", message: string, error?: unknown): void {
  const suffix = error === undefined ? "" : ` ${error instanceof Error ? error.message : String(error)}`;
  process.stderr.write(`[Gateway] ${level} ${message}${suffix}\n`);
}

export const logger = {
  info(message: string): void {
    write("INFO", message);
  },
  warn(message: string, error?: unknown): void {
    write("WARN", message, error);
  },
  error(message: string, error?: unknown): void {
    write("ERROR", message, error);
  },
};
