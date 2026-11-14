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

A run can be cancelled while it is pending or running: calls already sent
finish, cells not started are not run, and the run ends cancelled. Resuming it
runs the remaining cells.

### Run Cell

One unit of work in an Eval Run, pairing a single dataset item with a single model configuration and recording its output, execution measurements, and evaluation scores.

### STT Metrics Run

An audio Eval Run that treats a speech-to-text model as the candidate under test and scores its transcript directly, without requiring the prompt-evaluation stage.

### Leaderboard

The per-model aggregate view of an Eval Run, combining quality, latency, usage, and cost measurements from its Run Cells when those measurements are available. A failed Run Cell counts as a zero golden or judge score wherever another model's cell on the same item was scored, so a model that fails items cannot rank first. The golden score is the field-by-field match with the stored answers; a run saved without field match settings compares every stored field exactly, so the app names it "Exact match, all stored fields" and leaves it out of the models table and chart when the run has a Benchmark comparison, whose tasks are the real comparison.

### Transcript Metric

A transcript evaluation record whose score is derived from transcript accuracy against reference data and whose details may include diarization quality, execution measurements, and hard failures.

## Benchmark comparison

### Benchmark Model

The model whose output a run compares every candidate against, task by task. It is a reference, not ground truth: a candidate can win, tie, or lose against it. A run can instead use the dataset's stored answers as the benchmark (for example production outputs or hand-checked answers); every model is then a candidate and no benchmark calls are made, but cost and latency are still compared with the run's reference model. Each task can also pick its own yardstick: for example a hand-checked label against the stored answers and the other tasks against the Benchmark Model, in one run. The Benchmark Model is then also scored on the tasks that use stored answers.

### Task Map

The list of jobs one prompt's output does (for example competitor mentions, a sales label, a summary), each owning some output fields and scored by agreement with the Benchmark Model or head to head. Proposed from the output schema, then reviewed by a person. A task can instead hold fixed rule checks on each model's own answer, with no yardstick and no model call: text that must not appear, values that must be on a list, text that must be present, and word limits per field (words are runs of non-whitespace; a list of strings counts as one text; a missing or non-text field fails). Put length limits in a word-count check, not in a head-to-head or rubric judge's criteria: LLM judges miscount words.

### Head-to-Head Verdict

A judge's blind comparison of a candidate's and the Benchmark Model's answers for one task and item: win, tie, or loss from the candidate's side. Answer order is fixed per cell and task so re-scoring is reproducible.

### Benchmark Verdict

Whether a candidate can replace the Benchmark Model under a run's policy: pass, conditional, fail, or inconclusive. Each task is judged on one rate (won-or-tied share for judged tasks, mean agreement otherwise) with a 95% interval: it passes only when the whole interval clears the threshold, fails when the whole interval is below it, and is uncertain in between. Fewer than 5 items gives no verdict, and fewer than 20 makes a pass conditional, because a comparison that measured little is unknown, not equivalent. Where the Benchmark Model is scored too (tasks against the stored answers, rule checks and rubrics) and the policy allows a drop, the target is relative instead: a candidate may fall no more than that many points below the Benchmark Model's own rate on the same items (its agreement, or for judged tasks how often it won or tied), judged on the paired per-item difference with the same interval rule. Tasks where the Benchmark Model is the yardstick keep the fixed minimums. The Benchmark Model itself gets no verdict: where it is scored, its values are shown with a neutral "Reference" status, because it is what the candidates are measured against.

## Workflow evaluation

### Prompt Workflow

A project-scoped directed graph of prompt steps whose saved definition can be executed repeatedly against a dataset. The app calls it a Pipeline. Pipelines built in the app start from an Input block (kind `multi`); pipelines created through the API or MCP without one (kind `prompt`) open on the same canvas, where steps without an incoming connection read the dataset item. See [Pipelines](docs/pipelines.md).

### Step Condition

A rule on a pipeline step: run only when a field of an earlier step's answer equals a value or is one of several. When it does not hold for an item, the step and every step after it are skipped for that item: recorded as skipped, with no model call and no cost.

### Final Answer

A pipeline's answer for one item: a JSON object assembled from step answers by a field mapping (each output field taken from a field of one step's answer), optionally checked against a prompt version's output schema. Fields of skipped steps are left out, and its cost is the sum of the item's steps.

### Pipeline Comparison

A Workflow Run compared with a finished Eval Run on the same dataset that has a Task Map. The pipeline is one candidate against that run's Benchmark Model: each item's Final Answer is scored with the run's Task Map, policy, judge and data rules, unchanged, against the Benchmark Model's answer for the item and the stored answers, on the items both runs have. The verdicts are the eval run's own (the Benchmark Model shows as "Reference"); an item with a failed step counts as a failure, and the cost per item is the sum of its steps. The judge calls follow the eval run's data rules, made stricter by the Workflow Run's own, and count toward its spend limit.

### Setup Comparison

One launch that compares setups on one dataset: an Eval Run holding the Benchmark Model (today's model, shown as "Reference") and the single-model candidates, plus one Workflow Run per chosen pipeline, each a Pipeline Comparison against that Eval Run. The pipelines' steps run alongside the Eval Run; their Final Answers are scored once it has finished. All member runs follow the same data rules and share one spend limit (every member's model, step and judge calls count toward it); cancelling the comparison cancels every member, and its status is derived from theirs. Its page ranks every setup in one table from a single verdict summary over the Eval Run's cells and the pipelines' scored Final Answers, and marks the setups not beaten on accuracy and cost: no other setup is at least as accurate (the mean of its task results) and costs no more per call while being better on one of the two. The app calls it Compare setups.

### Workflow Run

One execution record of a Prompt Workflow against either a dataset or a selected dataset item, with an immutable workflow definition and execution configuration snapshot captured for that attempt.

Like an Eval Run, a Workflow Run can carry a spend limit (step, judge and transcription spend) and data rules (which hosting companies may serve its step and judge calls, and what they may keep), set when it is created. It can be cancelled while pending or running: calls already sent finish, steps not started are not run, and the run ends cancelled (or stopped at its spend limit). Resuming it runs the remaining steps.

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

An immutable, time-bounded record of the models, controls, and upstream-routing behavior discovered through one Provider Credential. Routes cite the Capability Version against which they were validated. For a direct maker transport (Anthropic, the Gemini API) the models and controls come from the model registry rather than a provider listing, so recording one sends no request to the maker.

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
