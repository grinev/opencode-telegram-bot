import type { FavoriteModel } from "../types/model.js";

// Only recognize standard text IDs on known routes. Custom provider/model aliases and
// non-text models remain owned by the user's OpenCode configuration.
function miniMaxModelID(model: FavoriteModel): string | null {
  if (model.providerID === "minimax" || model.providerID === "minimax-cn") {
    return model.modelID;
  }
  if (model.providerID === "opencode") {
    return model.modelID;
  }
  if (model.providerID === "openrouter" && model.modelID.startsWith("minimax/")) {
    return model.modelID.slice("minimax/".length);
  }
  return null;
}

function miniMaxChoiceRank(model: FavoriteModel): number {
  const id = miniMaxModelID(model);
  if (id === null) {
    return 2;
  }
  const flashID =
    model.providerID === "opencode"
      ? "minimax-m3.1-flash-free"
      : model.providerID === "openrouter"
        ? "minimax-m3.1-flash:free"
        : "MiniMax-M3.1-Flash";
  const m3ID =
    model.providerID === "opencode" || model.providerID === "openrouter"
      ? "minimax-m3"
      : "MiniMax-M3";
  return id === flashID ? 0 : id === m3ID ? 1 : 2;
}

export function isOrdinaryMiniMaxChoice(model: FavoriteModel): boolean {
  const id = miniMaxModelID(model);
  if (id === null || miniMaxChoiceRank(model) < 2) {
    return true;
  }
  // Match standard text families, not arbitrary custom names or media model IDs.
  return !/^minimax-(?:m\d+(?:\.\d+)?(?:-(?:highspeed|lightning|preview|free|80k|flash(?:-free)?))?(?::free)?|text-01)$/i.test(
    id,
  );
}

export function compareMiniMaxChoices(a: FavoriteModel, b: FavoriteModel): number {
  return a.providerID === b.providerID ? miniMaxChoiceRank(a) - miniMaxChoiceRank(b) : 0;
}
