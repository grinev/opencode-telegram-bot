import type { MessageEntity } from "grammy/types";
import type { InlineNode } from "./types.js";
import {
  isLoopbackTelegramHttpUrl,
  isValidTelegramTextLinkUrl,
  validateTelegramEntities,
} from "./validator.js";

export interface InlineRenderResult {
  text: string;
  entities: MessageEntity[];
}

const ENTITY_TYPE_PRIORITY: Record<MessageEntity["type"], number> = {
  bold: 1,
  italic: 2,
  underline: 3,
  strikethrough: 4,
  spoiler: 5,
  code: 6,
  text_link: 7,
  mention: 100,
  hashtag: 101,
  cashtag: 102,
  bot_command: 103,
  url: 104,
  email: 105,
  phone_number: 106,
  blockquote: 107,
  expandable_blockquote: 108,
  pre: 109,
  text_mention: 110,
  custom_emoji: 111,
};

interface InlineRenderState {
  text: string;
  entities: MessageEntity[];
}

function appendText(state: InlineRenderState, text: string): void {
  if (!text) {
    return;
  }

  state.text += text;
}

function pushEntity(state: InlineRenderState, entity: MessageEntity): void {
  if (entity.length <= 0) {
    return;
  }

  state.entities.push(entity);
}

function isLocalReferenceUrl(url: string): boolean {
  return url.startsWith("#") || url.startsWith("/") || url.startsWith("./") || url.startsWith("../");
}

function appendPlainLinkTarget(state: InlineRenderState, offset: number, url: string): void {
  if (!url || state.text.slice(offset) === url) {
    return;
  }

  appendText(state, ` (${url})`);
}

function renderIntoState(state: InlineRenderState, nodes: InlineNode[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        appendText(state, node.text);
        break;
      case "bold": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "bold", offset, length: state.text.length - offset });
        break;
      }
      case "italic": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "italic", offset, length: state.text.length - offset });
        break;
      }
      case "strike": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, {
          type: "strikethrough",
          offset,
          length: state.text.length - offset,
        });
        break;
      }
      case "underline": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "underline", offset, length: state.text.length - offset });
        break;
      }
      case "spoiler": {
        const offset = state.text.length;
        renderIntoState(state, node.children);
        pushEntity(state, { type: "spoiler", offset, length: state.text.length - offset });
        break;
      }
      case "code": {
        const offset = state.text.length;
        appendText(state, node.text);
        pushEntity(state, { type: "code", offset, length: state.text.length - offset });
        break;
      }
      case "link": {
        const offset = state.text.length;
        renderIntoState(state, node.text);
        if (!isValidTelegramTextLinkUrl(node.url)) {
          if (isLocalReferenceUrl(node.url) || isLoopbackTelegramHttpUrl(node.url)) {
            appendPlainLinkTarget(state, offset, node.url);
            break;
          }
        }

        pushEntity(state, {
          type: "text_link",
          offset,
          length: state.text.length - offset,
          url: node.url,
        });
        break;
      }
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }
}

function compareEntities(left: MessageEntity, right: MessageEntity): number {
  if (left.offset !== right.offset) {
    return left.offset - right.offset;
  }

  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return ENTITY_TYPE_PRIORITY[left.type] - ENTITY_TYPE_PRIORITY[right.type];
}

export function renderInlineNodes(nodes: InlineNode[]): InlineRenderResult {
  const state: InlineRenderState = {
    text: "",
    entities: [],
  };

  renderIntoState(state, nodes);
  state.entities.sort(compareEntities);

  return {
    text: state.text,
    entities: state.entities,
  };
}

export function renderInlineNodesValidated(nodes: InlineNode[]): InlineRenderResult {
  const rendered = renderInlineNodes(nodes);
  const validation = validateTelegramEntities(rendered.text, rendered.entities);

  if (!validation.ok) {
    const summary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid Telegram inline entities: ${summary}`);
  }

  return rendered;
}
