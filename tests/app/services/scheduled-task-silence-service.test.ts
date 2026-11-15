import { describe, expect, it } from "vitest";
import { isScheduledTaskSilentResult } from "../../../src/app/services/scheduled-task-silence-service.js";

describe("app/services/scheduled-task-silence-service", () => {
  it.each([
    "[SILENT]",
    " \n[sIlEnT]\t ",
    "[SILENT]No changes",
    `[silent]${"long response ".repeat(100)}`,
    "\n**[SILENT]**\n\nNo changes.\n",
    "\nNo changes.\n\n_[silent]_\n",
    "([SILENT])",
    "【[SILENT]】",
    "# [SILENT]",
    "- [SILENT]",
    "**[SILENT]**",
    "[SILENT]]",
    `${"*".repeat(28)}[SILENT]${"*".repeat(28)}`,
    `${"\u{10100}".repeat(28)}[SILENT]${"\u{10100}".repeat(28)}`,
    "\u001c\u0085[silent]\u001f",
    "\u001c**[SILENT]**\u001f\r\nReport",
    "Report\r\n\r\n**[SILENT]**\r\n",
    "Report\r**[SILENT]**",
    "Report\v**[SILENT]**",
    "Report\f**[SILENT]**",
    "Report\u001c**[SILENT]**",
    "Report\u001d**[SILENT]**",
    "Report\u001e**[SILENT]**",
    "Report\u0085**[SILENT]**",
    "Report\u2028**[SILENT]**",
    "Report\u2029**[SILENT]**",
    "Report\n** [SILENT] **",
    `Report\n**[SILENT]**\n${"body".repeat(100)}\n_[SILENT]_`,
  ])("suppresses the entire result for %j", (text) => {
    expect(isScheduledTaskSilentResult(text)).toBe(true);
  });

  it.each([
    "",
    " \r\n\t ",
    "OK",
    "No changes.",
    "No changes. [SILENT]",
    "First line\n[SILENT]\nLast line",
    "**[SILENT]** No changes.",
    "`[SILENT]`",
    "```\n[SILENT]\n```",
    "~~~\n[SILENT]\n~~~",
    "~~[SILENT]~~",
    "[SILENT",
    "SILENT]",
    "[[SILENT]]",
    "[ SILENT ]",
    "[  SILENT  ]",
    "[SILENT.]",
    "SILENT",
    "NO_REPLY",
    "NO REPLY",
    "[静默]",
    "[SILENCE]",
    `${"*".repeat(29)}[SILENT]${"*".repeat(28)}`,
    `${"\u{10100}".repeat(29)}[SILENT]${"\u{10100}".repeat(28)}`,
    "\ufeff[SILENT]",
    "Report\u001f[SILENT]",
    "Report\n** *[SILENT]* **",
  ])("does not suppress an ordinary or invalid marker result %j", (text) => {
    expect(isScheduledTaskSilentResult(text)).toBe(false);
  });
});
