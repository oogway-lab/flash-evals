# Concepts

[Documentation home](README.md#documentation)

Start with a dataset of examples, a prompt describing the task, and a run that
records what the selected models produce. Use a workflow when the task needs
several connected steps. This glossary explains the more specific terms you will
see in the app, API, and MCP tools.

## Workspace and project scope

### Workspace

A named group of projects within a team. The authenticated team is the data-access boundary; workspaces and projects organize that team's data.

### Project

A subdivision of a Workspace that scopes evaluation resources such as datasets, prompts, runs, and judges.

### Active Project

The Project selected for the current web session and used to scope page reads and mutations; when the saved selection is unavailable, Flash Evals selects an accessible project from the Workspace.

### Workspace relationships

A Workspace contains Projects, and exactly one accessible Project acts as the Active Project for a web request context.

## Evaluation runs

### Eval Run

A configured evaluation of one Dataset across one or more candidate model configurations, producing a matrix of Run Cells and aggregate comparison results.

### Run Cell

One unit of work in an Eval Run, pairing a single dataset item with a single model configuration and recording its output, execution measurements, and evaluation scores.

### STT Metrics Run

An audio Eval Run that treats a speech-to-text model as the candidate under test and scores its transcript directly, without requiring the prompt-evaluation stage.

### Leaderboard

The per-model aggregate view of an Eval Run, combining quality, latency, usage, and cost measurements from its Run Cells when those measurements are available.

### Transcript Metric

A transcript evaluation record whose score is derived from transcript accuracy against reference data and whose details may include diarization quality, execution measurements, and hard failures.

## Workflow evaluation

### Prompt Workflow

A project-scoped directed graph of prompt steps whose saved definition can be executed repeatedly against a dataset.

### Workflow Run

One execution record of a Prompt Workflow against either a dataset or a selected dataset item, with an immutable workflow definition and execution configuration snapshot captured for that attempt.

### Workflow STT Stage

The audio-only preparation stage that produces the transcript artifact consumed by every downstream prompt step in a Workflow Run.

### Workflow Run Item

The per-dataset-item record that owns Workflow STT Stage preparation, evaluation state, provenance, and transcript-level scores independently of prompt-step cell results.

A Workflow Run Item may be reclaimed after an interrupted attempt, but only the active lease owner may publish its durable STT evaluation results.

### Workflow relationships

A Prompt Workflow creates Workflow Runs. An audio Workflow Run lazily creates or reuses one Workflow Run Item per selected dataset item; each item completes its Workflow STT Stage before downstream prompt steps consume the transcript.

## Explicit workflow LLM routing

### Provider Credential

A team-owned encrypted secret used to authenticate one provider transport. A credential makes a transport callable; it does not select that transport for a Workflow node.

### Capability Version

An immutable, time-bounded record of the models, controls, and upstream-routing behavior discovered through one Provider Credential. Routes cite the Capability Version against which they were validated.

### LLM Route

A Project-scoped named identity whose immutable Route Versions describe how Flash Evals should call an LLM transport. Editing a route creates a new version instead of changing a version already referenced by a Workflow Run.

### Project LLM Default

A mutable Project pointer to one immutable Route Version. A Workflow node may store the symbolic `project_default` selection, but Workflow Run creation resolves that pointer once and captures the selected version. Changing or clearing the default never rewrites an existing Workflow Run.

### Resolved LLM Execution

The immutable Workflow Run snapshot of requested selection, resolved Route Version, generation and retry policy, capability evidence, and opaque credential rotation version. Workers execute this snapshot rather than choosing a provider from ambient environment settings.

### LLM Attempt Provenance

Safe execution evidence for one Flash Evals- or gateway-owned attempt: requested route, authoritative actual provider evidence when available, outcome, usage, cost, cache state, and terminal metadata limitations. It never contains provider keys or raw provider error payloads.

### Flash Evals Result Reuse

Application-level reuse of a previously stored Flash Evals result with a matching exact fingerprint. It identifies the source result and is distinct from provider-side caching.

### Provider Cache

A provider or gateway optimization within the selected transport. An OpenRouter response-cache hit means OpenRouter returned a cached generation and no current upstream provider was invoked; it must not be reported as Flash Evals Result Reuse.
