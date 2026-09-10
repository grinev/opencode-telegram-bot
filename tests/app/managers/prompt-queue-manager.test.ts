import { beforeEach, describe, expect, it } from "#vitest";
import {
  MAX_QUEUED_PROMPTS,
  MAX_QUEUED_MEDIA_BYTES,
  promptQueue,
} from "../../../src/app/managers/prompt-queue-manager.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";

const prompt = createIncomingPrompt;

describe("app/managers/prompt-queue-manager", () => {
  beforeEach(() => {
    promptQueue.__resetForTests();
  });

  it("starts empty", () => {
    expect(promptQueue.size()).toBe(0);
    expect(promptQueue.list()).toEqual([]);
    expect(promptQueue.isFull()).toBe(false);
  });

  it("keeps insertion order", () => {
    promptQueue.add(prompt("first"));
    promptQueue.add(prompt("second"));
    promptQueue.add(prompt("third"));

    expect(promptQueue.list().map((item) => item.text)).toEqual(["first", "second", "third"]);
  });

  it("trims text and rejects blank prompts", () => {
    expect(promptQueue.add(prompt("  spaced  "))?.text).toBe("spaced");
    expect(promptQueue.add(prompt("   "))).toBeNull();
    expect(promptQueue.size()).toBe(1);
  });

  it("rejects prompts beyond the limit", () => {
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      expect(promptQueue.add(prompt(`prompt ${index}`))).not.toBeNull();
    }

    expect(promptQueue.isFull()).toBe(true);
    expect(promptQueue.add(prompt("overflow"))).toBeNull();
    expect(promptQueue.size()).toBe(MAX_QUEUED_PROMPTS);
  });

  it("removes an item from the middle and keeps the rest in order", () => {
    promptQueue.add(prompt("first"));
    const second = promptQueue.add(prompt("second"));
    promptQueue.add(prompt("third"));

    const removed = promptQueue.removeById(second!.id);

    expect(removed?.text).toBe("second");
    expect(promptQueue.list().map((item) => item.text)).toEqual(["first", "third"]);
  });

  it("returns null when removing an unknown id", () => {
    promptQueue.add(prompt("first"));

    expect(promptQueue.removeById("queued-999")).toBeNull();
    expect(promptQueue.size()).toBe(1);
  });

  it("releases raw media bytes when an item is removed", () => {
    const queued = promptQueue.add({
      ...prompt("photo"),
      mediaBytes: MAX_QUEUED_MEDIA_BYTES - 1,
    });

    promptQueue.removeById(queued!.id);

    expect(promptQueue.mediaSize()).toBe(0);
    expect(promptQueue.canAcceptMedia(MAX_QUEUED_MEDIA_BYTES)).toBe(true);
  });

  it("takes prompts in FIFO order", () => {
    promptQueue.add(prompt("first"));
    promptQueue.add(prompt("second"));

    expect(promptQueue.takeNext()?.text).toBe("first");
    expect(promptQueue.takeNext()?.text).toBe("second");
    expect(promptQueue.takeNext()).toBeNull();
  });

  it("keeps deferred photo inputs with their queued prompt", () => {
    const photo = { fileId: "photo-1", filename: "rich.jpg", source: "rich" as const };

    promptQueue.add(createIncomingPrompt("", { photos: [photo] }));

    expect(promptQueue.takeNext()).toEqual({
      id: "queued-1",
      text: "",
      fileParts: [],
      photos: [photo],
      displayText: "[Attachment]",
      mediaBytes: 0,
    });
  });

  it("caps aggregate raw media bytes and releases them when an item is dequeued", () => {
    const underCap = MAX_QUEUED_MEDIA_BYTES - 1;
    expect(promptQueue.add({ ...prompt("album one"), mediaBytes: underCap })).not.toBeNull();
    expect(promptQueue.canAcceptMedia(2)).toBe(false);
    expect(promptQueue.add({ ...prompt("album two"), mediaBytes: 2 })).toBeNull();

    promptQueue.takeNext();

    expect(promptQueue.mediaSize()).toBe(0);
    expect(promptQueue.add({ ...prompt("album two"), mediaBytes: 2 })).not.toBeNull();
  });

  it("frees a slot after taking a prompt", () => {
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      promptQueue.add(prompt(`prompt ${index}`));
    }

    promptQueue.takeNext();

    expect(promptQueue.isFull()).toBe(false);
    expect(promptQueue.add(prompt("late"))).not.toBeNull();
  });

  it("clears every queued prompt", () => {
    promptQueue.add(prompt("first"));
    promptQueue.add(prompt("second"));

    promptQueue.clear("test");

    expect(promptQueue.size()).toBe(0);
  });

  it("returns copies so callers cannot mutate the queue", () => {
    promptQueue.add(prompt("first"));

    const items = promptQueue.list();
    const firstCopy = items[0];
    if (!firstCopy) {
      throw new Error("Expected queued prompt copy");
    }
    firstCopy.text = "mutated";

    expect(promptQueue.list()[0]?.text).toBe("first");
  });
});
