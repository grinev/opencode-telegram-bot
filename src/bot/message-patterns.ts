export const AGENT_BUTTON_TEXT_PATTERN = /^\p{Extended_Pictographic}\uFE0F?\s.+ Mode$/u;

export const MODEL_BUTTON_TEXT_PATTERN = /^🤖\s(?:[^\s/]+\/.+|.+\.\.\.)$/;

// Keep support for both legacy "💭" and current "💡" prefix.
export const VARIANT_BUTTON_TEXT_PATTERN = /^(💡|💭)\s.+$/;
