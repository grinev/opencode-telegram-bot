import { beforeEach, describe, expect, it, vi } from "vitest";
import { telegramInputOrderManager } from "../../../src/app/managers/telegram-input-order-manager.js";

describe("app/managers/telegram-input-order-manager", () => {
  beforeEach(() => {
    telegramInputOrderManager.__resetForTests();
  });

  it("holds later text until every earlier album message is released", async () => {
    telegramInputOrderManager.defer(777, 10);
    telegramInputOrderManager.defer(777, 11);
    const released = vi.fn();
    const waiting = telegramInputOrderManager.waitForEarlier(777, 12).then(released);

    await Promise.resolve();
    expect(released).not.toHaveBeenCalled();

    telegramInputOrderManager.release(777, 10);
    await Promise.resolve();
    expect(released).not.toHaveBeenCalled();

    telegramInputOrderManager.release(777, 11);
    await waiting;
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("does not let a deferred later update block earlier text", async () => {
    telegramInputOrderManager.defer(777, 12);

    await expect(telegramInputOrderManager.waitForEarlier(777, 11)).resolves.toBeUndefined();
  });

});
