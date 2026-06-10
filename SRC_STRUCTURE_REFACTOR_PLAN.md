# План реорганизации структуры `src`

## Цель

Сделать структуру `src` понятнее без большого рискованного переписывания логики:

- разделить Telegram frontend и application logic;
- убрать одинаковые имена файлов вроде множества `manager.ts`;
- хранить код по слоям, но переносить постепенно по пользовательским фичам/сценариям, чтобы удобно проверять;
- сократить количество одно-двухфайловых папок на верхнем уровне;
- уменьшить смешение уровней в `bot/index.ts` и бывшем `bot/utils`;
- сохранить уже выполненные этапы 1-4 как промежуточное состояние и выровнять их следующими этапами, без отката.

## Базовые принципы

1. `bot/` — это Telegram frontend/presentation layer: команды, message handlers, callback handlers, menus, reply keyboards, pinned messages, Telegram rendering, streaming delivery и middleware.
2. `app/` — это application layer: services, managers, stores, formatters и DTO/types.
3. Внутри `app` структура layer-first и плоская: `services/`, `managers/`, `stores/`, `formatters/`, `types/` без доменных подпапок.
4. Переносы делаем feature-by-feature: каждая итерация переносит связанный пользовательский сценарий, но файлы кладутся в layer-first структуру.
5. В layer-first папках имена файлов должны быть самодостаточными: `model-selection-service.ts`, `interaction-manager.ts`, `settings-store.ts`, а не `manager.ts`/`service.ts`.
6. `manager` — только владелец runtime state/cache. Если модуль не хранит собственное состояние, он должен быть `service`, `store`, `formatter`, `handler`, `menu` или `callback-handler`.
7. `service` — application use case / операция. Service может читать/писать через stores/managers, но не должен быть владельцем состояния.
8. `store` — persistent state или durable cache: `settings.json`, scheduled task store, session directory cache.
9. `opencode/` остаётся отдельным gateway к основной внешней системе OpenCode.
10. `runtime/`, `cli/`, `i18n/`, `utils/` остаются отдельными техническими слоями.
11. `bot/commands/definitions.ts` остаётся централизованным источником списка Telegram slash commands.
12. Не откатывать уже выполненные этапы 1-4. Если их структура больше не является финальной, добавить отдельный этап выравнивания.

## Целевая структура верхнего уровня

```text
src/
  app/
  bot/
  opencode/
  runtime/
  cli/
  i18n/
  utils/
  config.ts
  index.ts
  cli.ts
```

## Целевая структура `app`

```text
src/app/
  bootstrap/
    start-bot-app.ts

  services/
    agent-selection-service.ts
    attach-service.ts
    busy-reconciliation-service.ts
    command-catalog-service.ts
    external-user-input-service.ts
    file-browser-service.ts
    file-download-service.ts
    mcp-catalog-service.ts
    model-capabilities-service.ts
    model-context-limit-service.ts
    model-selection-service.ts
    opencode-server-service.ts
    project-service.ts
    project-switch-service.ts
    prompt-service.ts
    run-control-service.ts
    scheduled-task-executor-service.ts
    scheduled-task-runtime-service.ts
    scheduled-task-schedule-parser-service.ts
    session-cache-service.ts
    session-service.ts
    skills-catalog-service.ts
    stt-service.ts
    tts-service.ts
    variant-selection-service.ts
    worktree-service.ts

  managers/
    abort-suppression-manager.ts
    assistant-run-state-manager.ts
    background-session-manager.ts
    external-input-suppression-manager.ts
    foreground-session-state-manager.ts
    interaction-manager.ts
    keyboard-state-manager.ts
    permission-manager.ts
    pinned-message-state-manager.ts
    question-manager.ts
    rename-manager.ts
    scheduled-task-creation-manager.ts
    summary-aggregation-manager.ts

  stores/
    scheduled-task-store.ts
    settings-store.ts
    session-directory-cache-store.ts

  formatters/
    assistant-run-footer-formatter.ts
    scheduled-task-display-formatter.ts
    summary-formatter.ts
    summary-markdown-formatter.ts
    subagent-formatter.ts
    tool-message-batcher.ts

  types/
    agent.ts
    command-catalog.ts
    file.ts
    mcp.ts
    model.ts
    permission.ts
    project.ts
    question.ts
    run-control.ts
    scheduled-task.ts
    session.ts
    settings.ts
    skills.ts
    summary.ts
    variant.ts
    worktree.ts
```

Примечания:

- список файлов в `services/`, `managers/`, `stores/`, `formatters/`, `types/` является целевым ориентиром, а не требованием создать все файлы сразу;
- если существующий модуль уже хорошо работает и не требует разделения, переносить его можно одним файлом с более точным именем;
- если модуль смешивает несколько ролей, разделять его только при реальной необходимости для переноса, без дополнительных абстракций.

## Целевая структура `bot`

```text
src/bot/
  commands/
    definitions.ts
    abort-command.ts
    command-catalog-command.ts
    detach-command.ts
    help-command.ts
    ls-command.ts
    mcp-catalog-command.ts
    messages-command.ts
    new-command.ts
    opencode-start-command.ts
    opencode-stop-command.ts
    open-command.ts
    projects-command.ts
    rename-command.ts
    sessions-command.ts
    settings-command.ts      # позже, когда будет добавлена команда /settings
    skills-catalog-command.ts
    start-command.ts
    status-command.ts
    task-command.ts
    tasklist-command.ts
    tts-command.ts
    worktree-command.ts

  handlers/
    document-handler.ts
    media-group-handler.ts
    photo-handler.ts
    prompt-handler.ts
    text-message-handler.ts
    voice-handler.ts

  callbacks/
    callback-router.ts
    agent-selection-callback-handler.ts
    command-catalog-callback-handler.ts
    context-control-callback-handler.ts
    file-browser-callback-handler.ts
    inline-menu-cancel-callback-handler.ts
    mcp-catalog-callback-handler.ts
    message-history-callback-handler.ts
    model-selection-callback-handler.ts
    permission-callback-handler.ts
    project-callback-handler.ts
    question-callback-handler.ts
    rename-callback-handler.ts
    scheduled-task-callback-handler.ts
    session-callback-handler.ts
    skills-catalog-callback-handler.ts
    variant-selection-callback-handler.ts
    worktree-callback-handler.ts

  menus/
    agent-selection-menu.ts
    command-catalog-menu.ts
    context-control-menu.ts
    file-browser-menu.ts
    inline-menu.ts
    mcp-catalog-menu.ts
    message-history-menu.ts
    model-selection-menu.ts
    project-selection-menu.ts
    question-menu.ts
    rename-menu.ts
    scheduled-task-menu.ts
    session-selection-menu.ts
    settings-menu.ts       # позже, когда будет добавлена команда /settings
    skills-catalog-menu.ts
    variant-selection-menu.ts
    worktree-selection-menu.ts

  keyboards/
    keyboard-manager.ts
    keyboard-types.ts
    main-reply-keyboard.ts

  pinned/
    pinned-message-format.ts
    pinned-message-manager.ts
    pinned-message-types.ts

  middleware/
    auth-middleware.ts
    command-init-middleware.ts
    interaction-guard-middleware.ts
    unknown-command-middleware.ts

  render/
  streaming/
  routers/
    command-router.ts
    message-router.ts

  telegram-client-options.ts
  message-patterns.ts
  index.ts
```

Примечания:

- `bot/commands` — только Telegram slash command entrypoints и `definitions.ts`;
- `bot/handlers` — message/media/text handlers;
- `bot/callbacks` — callback-query handlers и callback router;
- `bot/menus` — inline menu builders/show functions;
- `bot/keyboards` — reply keyboard;
- `bot/render`, `bot/streaming`, `bot/pinned` — Telegram presentation/delivery.

## Что делать с уже выполненными этапами 1-4

Первые четыре этапа не откатываем. Они считаются рабочим промежуточным состоянием.

Уже сделанное:

- `runtime/service` — соответствует новой архитектуре и остаётся;
- `bot/ui/render`, `bot/ui/streaming`, `bot/ui/keyboard`, `bot/ui/pinned` — направление верное, но финально это будет выровнено в `bot/render`, `bot/streaming`, `bot/keyboards`, `bot/pinned`;
- `bot/core/interactions` — временно допустимо, но финально state managers уйдут в `app/managers`, а Telegram menus/callbacks — в `bot/menus` и `bot/callbacks`;
- `bot/core/assistant-execution` — временно допустимо, но финально state/managers/services/formatters уйдут в `app/*`, Telegram delivery останется в `bot/*`.

## Правила переноса по фичам

Для каждого feature-oriented этапа:

1. Сначала определить source-файлы и их роли: command, handler, callback, menu, service, manager, store, formatter, type.
2. Перенести файлы в layer-first target folders.
3. Переименовать generic файлы в самодостаточные имена.
4. Обновить imports в коде и тестах.
5. Перенести/переименовать тесты в структуру, соответствующую target folders.
6. Запустить релевантные тесты для этой фичи, затем `npm run build`.

## `bot/utils` cleanup

`bot/utils` сейчас содержит смесь Telegram helpers и application logic. Его нужно разобрать по слоям:

Перенести в Telegram frontend:

- `telegram-text.ts` -> `bot/render/telegram-text.ts`
- `send-with-markdown-fallback.ts` -> `bot/render/send-with-markdown-fallback.ts`
- `thinking-message.ts` -> `bot/render/thinking-message.ts`
- `keyboard.ts` -> `bot/keyboards/main-reply-keyboard.ts`
- `assistant-rendering.ts` -> `bot/render/assistant-rendering.ts`
- `send-downloaded-file.ts` -> `bot/handlers` или `bot/render` после проверки роли
- `telegram-file-url.ts` -> `bot/handlers` или `app/services/file-download-service.ts` после проверки зависимости от Telegram API

Перенести в application layer:

- `switch-project.ts` -> `app/services/project-switch-service.ts`
- `busy-guard.ts`, `busy-reconciliation.ts` -> `app/services/busy-reconciliation-service.ts` и/или `app/services/run-control-service.ts`
- `file-download.ts`, `file-tree.ts`, `browser-roots.ts` -> `app/services/file-download-service.ts` / `app/services/file-browser-service.ts`
- `send-tts-response.ts` -> `app/services/tts-service.ts` или Telegram delivery helper после проверки роли
- `external-user-input.ts` -> `app/services/external-user-input-service.ts`
- `abort-error-suppression.ts` -> `app/managers/abort-suppression-manager.ts`
- `finalize-assistant-response.ts` -> разделить между `app/services/run-control-service.ts` и `bot/render`/`bot/streaming`, если потребуется
- `assistant-run-footer.ts` -> `app/formatters/assistant-run-footer-formatter.ts`

## Важные зависимости, которые надо поправить

Перед массовыми переносами желательно убрать обратные зависимости application layer на Telegram frontend:

- `app/services`, `app/managers`, `app/stores` не должны импортировать `bot/*`, кроме временных переходных состояний;
- Telegram-specific зависимости (`Context`, `Bot`, `InlineKeyboard`, `Keyboard`, Telegram API) должны оставаться в `bot/*`;
- application services могут принимать callbacks/deps параметрами, если нужно отправить сообщение пользователю;
- `opencode/` не должен импортировать `bot/*` и должен оставаться gateway к OpenCode;
- `bot/index.ts` должен постепенно стать composition root/router, а не местом бизнес-логики.

## Порядок работ

- [x] **Этап 1. Runtime/service**

  1. Перенести `src/service/*` в `src/runtime/service/*`.
  2. Переименовать `service/runtime.ts` в `runtime/service/env.ts`.
  3. Обновить импорты в `cli.ts`, `app/start-bot-app.ts`, тестах и других местах.
  4. Перенести `tests/service/manager.test.ts` в `tests/runtime/service/manager.test.ts`.
  5. Запустить build/test для runtime/service.

- [x] **Этап 2. Telegram render/UI, промежуточное состояние**

  1. Перенести `src/telegram/render/*` в `src/bot/ui/render/*`.
  2. Перенести `src/bot/streaming/*` в `src/bot/ui/streaming/*`.
  3. Перенести `src/keyboard/*` в `src/bot/ui/keyboard/*`.
  4. Перенести `src/pinned/*` в `src/bot/ui/pinned/*`.
  5. Перенести UI helpers из `src/bot/utils/*` в `src/bot/ui/*`.
  6. Обновить тестовые пути и импорты.
  7. Запустить релевантные render/streaming/keyboard/pinned тесты, затем build.

- [x] **Этап 3. Core interactions, промежуточное состояние**

  1. Создать `src/bot/core/interactions/`.
  2. Перенести `src/interaction/*`.
  3. Перенести `src/question/*`, `src/permission/*`.
  4. Перенести `src/bot/handlers/inline-menu.ts`, `question.ts`, `permission.ts`.
  5. Убрать обратную зависимость `attach/service.ts` от старых `bot/handlers/question.ts` и `bot/handlers/permission.ts` через новые core-модули или callbacks.
  6. Обновить middleware imports (`interaction-guard`) и tests.
  7. Запустить interaction/question/permission/attach тесты, затем build.

- [x] **Этап 4. Core assistant execution, промежуточное состояние**

  1. Создать `src/bot/core/assistant-execution/`.
  2. Перенести `src/bot/assistant-run-state.ts`.
  3. Перенести `abort-error-suppression.ts`, `finalize-assistant-response.ts`.
  4. Рассмотреть `busy-guard.ts` и `busy-reconciliation.ts`: оставить во временном core assistant execution или позже перенести в `app/services/busy-reconciliation-service.ts` / `app/services/run-control-service.ts`.
  5. Решить место для `assistant-run-footer.ts` после проверки delivery/render зависимостей.
  6. Обновить импорты в `bot/index.ts`, commands, handlers и tests.
  7. Запустить busy/finalize/streaming/prompt/abort тесты, затем build.

- [x] **Этап 5. App skeleton и bootstrap**

  1. Создать `src/app/services`, `src/app/managers`, `src/app/stores`, `src/app/formatters`, `src/app/types`, `src/app/bootstrap`.
  2. Перенести `src/app/start-bot-app.ts` в `src/app/bootstrap/start-bot-app.ts`.
  3. Обновить import из entrypoint/runtime кода.
  4. Не переносить остальные доменные модули на этом этапе.
  5. Запустить `npm run build`.

- [x] **Этап 6. Bot frontend UI alignment**

  1. Перенести `src/bot/ui/render/*` в `src/bot/render/*`.
  2. Перенести `src/bot/ui/streaming/*` в `src/bot/streaming/*`.
  3. Перенести `src/bot/ui/keyboard/*` в `src/bot/keyboards/*` с переименованиями `keyboard.ts` -> `main-reply-keyboard.ts`, `types.ts` -> `keyboard-types.ts`.
  4. Перенести `src/bot/ui/pinned/*` в `src/bot/pinned/*` с самодостаточными именами файлов.
  5. Обновить imports в bot/app/tests.
  6. Запустить render/streaming/keyboard/pinned тесты, затем build.

- [x] **Этап 7. Interactions alignment**

  1. Перенести state managers из `bot/core/interactions/active-flow/*` в `app/managers/interaction-manager.ts` и связанные app types.
  2. Перенести `questions/manager.ts` в `app/managers/question-manager.ts`, `questions/types.ts` в `app/types/question.ts`.
  3. Перенести `permissions/manager.ts` в `app/managers/permission-manager.ts`, `permissions/types.ts` в `app/types/permission.ts`.
  4. Перенести Telegram UI question/permission/inline-menu logic в `bot/menus/*` и `bot/callbacks/*`.
  5. Обновить `interaction-guard` imports.
  6. Запустить interaction/question/permission/middleware тесты, затем build.

- [x] **Этап 8. Assistant execution alignment**

  1. Перенести `assistant-run-state.ts` в `app/managers/assistant-run-state-manager.ts`.
  2. Перенести `abort-error-suppression.ts` в `app/managers/abort-suppression-manager.ts`.
  3. Перенести `busy-reconciliation.ts` и state-independent parts of `busy-guard.ts` в `app/services/busy-reconciliation-service.ts` или `app/services/run-control-service.ts`.
  4. Перенести `assistant-run-footer.ts` в `app/formatters/assistant-run-footer-formatter.ts`.
  5. Оставить Telegram delivery/render-specific logic в `bot/render`/`bot/streaming`.
  6. Обновить imports в prompt/abort/detach/scheduled tasks/tests.
  7. Запустить busy/finalize/streaming/prompt/abort тесты, затем build.

- [x] **Этап 9. Assistant controls: model/agent/variant/context**

  1. Перенести `src/model/manager.ts` -> `app/services/model-selection-service.ts`.
  2. Перенести `src/model/capabilities.ts` -> `app/services/model-capabilities-service.ts`.
  3. Перенести `src/model/context-limit.ts` -> `app/services/model-context-limit-service.ts`.
  4. Перенести `src/model/types.ts` -> `app/types/model.ts`.
  5. Перенести `src/agent/manager.ts` -> `app/services/agent-selection-service.ts`.
  6. Перенести `src/agent/types.ts` -> `app/types/agent.ts`.
  7. Перенести `src/variant/manager.ts` -> `app/services/variant-selection-service.ts`.
  8. Перенести `src/variant/types.ts` -> `app/types/variant.ts` или удалить, если он пустой.
  9. Перенести `bot/handlers/model.ts`, `agent.ts`, `variant.ts`, `context.ts` в `bot/menus/*` и `bot/callbacks/*` по роли.
  10. Обновить keyboard/pinned/status/start/new/session/prompt imports.
  11. Запустить model/agent/variant/context/keyboard/status/start/new tests, затем build.

- [x] **Этап 10. Speech**

  1. Перенести `stt/client.ts` -> `app/services/stt-service.ts`.
  2. Перенести `tts/client.ts` -> `app/services/tts-service.ts`.
  3. Перенести `bot/commands/tts.ts` -> `bot/commands/tts-command.ts`.
  4. Перенести `bot/handlers/voice.ts` -> `bot/handlers/voice-handler.ts`.
  5. Разобрать `send-tts-response.ts`: application часть в `app/services/tts-service.ts`, Telegram delivery часть в `bot/handlers` или `bot/render`.
  6. Обновить prompt/final delivery imports и tests.
  7. Запустить stt/tts/voice/send-tts-response тесты, затем build.

- [x] **Этап 11. Files**

  1. Перенести `bot/commands/open.ts` -> `bot/commands/open-command.ts`.
  2. Перенести `bot/commands/ls.ts` -> `bot/commands/ls-command.ts`.
  3. Перенести file browsing menu/callback logic в `bot/menus/file-browser-menu.ts` и `bot/callbacks/file-browser-callback-handler.ts`.
  4. Перенести `bot/handlers/document.ts`, `media-group.ts` в `bot/handlers/*-handler.ts`.
  5. Выделить photo handling из `bot/index.ts` в `bot/handlers/photo-handler.ts`.
  6. Перенести file application logic (`file-download`, `file-tree`, `browser-roots`) в `app/services/file-download-service.ts` и `app/services/file-browser-service.ts`.
  7. Обновить tests для open/ls/document/media-group/photo/file utils.
  8. Запустить files-related тесты, затем build.

- [x] **Этап 12. Projects**

  1. Перенести `src/project/*` -> `app/services/project-service.ts` и `app/types/project.ts`.
  2. Перенести `bot/commands/projects.ts` -> `bot/commands/projects-command.ts`.
  3. Перенести projects menu/callback logic в `bot/menus/project-selection-menu.ts` и `bot/callbacks/project-callback-handler.ts`.
  4. Перенести `bot/utils/switch-project.ts` -> `app/services/project-switch-service.ts`.
  5. Обновить зависимости с sessions/worktree/status/pinned/background tracking.
  6. Запустить project/projects/switch-project тесты, затем build.

- [x] **Этап 13. Worktree**

  1. Перенести `src/git/worktree.ts` -> `app/services/worktree-service.ts` и `app/types/worktree.ts`.
  2. Перенести `bot/commands/worktree.ts` -> `bot/commands/worktree-command.ts`.
  3. Перенести worktree menu/callback logic в `bot/menus/worktree-selection-menu.ts` и `bot/callbacks/worktree-callback-handler.ts`.
  4. Обновить зависимости с projects/status/open/session cache.
  5. Запустить git/worktree и bot/commands/worktree тесты, затем build.

- [ ] **Этап 14. Sessions и rename**

  1. Перенести `src/session/manager.ts` -> `app/services/session-service.ts`.
  2. Перенести `src/session/cache-manager.ts` -> `app/stores/session-directory-cache-store.ts` или `app/services/session-cache-service.ts` после проверки роли.
  3. Перенести session types в `app/types/session.ts`.
  4. Перенести `src/rename/manager.ts` -> `app/managers/rename-manager.ts`.
  5. Перенести `bot/commands/sessions.ts`, `new.ts`, `rename.ts` -> `bot/commands/*-command.ts`.
  6. Перенести session/rename menus/callbacks в `bot/menus/*` и `bot/callbacks/*`.
  7. Оставить `/messages`, `/abort`, `/detach`, attach/background/external-input вне этого этапа.
  8. Обновить imports из projects/worktree/status/pinned/settings.
  9. Запустить session/rename/sessions/new тесты, затем build.

- [ ] **Этап 15. Run control**

  1. Перенести `bot/commands/abort.ts`, `detach.ts` -> `bot/commands/abort-command.ts`, `detach-command.ts`.
  2. Перенести `src/attach/*` -> `app/services/attach-service.ts` и, если есть state, `app/managers/*`.
  3. Перенести `src/background-session/*` -> `app/managers/background-session-manager.ts` или service после проверки роли.
  4. Перенести `src/external-input/*` и `bot/utils/external-user-input.ts` -> `app/services/external-user-input-service.ts` / `app/managers/external-input-suppression-manager.ts`.
  5. Обновить prompt, scheduled tasks, summary, pinned, sessions imports.
  6. Запустить abort/detach/attach/background/external-input тесты, затем build.

- [ ] **Этап 16. Message history**

  1. Перенести `bot/commands/messages.ts` -> `bot/commands/messages-command.ts`.
  2. Перенести message history menu/callback logic в `bot/menus/message-history-menu.ts` и `bot/callbacks/message-history-callback-handler.ts`.
  3. Если появится reusable application logic, вынести её в `app/services/session-service.ts` или отдельный `message-history-service.ts`.
  4. Обновить callback routing и зависимости с sessions/run-control.
  5. Запустить messages тесты, затем build.

- [ ] **Этап 17. Scheduled tasks**

  1. Перенести `src/scheduled-task/creation-manager.ts` -> `app/managers/scheduled-task-creation-manager.ts`.
  2. Перенести `src/scheduled-task/store.ts` -> `app/stores/scheduled-task-store.ts`.
  3. Перенести `src/scheduled-task/runtime.ts` -> `app/services/scheduled-task-runtime-service.ts`.
  4. Перенести `src/scheduled-task/executor.ts` -> `app/services/scheduled-task-executor-service.ts`.
  5. Перенести `src/scheduled-task/schedule-parser.ts` -> `app/services/scheduled-task-schedule-parser-service.ts`.
  6. Перенести `display.ts`, `next-run.ts`, `session-ignore.ts`, `types.ts` в `app/formatters`, `app/services`, `app/types` по роли.
  7. Перенести `bot/commands/task.ts`, `tasklist.ts` -> `bot/commands/*-command.ts`.
  8. Перенести scheduled task menus/callbacks в `bot/menus/scheduled-task-menu.ts` и `bot/callbacks/scheduled-task-callback-handler.ts`.
  9. Обновить взаимодействие с sessions/interactions/run-control.
  10. Запустить scheduled-task/task/tasklist тесты, затем build.

- [ ] **Этап 18. OpenCode server commands**

  1. Перенести `bot/commands/opencode-start.ts`, `opencode-stop.ts` -> `bot/commands/opencode-start-command.ts`, `opencode-stop-command.ts`.
  2. Оставить `opencode/process.ts`, `opencode/auto-restart.ts`, `opencode/ready-*` в `opencode/` как gateway/lifecycle слой.
  3. Если command-specific orchestration разрастается, вынести её в `app/services/opencode-server-service.ts`.
  4. Обновить imports/tests.
  5. Запустить opencode-start/opencode-stop/opencode process tests, затем build.

- [ ] **Этап 19. Bot basics и Telegram command registry**

  1. Перенести `bot/commands/start.ts`, `help.ts`, `status.ts` -> `bot/commands/start-command.ts`, `help-command.ts`, `status-command.ts`.
  2. Оставить `bot/commands/definitions.ts` как централизованный источник Telegram command list.
  3. Создать command registration/router module, если это упростит `bot/index.ts`.
  4. Обновить registration в `bot/index.ts`.
  5. Запустить start/help/status/command definitions tests, затем build.

- [ ] **Этап 20. Catalogs: commands, skills, MCP**

  1. Перенести `bot/commands/commands.ts` -> `bot/commands/command-catalog-command.ts`.
  2. Перенести `bot/commands/skills.ts` -> `bot/commands/skills-catalog-command.ts`.
  3. Перенести `bot/commands/mcps.ts` -> `bot/commands/mcp-catalog-command.ts`.
  4. Перенести menu/callback/text-argument routing в `bot/menus/*`, `bot/callbacks/*`, `bot/handlers/text-message-handler.ts`.
  5. Если reusable API-loading logic нужно отделить от Telegram UI, вынести в `app/services/command-catalog-service.ts`, `skills-catalog-service.ts`, `mcp-catalog-service.ts`.
  6. Не путать `command-catalog-command.ts` с `bot/commands/definitions.ts`.
  7. Запустить commands/skills/mcps тесты, затем build.

- [ ] **Этап 21. Settings store и будущая settings команда**

  1. Перенести `src/settings/manager.ts` -> `app/stores/settings-store.ts` и `app/types/settings.ts`.
  2. Обновить все imports на settings store.
  3. Не добавлять `/settings` в рамках рефакторинга, если это отдельная продуктовая задача.
  4. Если `/settings` будет добавлена позже: создать `bot/commands/settings-command.ts` и `bot/menus/settings-menu.ts`.
  5. Запустить settings-related тесты и полный build.

- [ ] **Этап 22. Summary pipeline**

  1. Перенести `summary/aggregator.ts` -> `app/managers/summary-aggregation-manager.ts`.
  2. Перенести `summary/formatter.ts`, `markdown-to-telegram-v2.ts`, `subagent-formatter.ts`, `tool-message-batcher.ts` в `app/formatters/*` или оставить Telegram-specific rendering в `bot/render` после проверки зависимостей.
  3. Убедиться, что app-level summary не зависит от Telegram-specific `bot/*`, кроме временных переходных зависимостей.
  4. Обновить SSE/event delivery imports.
  5. Запустить summary/render/streaming тесты, затем build.

- [ ] **Этап 23. Декомпозиция `bot/index.ts`**

  1. Выделить command router/registration в `bot/routers/command-router.ts` или command registration module.
  2. Выделить callback router в `bot/callbacks/callback-router.ts`.
  3. Выделить message/media router в `bot/routers/message-router.ts`.
  4. Выделить OpenCode/SSE event handling из `bot/index.ts`, если оно осталось смешанным с Telegram setup.
  5. Выделить assistant response delivery/background session notifications.
  6. Убедиться, что `bot/index.ts` является composition root, а не местом бизнес-логики.
  7. Запустить полный `npm run build`, `npm run lint`, `npm test`.

- [ ] **Этап 24. Финальная чистка структуры**

  1. Удалить пустые старые директории: `model`, `agent`, `variant`, `session`, `project`, `git`, `scheduled-task`, `settings`, `attach`, `background-session`, `external-input`, `stt`, `tts`, `summary`, если они полностью перенесены.
  2. Убедиться, что в `app/services`, `app/managers`, `app/stores` нет generic файлов `manager.ts`, `service.ts`, `types.ts`.
  3. Убедиться, что application layer не импортирует Telegram frontend без необходимости.
  4. Обновить PRODUCT.md/документацию, если структура описана там.
  5. Запустить полный `npm run build`, `npm run lint`, `npm test`.

## Проверка после каждого этапа

Минимально:

```bash
npm run build
npm test
```

Для feature-oriented этапов дополнительно запускать релевантные targeted tests до полного build/test.

Перед завершением всей реорганизации:

```bash
npm run build
npm run lint
npm test
```
