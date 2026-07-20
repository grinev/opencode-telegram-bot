const ACK_REACTIONS = ["👍", "❤", "🔥", "🎉", "😁", "🤩", "👏", "⚡", "🙏", "👌", "💯", "🏆", "❤‍🔥", "🕊", "🤓", "👀", "😇", "🤝", "✍", "🤗", "🫡", "🤪", "🆒", "🦄", "😎", "👾"] as const;

export function pickReactionEmoji(): (typeof ACK_REACTIONS)[number] {
  return ACK_REACTIONS[Math.floor(Math.random() * ACK_REACTIONS.length)];
}
