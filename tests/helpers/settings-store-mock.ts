/**
 * Complete settings-store mock factory.
 *
 * Returns a full export map of #src/app/stores/settings-store.ts where every
 * function is a vi.fn() stub. Tests pass this as the factory to vi.mock:
 *
 *   import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
 *   vi.mock("#src/app/stores/settings-store.ts", createSettingsStoreMock);
 *
 * The mock stores a reference to its export map so tests can override specific
 * functions after the mock is registered:
 *
 *   const mock = createSettingsStoreMock();
 *   vi.mock("#src/app/stores/settings-store.ts", () => mock);
 *   mock.getCurrentProject.mockReturnValue({ ... });
 *
 * This avoids the "Export named X not found" error when transitive deps of the
 * SUT import a settings-store function the test didn't list.
 */

import { vi } from "#vitest";

export type SettingsStoreMock = Record<string, ReturnType<typeof vi.fn>>;

export function createSettingsStoreMock(): SettingsStoreMock {
  return {
    getCurrentProject: vi.fn(),
    setCurrentProject: vi.fn(),
    clearProject: vi.fn(),
    getCurrentSession: vi.fn(),
    setCurrentSession: vi.fn(),
    clearSession: vi.fn(),
    getTtsMode: vi.fn(() => "off"),
    setTtsMode: vi.fn(),
    getCurrentAgent: vi.fn(),
    setCurrentAgent: vi.fn(),
    clearCurrentAgent: vi.fn(),
    getCurrentModel: vi.fn(),
    setCurrentModel: vi.fn(),
    clearCurrentModel: vi.fn(),
    getPinnedMessageId: vi.fn(),
    setPinnedMessageId: vi.fn(),
    clearPinnedMessageId: vi.fn(),
    getSessionDirectoryCache: vi.fn(),
    setSessionDirectoryCache: vi.fn(),
    clearSessionDirectoryCache: vi.fn(),
    getScheduledTasks: vi.fn(() => []),
    setScheduledTasks: vi.fn(),
    getScheduledTaskSessionIgnores: vi.fn(() => []),
    setScheduledTaskSessionIgnores: vi.fn(),
    getVisibleProjects: vi.fn(() => []),
    setVisibleProjects: vi.fn(),
    getCompactOutputMode: vi.fn(() => false),
    setCompactOutputMode: vi.fn(),
    getDeleteCompactProgressOnFinish: vi.fn(() => false),
    setDeleteCompactProgressOnFinish: vi.fn(),
    getShowThinkingContent: vi.fn(() => true),
    setShowThinkingContent: vi.fn(),
    getShowAssistantRunFooter: vi.fn(() => true),
    setShowAssistantRunFooter: vi.fn(),
    getResponseStreamingMode: vi.fn(() => "edit"),
    setResponseStreamingMode: vi.fn(),
    getSendDiffFileAttachments: vi.fn(() => false),
    setSendDiffFileAttachments: vi.fn(),
    getPromptQueueEnabled: vi.fn(() => false),
    setPromptQueueEnabled: vi.fn(),
    __resetSettingsForTests: vi.fn(),
    loadSettings: vi.fn(),
    flushSettings: vi.fn(),
  };
}
