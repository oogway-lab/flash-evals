# Pipelines

[Documentation home](../README.md#documentation)

A pipeline splits one task into steps and chains them: each step's answer is
the next step's input. Use one to test whether a few smaller models, each doing
part of the job, can replace one large prompt.

## Build a text chain

1. **Pipelines → New pipeline**, choose **Text** and the dataset whose items
   the chain reads. The canvas starts with one Input block bound to it.
2. Add a **Prompt** block per step. A Prompt block runs a saved prompt version
   (its output schema included) on the model you pick. Use **LLM text** for a
   step written inline that returns plain text.
3. Connect Input → step 1 → step 2 → step 3 by dragging between the handles.
   A step reads the answer of the step it is connected from: the JSON text of
   a structured answer, or the plain text otherwise.
4. Save the canvas, then **Run flow**. The run page lists each item's steps in
   order, with their output, cost and routing (the provider and, when the
   gateway says, the hosting company that served the step).

### Wait for a step without reading its answer

A step connected from two steps reads both answers, each in a
`<from node="label">…</from>` block. Sometimes a step only needs to run
after another step, so its **Run this step** condition can check that step,
while it still reads the original input. Click the connection on the canvas
and choose **Wait for _step_ only**: the line turns dashed and is labelled
"order only". Such a connection passes nothing on. A step whose only
incoming connections are order-only reads the original item text, as a first
step does; beside an ordinary connection it reads only that connection's
answer. Only Prompt and LLM text steps can wait this way. If the step it
waits for is skipped, it is skipped too. In the API and MCP, set
`"orderOnly": true` on the edge.

## Choose a step's provider

Open a step and pick its **Provider** and **Model** under **Simple mode**, or
save a route under **Advanced verified route configuration**. The providers
are OpenAI, Vercel AI Gateway, OpenRouter and Bifrost, plus the makers' own
APIs: **Anthropic** and **Gemini API** appear once that key is saved in
Settings (the Gemini key serves both). A step on a maker's API calls the
maker directly with the Settings key, never a key from `.env` or your shell,
using the maker's own model ID from the model registry (for example
`claude-sonnet-4-6` for Claude Sonnet 4.6); only the models listed in
[configuration](configuration.md#model-providers) are offered, and listing them
sends no request to the maker. Such a step is recorded as served by
"anthropic" or "google", and its calls share the per-provider limit
(`FLASH_EVALS_PROVIDER_CONCURRENCY`) with eval runs.

With no key saved in Settings, a **Vercel AI Gateway** step uses
`AI_GATEWAY_API_KEY` and a **Bifrost** step `BIFROST_API_KEY` and
`BIFROST_BASE_URL` from `apps/api/.env`, as eval runs do; a key saved in
Settings wins. OpenAI and OpenRouter steps need the key saved in Settings. See
[configuration](configuration.md#model-providers).

## Step settings

Open a Prompt or LLM text step and fill in **Step settings**:

- **Step temperature** (0 to 2) and **Step output limit (tokens)**: sent on every call
  of the step, on every provider, in Simple mode and on a saved route alike.
  Blank keeps the route's setting; in Simple mode that is 4,096 output tokens
  (32,768 for Gemini 3) and no temperature. Models that refuse temperature
  (OpenAI reasoning models, per the model registry) are sent none. The output
  limit includes thinking tokens.

- **Output mode** (Prompt steps, which have an output schema):
    - **Strict JSON schema** (the default, as before): the provider makes the
      reply follow the schema.
    - **JSON mode**: the provider is asked for any JSON object
      (`response_format: json_object`; the AI SDK's JSON output on Vercel AI
      Gateway and the makers' APIs). OpenAI requires the word "JSON" in the
      prompt.
    - **Text, then read the JSON**: no format is asked for; the JSON object is
      read from the reply, also from a fenced code block or from prose around
      it.

    In the last two the schema checks the parsed answer. A reply with no JSON
    object, or one that doesn't match the schema, fails the step with the
    reason, for example "The step's answer doesn't match its output schema:
    $.title must have required property 'title'."

- **Input template**: builds the step's message (after its prompt) instead of
  the default, which is the item text in `<input>…</input>` or the connected
  steps' answers in `<from node="…">` blocks. Placeholders use the same
  `{{…}}` syntax as final-answer templates:
    - `{{input}}`: the whole dataset item.
    - `{{input.<name>}}`: the content of the item's `<name>…</name>` section,
      for example `{{input.transcript}}` or `{{input.user_persona}}`; for an item
      that is a JSON object, its field (`{{input.customer.name}}`).
    - `{{input.<name>.<field>}}`: a field of the JSON inside the item's
      `<name>…</name>` section, for example `{{input.user_persona.name}}` for
      `<user_persona>{"name": "…"}</user_persona>`. A section named exactly
      `<name>.<field>` still wins; when the section isn't JSON, the value is
      missing.
    - `{{Extract.$.title}}`: a field of an earlier step's answer (named by its
      label or key; `$` for the whole answer). Only steps upstream of this one
      can be read; connect a step with **Wait for _step_ only** to read it
      without it also being passed in.
    - `{{Extract.$ | pick:title,product,customer_details}}`: some fields of an
      answer as one JSON object.
    - `| default:"text"` after any placeholder: used when the value is missing
      or empty, for example `{{input.user_persona | default:"Unknown"}}`.

    A missing value, or a field of a skipped step, is written as nothing; text is
    written as is and anything else as JSON. For example:

    ```text
    <transcript>{{input.transcript}}</transcript>
    <call>{{Extract.$ | pick:title,product}}</call>
    ```

    Saving checks every placeholder and says plainly what's wrong, for example
    'The input template of "Write" reads "Notes", which doesn't run before it.'

A step's thinking level is sent in each maker's own setting (see
[configuration](configuration.md#thinking-settings)). When the step's route
can't send it, the step still runs and its result says "Not sent" with the
reason, beside its thinking tokens.

In the API and MCP the node carries `stepSettings`, for example
`{ "temperature": 0, "maxOutputTokens": 8000, "outputMode": "text",
"inputTemplate": "{{input.transcript}}" }` (`outputMode` is `json_schema`,
`json_object` or `text`); `null` clears it. Saving
checks the values and refuses settings on other kinds of blocks. The settings
are captured in the run, so later edits don't change a run already started.

## Spend limit, data rules and cancelling

Under **Run flow**, open **Spend limit and data rules** before starting a run:

- **Spend limit (USD)**: the worker stops starting steps once the run's
  recorded spend (step calls, the judge calls that score them and shared
  audio transcription) reaches it. Calls already sent finish, so a run can
  end slightly over. The run ends "Stopped at spend limit"; start a new run
  with a higher limit to finish it.
- **Data rules**: which hosting companies may serve the run's step and judge
  calls, and whether they must keep no data or not train on prompts. They
  apply to every model-backed step and to the judges that score steps.
  Steps on a Vercel AI Gateway or OpenRouter route can follow them, and so
  can a Bifrost step whose Bifrost model ID starts with `openrouter/`
  (Bifrost passes OpenRouter's settings on; see
  [configuration](configuration.md#bifrost)). A step on an OpenAI route, a
  Bifrost step on another upstream (for example `gemini/…`), or an
  OpenRouter route pinned to a host the rules don't allow, stops the run
  from starting, with the reason. A step on Anthropic or the
  Gemini API is served by the maker itself, so, as in eval runs, it can run
  only when the rules are an allowed-host list that names the maker
  (`anthropic`; `google` or `google-ai-studio`) with no-retention and
  no-training off. While rules are set, steps
  don't reuse stored results. Speech-to-text transcription is not covered.

**Cancel run** on the run page stops a pending or running run: calls already
sent finish, steps not started are shown as not run, and **Resume run** runs
them later. A run whose setup failed shows the error with **Retry failed
cells**; a run no worker has picked up after a minute says so, with a retry
that does nothing while the run is still waiting in the queue. The same
actions are in the API and MCP (`cancel_workflow_run`, `retry_workflow_run`).

Pipelines created through the API or MCP without an input block (kind
`prompt`) open on the same canvas. They accept only Prompt blocks; a step with
no incoming connection reads the dataset item's text, and they run on text
datasets.

## End the chain early

A step can run only when an earlier step's answer matches. Open the step,
and under **Run this step** choose **Only when _step_ matches**, the field to
check (for example `$.is_sales`), **is** or **is one of**, and the value or
values. `true`, `false`, `null` and numbers match those JSON values; anything
else is text (quote text that looks like one, such as `"true"`). Use `$` to
check a plain-text answer as a whole.

Tick **Ignore case** on a condition to match text whatever its upper and
lower case ("Sales" matches "sales"); in the API and MCP set
`"ignoreCase": true` on the condition.

To check more than one field, **Add condition**: each extra condition picks
its own earlier step, field and values, and the step runs only when all of
them hold (for example Extract `$.archived` **is** `false` and Extract
`$.type` **is** `sales`). Remove an extra condition with its bin button. In
the API and MCP, `runCondition` is either one condition or
`{ "all": [condition, …] }`; a saved single condition keeps working as it is.

For each item where the condition does not hold, that step and every step
after it are recorded as **Skipped** with the reason (for example "runs only
when Classify $.is_sales is true (it was false)"; with several conditions,
the first one that does not hold). Skipped steps make no
model call and cost nothing, and they count as done, so the run still
completes. A step can only check a step that runs before it; the canvas and
the API reject anything else.

## Final answer

To compare a chain with one big prompt, give the pipeline a final answer:
one JSON object per item, in the same shape as the big prompt's output.
Under the canvas, **Add final answer**, then map each field to a step and a
field of that step's answer, for example `$.product` ← Extract `$.product`
and `$.mom` ← Notes `$.mom` (use `$` to take a step's whole answer). Choose
**Check against the output schema of** to pick a prompt version whose output
schema the answer should match; **List the schema's fields** fills in one
row per top-level field. Save the canvas.

When every step for an item has finished, the run records its final answer,
shown under the item's steps on the run page, with the item's cost (the sum
of its steps; skipped steps cost nothing). Fields of skipped or failed steps
are left out, unless a skipped step's field has a fallback (below). A schema
mismatch (for example a required field whose step was
skipped) is reported next to the answer, not treated as a failure. An item
with a failed step is marked "A step failed". A failed model step's result
shows the provider's own message after the kind of failure, for example
"Workflow LLM invocation failed (provider_error): 404 No allowed providers are
available for the selected model …", with keys and tokens removed and cut at
1,000 characters.

### Fallbacks for skipped steps and empty values

When a gate skips steps, the final answer can still be complete. Open
**If skipped or empty** under a field:

- **When the step is skipped**: leave the field out (the default), **Use a
  fixed value** (for example `Not discussed`; `true`, `false`, `null` and
  numbers are those JSON values), or **Fill in from other steps** with a
  template. A template is text with placeholders `{{step.$.field}}` that
  take values from steps that ran, naming the step as on the canvas (or by
  its key), for example `## {{Extract.$.title}}` then a blank line and
  `{{Extract.$.archive_reason}}`. Use `$` for a step's whole answer. A
  value that is missing is left blank; a template that is only one
  placeholder keeps that value's type (a list stays a list).
- **When the value is empty** (missing, `null`, blank text or `[]`, from a
  step that ran): the same choices. Left unset, an empty value takes the
  skipped-step fallback when there is one, and otherwise stays as it is.
- **Replace values**: swap an exact value for another, for example a blank
  value for `Customer`. Replacements apply before the empty check.

Templates take the same `| default:"text"` filter as input templates, for
example `{{Notes.$.summary | default:"Not discussed"}}`.

### Set a field by a rule

Open **Set by a rule** under a field and **Add rule** to set the field to a
fixed value when a step's field matches, for example `$.archived` set to
`true` when Extract `$.type` is `non-sales` (tick **Ignore case** to also
match `Non-Sales`). Several values, separated by commas, match any of them.
Rules are checked first, in order, and only on steps that ran; when none
matches, the field is taken from its step as usual (with its fallbacks). In
the API the field carries `setWhen`:
`[{ "when": { "stepKey": "extract", "path": "$.type", "operator": "equals", "values": ["non-sales"], "ignoreCase": true }, "value": true }]`.

A failed step's field is still left out. These settings are plain values and
templates only (no code); saving checks that every placeholder names a step
of the pipeline and a field path. In the API the field carries `fallback`
and `whenEmpty` (each `{ "value": … }` or `{ "template": "…" }`) and
`valueMap` (`[{ "from": "", "to": "Customer" }]`).

## Compare with the reference

A pipeline with a final answer can take the same test as the models in an
eval run. Under **Run flow**, **Compare with an eval run** lists the finished
eval runs (completed, or partial: every cell ran and failed cells count as
failures) on the pipeline's dataset that have a benchmark Task Map. A
cancelled or unfinished run is not offered. The list is disabled, with the
reason, while the pipeline has no saved final answer.

The comparison reuses that run unchanged, so later edits to it don't change
the test:

- **The Task Map and targets** (policy), and each task's yardstick: the
  reference model's answers in that run and/or the stored answers. Rule checks
  and rubrics need neither.
- **The judge** (model, provider and reasoning effort) and the run's output
  budget.
- **The data rules**: the judge calls follow that run's rules. When this
  pipeline run has its own rules too, a judge call must satisfy both: only
  hosts both lists allow, and no-retention or no-training when either asks.
  The run is refused when the two host lists share none, or when the judge
  can't follow the combined rules (for example a judge on Anthropic directly
  under a no-retention rule).

The pipeline is one candidate against that run's reference model, item by
item, on the items both runs have. After the run records the items' final
answers, the worker scores each one with the same scoring eval cells use; an
item with a failed step is not scored and counts as a failure, as a failed
eval cell does, and fields of skipped steps are simply absent from the answer.
Judging counts toward the run's spend limit and stops with it (cancel or
limit); answers not reached are scored when the run is resumed. An answer that
changes on resume (a failed step ran again) is scored again.

The run page shows **Compared with _run_** above the items: the same answer
card, task grid and models table as the eval run page, with the pipeline as
the candidate and the reference shown as "Reference". Cost per call is the
cost of one item, the sum of its steps (skipped steps cost nothing), compared
with the reference's cost on the same items. Each item's final answer shows
its score against the reference and what judging it cost.

## Compare setups in one launch

To compare single models and pipelines with today's model at once, use
**Runs → Compare setups** instead of launching each run yourself:

1. **What runs today**: the dataset, the big prompt's version and today's
   model (the reference).
2. **What must stay the same**: review the proposed Task Map and targets, and
   the judge for judged tasks (the same Task Map review as a new run).
3. **Setups to try**: cheaper models (they run the same prompt version) and
   saved pipelines. Only pipelines that read the chosen dataset are listed; one
   without a final answer is shown greyed out with the reason. Each shows its
   rough cost per item.
4. **Check and start**: the pilot size, output limit, one **spend limit** for
   the whole comparison and the **data rules** for every run in it. The panel
   on the right estimates the cost (from list prices; a pipeline is priced as
   if every step ran on every item) and, roughly, how long it takes.

**Start** creates one eval run (today's model and the single models) and one
pipeline run per pipeline, compared with that eval run on its items, and
opens the comparison page. Nothing is created if any of them is refused (for
example a pipeline whose input block reads another dataset); the error names
the pipeline. With no pipeline chosen, Start creates a plain run, as before.

- The pipeline steps start at once, alongside the eval run. A pipeline run
  whose steps are done before the eval run has finished waits ("Steps done.
  Its answers are scored once the eval run finishes") and scores its final
  answers when the eval run ends.
- The spend limit is shared: every run's model, step and judge calls count
  toward it, and each run stops starting calls once their total reaches it.
- **Cancel comparison** cancels every run in it. Each run keeps its own page
  (linked from the comparison page) with Retry and Resume.
- The comparison's status comes from its runs: running while any runs,
  stopped when any was cancelled or hit the limit, partial when one failed.
  The page says when a run hasn't been picked up by a worker.

### The comparison page

The comparison page ranks every setup in one table, scored with the eval
run's Task Map, targets and judge:

- **The answer** at the top, from the same verdict code as an eval run: which
  setup comes closest to replacing today's model and at what share of its
  cost. It says "setup" when the candidates mix models and pipelines.
- **One row per setup**: today's model (verdict "Reference"), each single
  model, and each pipeline named with its steps' models, for example
  "Three steps (Model A → Model B → Model C)". Each row shows the verdict, the
  accuracy (the average of its task results: agreement, or the won-or-tied
  rate for judged tasks; today's model counts as 100% where it is the
  yardstick), cost per call (a pipeline's is one item's cost, the sum of its
  steps), cost against today's model, latency, and how many items are scored,
  still waiting and failed (failed items count as misses). Each name links to
  the run behind it; expand a row for its task details.
- **Not beaten on accuracy and cost** marks the setups no other setup beats
  on both: none is at least as accurate and costs no more per call while being
  better on one of the two. Those are the setups worth choosing between.
- **Task by task**: each setup's result on each task against its target.
- **Runs**: the eval run and each pipeline run, with their status and what a
  waiting run is waiting for.

The page refreshes while the comparison runs. Pipeline rows fill in once the
eval run has finished and their answers are scored.

The same is available in the API (`POST /api/setup-comparisons`,
`GET /api/setup-comparisons/{id}` with `ranking`) and MCP
(`create_setup_comparison`, `get_setup_comparison`,
`cancel_setup_comparison`).

## End to end: one big prompt against a three-step chain

The example is made up: sales-call transcripts for Acme snacks, where one big
prompt returns the products and competitor lists, whether it was a sales call,
the points discussed and the meeting notes.

1. **Run the big prompt as the reference.** **Runs → New run**, pick the text
   dataset and the big prompt version, add the model you use today (first, so
   it is the reference) and at least one other model. Turn on **Compare with a
   benchmark model**, review the proposed Task Map and start the run. Wait
   until it completes.
2. **Write the three step prompts.** Under **Prompts**, save one prompt per
   step, each with an output schema: _Extract_ (`products`, `competitors`,
   `is_sales`), _Points_ (`points_discussed`) and _Notes_ (`meeting_notes`,
   written from the points).
3. **Build the chain.** **Pipelines → New pipeline**, choose **Text** and the
   same dataset. Under **Add block**, add three **Prompt** blocks and pick
   _Extract_, _Points_ and _Notes_ with their models. Connect Input → Extract →
   Points → Notes.
4. **End it early for other calls.** Open _Points_, and under **Run this
   step** choose **Only when Extract matches**, field `$.is_sales`, **is**,
   value `true`. On a call that isn't a sales call, Points and Notes are
   skipped and cost nothing.
5. **Assemble the final answer.** Under the canvas, **Add final answer**,
   choose **Check against the output schema of** the big prompt's version and
   **List the schema's fields**. Map `$.products`, `$.competitors` and
   `$.is_sales` to the same fields of Extract and `$.meeting_notes` to Notes
   (map a field to Points too if the big prompt's schema has one). Remove
   rows for fields the chain doesn't produce. **Save canvas**. On a call
   that isn't a sales call, the Notes fields are left out of the answer.
6. **Run it against the reference.** Under **Run flow**, choose the run from
   step 1 in **Compare with an eval run**, optionally set a spend limit, and
   **Run flow**. The run page answers whether the chain can replace the big
   prompt's model, task by task, at what share of its cost per item.

Or skip step 1 and step 6: build the chain first (steps 2 to 5), then
**Runs → Compare setups**, pick the dataset, the big prompt's version and
today's model, review the Task Map, tick the cheaper models and the chain
under **Setups to try**, set one spend limit and **Start**. One launch runs
the reference, the models and the chain together, and the comparison page
ranks them in one table.
