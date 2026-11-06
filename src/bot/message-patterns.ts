import { GOAL_BUTTON_TEXT_PATTERN } from "./keyboards/goal-button.js";

export { GOAL_BUTTON_TEXT_PATTERN };

export const AGENT_MODE_BUTTON_TEXT_PATTERN = /^(📋|🛠️|💬|🔍|📝|📄|📦|🤖)\s.+\s(?:Mode|Agent)$/;

export const MODEL_BUTTON_TEXT_PATTERN = /^🧠\s(?!.*\s(?:Mode|Agent)$)[\s\S]+$/;

// Keep support for both legacy "💭" and current "💡" prefix.
export const VARIANT_BUTTON_TEXT_PATTERN = /^(💡|💭)\s.+$/;

export const CONTEXT_BUTTON_TEXT_PATTERN = /^📊(?:\s|$)/;

export const QUEUED_PROMPT_BUTTON_TEXT_PATTERN = /^❌\s\d+\.\s/;

const REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS = [
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
  CONTEXT_BUTTON_TEXT_PATTERN,
  QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
  GOAL_BUTTON_TEXT_PATTERN,
];

/**
 * Whether the text looks like a press on one of the reply-keyboard buttons
 * rather than a prompt the user typed.
 */
export function isReplyKeyboardButtonText(text: string): boolean {
  return REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}
