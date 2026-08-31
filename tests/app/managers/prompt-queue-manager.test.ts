import { beforeEach, describe, expect, it } from "#vitest";
import {
  MAX_QUEUED_PROMPTS,
  promptQueue,
} from "../../../src/app/managers/prompt-queue-manager.js";

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
    promptQueue.add("first");
    promptQueue.add("second");
    promptQueue.add("third");

    expect(promptQueue.list().map((item) => item.text)).toEqual(["first", "second", "third"]);
  });

  it("trims text and rejects blank prompts", () => {
    expect(promptQueue.add("  spaced  ")?.text).toBe("spaced");
    expect(promptQueue.add("   ")).toBeNull();
    expect(promptQueue.size()).toBe(1);
  });

  it("rejects prompts beyond the limit", () => {
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      expect(promptQueue.add(`prompt ${index}`)).not.toBeNull();
    }

    expect(promptQueue.isFull()).toBe(true);
    expect(promptQueue.add("overflow")).toBeNull();
    expect(promptQueue.size()).toBe(MAX_QUEUED_PROMPTS);
  });

  it("removes an item from the middle and keeps the rest in order", () => {
    promptQueue.add("first");
    const second = promptQueue.add("second");
    promptQueue.add("third");

    const removed = promptQueue.removeById(second!.id);

    expect(removed?.text).toBe("second");
    expect(promptQueue.list().map((item) => item.text)).toEqual(["first", "third"]);
  });

  it("returns null when removing an unknown id", () => {
    promptQueue.add("first");

    expect(promptQueue.removeById("queued-999")).toBeNull();
    expect(promptQueue.size()).toBe(1);
  });

  it("takes prompts in FIFO order", () => {
    promptQueue.add("first");
    promptQueue.add("second");

    expect(promptQueue.takeNext()?.text).toBe("first");
    expect(promptQueue.takeNext()?.text).toBe("second");
    expect(promptQueue.takeNext()).toBeNull();
  });

  it("frees a slot after taking a prompt", () => {
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      promptQueue.add(`prompt ${index}`);
    }

    promptQueue.takeNext();

    expect(promptQueue.isFull()).toBe(false);
    expect(promptQueue.add("late")).not.toBeNull();
  });

  it("clears every queued prompt", () => {
    promptQueue.add("first");
    promptQueue.add("second");

    promptQueue.clear("test");

    expect(promptQueue.size()).toBe(0);
  });

  it("returns copies so callers cannot mutate the queue", () => {
    promptQueue.add("first");

    const items = promptQueue.list();
    const firstCopy = items[0];
    if (!firstCopy) {
      throw new Error("Expected queued prompt copy");
    }
    firstCopy.text = "mutated";

    expect(promptQueue.list()[0]?.text).toBe("first");
  });
});
