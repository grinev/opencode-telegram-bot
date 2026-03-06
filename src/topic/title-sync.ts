import { logger } from "../utils/logger.js";
import { getTopicBindingBySessionId, updateTopicBindingNameBySessionId } from "./manager.js";
import { formatTopicTitle } from "./title-format.js";

interface TopicEditApi {
  editForumTopic: (
    chatId: number,
    messageThreadId: number,
    payload: { name: string },
  ) => Promise<unknown>;
}

export async function syncTopicTitleForSession(
  api: TopicEditApi,
  sessionId: string,
  sessionTitle: string,
): Promise<boolean> {
  const binding = getTopicBindingBySessionId(sessionId);
  if (!binding) {
    return false;
  }

  const topicName = formatTopicTitle(sessionTitle);
  if (!topicName || binding.topicName === topicName) {
    return false;
  }

  await api.editForumTopic(binding.chatId, binding.threadId, { name: topicName });
  updateTopicBindingNameBySessionId(sessionId, topicName);

  logger.info(
    `[TopicTitle] Synced topic title for session ${sessionId}: thread=${binding.threadId}, title=${topicName}`,
  );

  return true;
}
