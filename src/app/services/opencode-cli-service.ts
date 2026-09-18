import { logger } from "../../utils/logger.js";
import { spawn } from "child_process";
import { config } from "../../config.js";

export interface OpencodeCliResult {
  success: boolean;
  text: string;
  error?: string;
}

/**
 * Reads all data from a stream and returns it as a string.
 */
function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

/**
 * Executes opencode CLI with the given prompt and returns the result.
 * Uses `opencode run --format json` to get structured output.
 */
export async function executeOpencodeCli(
  prompt: string,
  options: {
    directory?: string;
    model?: string;
    agent?: string;
    sessionId?: string;
    continueSession?: boolean;
  } = {}
): Promise<OpencodeCliResult> {
  const args = ["run", "--format", "json"];

  if (options.directory) {
    args.push("--dir", options.directory);
  }

  if (options.model) {
    args.push("-m", options.model);
  }

  if (options.agent) {
    args.push("--agent", options.agent);
  }

  if (options.sessionId) {
    args.push("-s", options.sessionId);
  }

  if (options.continueSession) {
    args.push("-c");
  }

  if (config.opencode.username) {
    args.push("-u", config.opencode.username);
  }
  if (config.opencode.password) {
    args.push("-p", config.opencode.password);
  }

  // Add the prompt as the last argument
  args.push(prompt);

  logger.debug(`[OpencodeCLI] Executing: opencode ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = spawn("opencode", args, {
      cwd: options.directory || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let resolved = false;

    const stdoutPromise = readStream(child.stdout);
    const stderrPromise = readStream(child.stderr);

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        logger.error(`[OpencodeCLI] Spawn error: ${err.message}`);
        resolve({
          success: false,
          text: "",
          error: `Failed to start opencode: ${err.message}`,
        });
      }
    });

    child.on("exit", async (exitCode) => {
      if (resolved) return;
      resolved = true;

      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

      logger.debug(`[OpencodeCLI] Exit code: ${exitCode}`);
      logger.debug(`[OpencodeCLI] Stdout: ${stdout}`);
      logger.debug(`[OpencodeCLI] Stderr: ${stderr}`);

      if (exitCode !== 0) {
        const errorMsg = stderr || stdout || `opencode CLI exited with code ${exitCode}`;
        logger.error(`[OpencodeCLI] Error (code ${exitCode}): ${errorMsg}`);
        resolve({
          success: false,
          text: "",
          error: errorMsg,
        });
        return;
      }

      // Parse JSON output from opencode
      try {
        const lines = stdout.trim().split("\n").filter((line) => line.trim());
        let finalText = "";

        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            // Handle different event types that contain the assistant's text response
            if (event.type === "text" && event.part?.text) {
              finalText = event.part.text;
            } else if (event.type === "assistant" && event.message?.content) {
              for (const part of event.message.content) {
                if (part.type === "text") {
                  finalText += part.text;
                }
              }
            } else if (event.type === "result" && event.text) {
              finalText = event.text;
            }
          } catch {
            // Not a JSON line, skip
          }
        }

        if (!finalText && lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          if (lastLine !== undefined) {
            try {
              const lastEvent = JSON.parse(lastLine);
              if (lastEvent.part?.text) {
                finalText = lastEvent.part.text;
              } else if (lastEvent.text) {
                finalText = lastEvent.text;
              }
            } catch {
              finalText = stdout.trim();
            }
          }
        }

        resolve({
          success: true,
          text: finalText || stdout.trim(),
        });
      } catch (err) {
        logger.error("[OpencodeCLI] Failed to parse output:", err);
        resolve({
          success: false,
          text: "",
          error: `Failed to parse opencode output: ${err instanceof Error ? err.message : "unknown error"}`,
        });
      }
    });
  });
}

/**
 * Checks if opencode CLI is available in PATH.
 */
export async function isOpencodeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("opencode", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}