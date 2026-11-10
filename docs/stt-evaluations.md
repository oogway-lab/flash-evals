# STT evaluations

## Gemini through OpenRouter

For local testing, set `OPENROUTER_API_KEY` in `apps/api/.env`, restart the dev
stack, and run the **Gemini 3.8 Flash** audio capability probe in Settings. A
successful probe enables the model in audio run setup and STT canvas nodes.
The route uses OpenRouter chat completions with audio input, an optional
language hint, and vocabulary guidance. It returns plain transcripts. Speaker
diarization and word timestamps are not supported by this adapter.

Gemini 3.8 Flash audio uses `reasoning.effort: low`, temperature zero, and
Latin-only transcription with four code-mixed examples (Hindi, Tamil, Telugu,
Bengali). Speech stays in its original language, written phonetically in Latin
script; English words, names, numbers, and `[inaudible]` markers are preserved.
For recordings without speech, the prompt requests exactly `[no speech]` rather
than invented words or sound descriptions. `[inaudible]` is reserved for speech
whose words cannot be understood.
Selected language hints use `hi-Latn`, `ta-Latn`, `te-Latn`, `bn-Latn`, or `en-IN`;
an empty hint still means automatic language detection. If native-script fragments
remain, internal Gemini 3.5 Flash Lite calls romanize them in batches of up to
32 distinct fragments. The
application gives invalid replacement entries or malformed JSON one correction
attempt, copies every other character verbatim, and validates the repaired
transcript before storing it. All calls contribute to usage and reported cost;
missing billing stays unknown. Repair uses provider-default thinking and records
its model and fragment count in transcript metadata. The adapter version prevents
reuse of transcripts made before this recovery behavior. Other STT providers
retain their own output contracts.

Thinking settings for translation and separate transliteration are unchanged:
only explicitly selected effort is forwarded. New Simple Gemini 3 text routes
allow 32,768 total output tokens and five minutes per request because thinking
and visible text share the budget; this is not a thinking-budget override.
Existing captured routes retain their settings. Exhaustion is reported as
`output_limit`. OpenRouter currently requires thinking for Gemini 3.8 Flash,
so audio uses its minimum supported level rather than claiming a zero budget.

Each request carries at most 14 MB of WAV or MP3 audio and 10 minutes of
speech (`STT_OPENROUTER_AUDIO_MAX_BYTES`, `STT_AUDIO_MAX_CHUNK_MS`). Recordings
within both limits are sent unchanged. Larger or longer recordings, and other
formats, are converted on the worker to mono 16 kHz MP3 and, when still over a
limit, split into ordered chunks near silences. The stored upload is never
changed. Chunk transcripts are joined in order into one transcript, so
translation and summary nodes still receive one transcript per recording.
Preparation does not denoise or label speakers. A cut with no nearby silence
adds a warning to the transcript; check that boundary by ear. A chunk that is
entirely silence is skipped rather than sent. Each chunk is transcribed on its
own, so any speaker labels are scoped to their part (`part2:A`) and the same
person can appear under different labels in different parts.

Timeouts, rate limits, and provider 5xx errors are retried with backoff
(`STT_MAX_ATTEMPTS`, `STT_REQUEST_TIMEOUT_MS`); invalid audio and credential
errors fail at once. Completed chunks are saved, so a retry only transcribes the
chunks that are missing. A timed-out request may still be billed: the
transcript's metadata then has `costUncertain`, and the reported cost leaves
that request out rather than counting it as zero.

To recover a partial or failed pipeline run, choose **Retry failed cells** on
the run page. Failed cells and the cells they blocked run again. Successful
cells, reused transcripts, and the run's workflow snapshot are kept, and cell
cost shows spend incurred by that run, including completed chunks paid for before
a failed attempt. Charges are checkpointed on the cell or shared preparation item
as each new part finishes and survive retries. Reusing a transcript in a different
run still costs zero; an unknown charge keeps the run's total unavailable.

Use `google/gemini-3.8-flash` for the optional transliteration and transcript
judge models too. Latin transcript scoring requires an
`expectedTranscriptLatin` reference; native transcript scoring uses
`expectedTranscript`. A missing reference skips that metric.

## ElevenLabs Scribe

**ElevenLabs Scribe v2** (`elevenlabs:scribe_v2`) sends the audio file to
ElevenLabs' speech-to-text endpoint (`POST https://api.elevenlabs.io/v1/speech-to-text`,
model `scribe_v2`) in one request and gets the whole transcript back in the
reply. The key comes from Settings > Provider keys > ElevenLabs, or from
`ELEVENLABS_API_KEY` in `apps/api/.env`; a key saved in Settings wins.

The route is not yet checked against the real API, so it starts as unverified,
like the Gemini audio routes. With a key in place, run its route check in
Settings (one short request with a 2.4-second tone, which has no speech, so an
empty transcript passes) or add it to `FLASH_EVALS_STT_CAPABILITY_PROBES`. After
a successful check, the model can be picked in the STT run form and in the STT
pipeline node.

What each run setting sends:

| Setting        | Sent to ElevenLabs                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio language | `language_code` (ISO code such as `hi` or `en`). Leave it empty for Hindi/English code-switched audio: one code forces that language, and an empty value lets Scribe detect it.                              |
| Diarization    | `diarize=true`; speaker IDs (`speaker_0`, `speaker_1`, ...) become the transcript's speaker labels.                                                                                                          |
| Keyword boost  | One `keyterms` field per term. ElevenLabs takes up to 1000 terms, each at most 50 characters and 5 words, without `< > { } [ ] \`; terms over those limits are skipped and named in the transcript warnings. |

Every request also sends `timestamps_granularity=word` (word timings) and
`tag_audio_events=false`, so tags such as "(laughter)" do not count against the
reference transcript. Words are grouped into segments by speaker, sentence end,
and pauses over one second. The detected language (`language_code`, for example
`hin`) and the full reply are kept in the transcript's provider metadata.

Cost is computed from `audio_duration_secs` at the published price of $0.22 per
audio hour, plus $0.05 per hour when keyword boost sends at least one term
([elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api)). It is a list
price (`costSource: "computed"`), not an invoice: other plan terms, and the
20-second minimum ElevenLabs bills when a request has more than 100 keyterms,
are not included.

The reply arrives only when the transcription is done, so the request waits up
to 10 minutes. Scribe v2 Realtime, Scribe v2 Medical and multichannel audio are
not offered.

## Config variants

An STT metrics run can compare one to six configuration variants. Each variant
has its own label, model, language hint, and provider-supported fields. Use
**Duplicate** to copy a variant before changing one axis such as diarization,
language, prompt, temperature, or keyword boost. Every variant creates its own
transcript and metric cells; adding variants therefore multiplies provider cost
for every audio item.

Keyword boost is provider-aware. Soniox receives the terms in its native
`context` field, and ElevenLabs as `keyterms`. OpenAI transcription routes that accept an initial prompt get
the same comma-separated terms appended as plain transcript-like vocabulary.
Routes with neither surface do not show the field. The thinking-token budget is
defined for audio-understanding routes but remains unavailable until one of
those routes is live-verified.

**Level volume first** (`levelVolume: true` in an STT config) raises
the loudness of each recording on the worker before any provider receives it.
FFmpeg applies `loudnorm=I=-23:TP=-2:LRA=11` and writes 16 kHz mono 16-bit
audio. Routes that accept FLAC (OpenAI and OpenRouter transcription uploads,
ElevenLabs, Soniox, Gemini, Vercel Gateway) get lossless FLAC, often around half to two thirds the
size of WAV, when it fits the route's upload budget: 23 MiB for OpenAI,
OpenRouter transcription and Vercel Gateway (under OpenAI's 25 MB upload
limit), and a conservative 100 MiB for ElevenLabs, Soniox and Gemini. A larger
levelled FLAC (roughly 20 minutes or more for the 23 MiB routes) is re-encoded
from the levelled audio as 48 kbps speech MP3, and split into ordered chunks at
silences when that MP3 would still be over the budget; a chunk that is still
too large fails the request with its size. OpenAI's gpt-4o-transcribe models
(mini and diarize included, on any route) also cap one request at 1,400
seconds of levelled audio (a margin under their roughly 1,500 second limit,
not verified here), so longer recordings are split the same way even when the
FLAC fits; whisper-1 and other models are not split by length. Gemini on OpenRouter chat audio
takes only WAV or MP3, so it gets WAV, and a WAV over its size or length budget
is compressed and split as described above. Use it for quiet recordings (an average level far below
-30 dBFS) or when a provider returns empty transcripts or the wrong language on
some files. It needs FFmpeg on the worker, follows `STT_AUDIO_PREP_CONCURRENCY`,
and never falls back to the original audio. Levelled transcripts are cached
separately from unlevelled ones, record `volumeLevelled` in their provider
metadata, and show "Volume levelled" in the matrix and transcript views. The
option is on each STT metrics variant, on the STT model of an STT plus prompt
run, and on a pipeline's STT step (where the run results show "Volume levelled"
on that branch). Reruns restore it.

Transliteration and the custom transcript judge are shared across all variants
in the run. Results use the variant labels in the models table, matrix, and
transcript views. When variants share a base model, badges call out every config
value that differs.

## Importing gold answers

The gold-answer wizard accepts JSON arrays, keyed JSON objects, and JSONL. It
detects input fields and proposes common aliases such as `gt`, `ground_truth`,
`reference`, or `transcript` for `expectedTranscript`. Review or change every
mapping, then inspect the per-row preview before committing. Invalid rows and
unmatched filenames remain uncommitted and include a specific diagnostic; a
same-stem filename with a different extension is offered as a near-match.

Audio dataset items show separate coverage badges for the native transcript,
Latin transcript, and speaker turns. A missing transcript badge means
deterministic transcript scoring will skip that item, even if another reference
field is present.

## Canvas workflows

The `/stt-evals` canvas composes reusable audio-evaluation branches from five
node types: STT, LLM text, transliteration, judge, and metric comparison. Every
branch begins at an STT root and may fan out, but a downstream node belongs to
exactly one STT root. This prevents cross-root fan-in from overwriting results,
because a workflow run stores one cell per node and dataset item.

STT nodes carry their own full transcription configuration. Duplicate a root
to compare a second configuration, then connect an independent downstream
chain. Metric nodes explicitly select `expectedTranscript` or
`expectedTranscriptLatin`; judge nodes run even when an item has no gold label,
which supports rubrics such as PII or OTP leakage checks.

Canvas runs use the same workflow tables, worker, artifact cache, and progress
API as prompt workflows. The run snapshot freezes node types, configs, and
edges. Prompt workflows retain their existing connected graph and optional
run-level audio pre-stage; STT canvas workflows execute transcription inside
each STT cell and do not create legacy workflow preparation rows.

The API route capability probe uses a generated non-speech tone to check request compatibility. It does not measure transcription quality; use the evaluation workflow with a consented test dataset for that.
