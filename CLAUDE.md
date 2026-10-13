# Working rules

## Model routing (save tokens)

- **Codebase lookups go to a subagent.** For "where is X defined", "who calls Y", "does Z already exist": use the `Explore` agent with `model: "haiku"`. Use `model: "sonnet"` when the answer means comparing results across several files. The main model reads only the files it is about to edit or reason about in depth. A single known path or one `grep` is cheaper inline. Don't spawn an agent for those.
- **Each task in `docs/tasks.md` has a model tier.**
  - Opus: 2.3, 3.1–3.6 (except 3.4b), 4.4, 5.3 (domain-heavy, where a wrong model gives plausible-looking numbers), 9.4 (hardware explanations, where a wrong model gives plausible-looking prose); 4.5 and 4.6 (set the visual style and the reading aids every later level inherits).
  - Sonnet: everything else.
  - At the start of a task, if the current model doesn't match its tier, say so before writing code. The user switches with `/model`.
- **Switch models only at session start or right after `/clear`.** Switching mid-task throws away the prompt cache.
- **Escalate instead of retrying.** If a Sonnet session fails the same `Check:` twice and has no new hypothesis, stop and suggest switching to Opus for that fix.
