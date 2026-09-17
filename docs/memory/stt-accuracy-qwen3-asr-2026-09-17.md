# STT accuracy — Qwen3-ASR biasing & corrections (2026-09-17)

Context: voice dictation of mixed Spanish/English technical notes frequently
mistranscribed domain terms (`rudabook` → "Rudabov/Rutabug/CRUD book",
`GPU` → "Jeep", `schedules` → "esquetules", `deploy` → "diplói",
`mergea` → "Merge a", `opencode` → "OpenCove").

## Current stack (analyzed)

- Bot (`opencode-telegram-bot`) downloads Telegram voice (OGG/OPUS), converts to
  16 kHz mono WAV with ffmpeg, POSTs multipart to `{STT_API_URL}/audio/transcriptions`
  (`STT_MODEL=qwen3-asr-1.7b`, `STT_API_URL=http://127.0.0.1:8080/v1`, systemd
  drop-in `stt-local.conf`).
- ASR server: container `llama-asr` — llama.cpp **b10015** (Vulkan, `-ngl 99`,
  `-c 8192`) running **Qwen3-ASR-1.7B-Q8_0 + mmproj-Q8_0**, files identical in
  size to the official `ggml-org/Qwen3-ASR-1.7B-GGUF` repo.
- Legacy `whisper-server.service` (:21000, whisper.cpp large-v3-turbo, CPU) is
  NOT used by the bot.

## Research findings (verified, not inferred)

- Qwen3-ASR is the strongest open-weights option for this use case; the family
  only has 0.6B/1.7B — no larger open variant exists. Official model card:
  "state-of-the-art among open-source ASR models, competitive with the strongest
  proprietary APIs".
- Qwen3-ASR supports **context/hotwords via the system prompt**
  (`apply_transcription_request(audio, prompt="Vocabulary: ...", language=...)`,
  limit ≈ 10k tokens per the maintainers). llama.cpp exposes this to the
  OpenAI-compatible endpoint as the `prompt` form field
  (`tools/server/server-chat.cpp` → `convert_transcriptions_to_chatcmpl`); it
  also appends `(language: X)` when `language` is passed.
- Whisper large-v3-turbo rejected empirically: it **translates** code-switched
  speech ("Los schedules..." → "The sales of...") and hallucinates.
- llama.cpp **b11025** (Sep 2026) and the **bf16 mmproj** both produced
  IDENTICAL outputs to b10015 + Q8_0 mmproj on our test set → no upgrade needed.
- NVIDIA Parakeet/Nemotron in llama.cpp is English-centric; not useful here.

## Measurement (edge-tts generated mixed es/en phrases, key terms scored)

| Config | Key-term accuracy |
|---|---|
| no biasing | 17/35 (49%) |
| `Vocabulary: ...` prompt | 29/35 (83%) |
| `Technical terms: ...` prompt | **30/35 (86%)** |
| `Technical terms: ...` (chat-completions system message) | 30/35 (86%) |
| whisper large-v3-turbo (no prompt) | worse + translates/hallucinates |

Residual misses were mostly TTS pronunciation artifacts (`D1` was literally
pronounced "de uno", `Railway` ≈ "algo"). Latency ≈ 300 ms per phrase on the GPU.

## Implementation (this fork)

- `src/app/services/stt-domain.ts` — loads `STT_DOMAIN_FILE` JSON:
  `hotwords[]` → `Technical terms: a, b, c.` sent as the `prompt` field;
  `corrections{}` → post-transcription replacements (case-insensitive,
  word-boundary, accent-tolerant e.g. `Rudabók`→`rudabook`, longest keys first).
  Reloaded on every transcription (edit the file, no restart).
- Live domain file: `~/.config/opencode-telegram-bot/stt-domain.json`.
- Deployed: service runs from `/home/ovreuc/opencode-telegram-bot-deploy`
  (pinned commit). PR #18.

## Follow-up ideas (not implemented)

- If accuracy still lags on real speech: add more misheard variants to
  `corrections`, or try an LLM post-correction pass (local Qwen3.8-27B on :8081).
- `Qwen3-ASR-Flash` (Alibaba API) could be a cloud fallback of last resort.
