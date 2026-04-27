import { describe, expect, it } from "vitest";

import {
  createOpencodeServeSpawnCommand,
  findUnixListeningPidInSs,
  findWindowsListeningPidInNetstat,
} from "../../src/opencode/process.js";

describe("opencode/process", () => {
  it("matches the exact local port on Windows netstat output", async () => {
    const stdout = [
      "  TCP    127.0.0.1:40960      0.0.0.0:0      LISTENING       1111",
      "  TCP    127.0.0.1:4096       0.0.0.0:0      LISTENING       2222",
    ].join("\r\n");

    expect(findWindowsListeningPidInNetstat(stdout, 4096)).toBe(2222);
  });

  it("matches the exact local port in ss fallback output", async () => {
    const stdout = [
      'LISTEN 0 128 127.0.0.1:40960 0.0.0.0:* users:(("node",pid=1111,fd=17))',
      'LISTEN 0 128 127.0.0.1:4096 0.0.0.0:* users:(("opencode",pid=2222,fd=18))',
    ].join("\n");

    expect(findUnixListeningPidInSs(stdout, 4096)).toBe(2222);
  });

  it("builds opencode serve command with the configured local port", () => {
    const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 });

    if (process.platform === "win32") {
      expect(command).toEqual({
        command: "cmd.exe",
        args: ["/c", "opencode", "serve", "--port", "4987"],
        windowsHide: true,
      });
      return;
    }

    expect(command).toEqual({
      command: "opencode",
      args: ["serve", "--port", "4987"],
      windowsHide: false,
    });
  });
});
