# AI-use assessment: interpretation and calibration

Overview's percentage is a **triage score**, not a statistically calibrated
probability that a student used AI. The current evidence combines browser
writing events (pastes, revisions, timing and tab-change sequences) with
optional language-model text inspection. Neither source can establish
authorship. Browser events are client-controlled and may be incomplete; text
classifiers may mistake polished, formulaic, assisted or second-language
writing for AI output.

## Current safeguards

- A paste is reported as an observable insertion, not as proof of AI origin.
- Process-only analysis cannot reach the high-risk band from a paste alone.
- Short responses or sparse event logs cannot reach the high-risk band; a
  document-only language score is capped because style cannot prove origin.
- Empty telemetry and failed batch analysis are **not assessed**, never zero.
- The teacher's review threshold is applied only with sufficient evidence;
  an assignment that permits AI use is not automatically recommended for
  misconduct review.
- The teacher sees the assignment policy, evidence completeness and replay
  integrity caveat beside the score. Flagging and revision requests require
  an explanation for the student.
- The teacher, not the score, makes the final decision.

## Scenarios to include in a local evaluation corpus

1. Fully typed original work, including fast typists and minimal revisions.
2. Student-drafted work pasted from a local document or accessibility tool.
3. AI-permitted work with transparent and undisclosed AI assistance.
4. AI-generated work retyped manually over a long session.
5. Multiple short writing sessions, offline reconnects and browser crashes.
6. Short responses, template-driven answers and quotations.
7. Non-native English, translated, dictated and screen-reader-assisted work.
8. Deliberately manipulated or missing client telemetry.

Record consented ground-truth provenance, assignment policy, response length,
device/browser and whether events were complete. Report false-positive rate and
false-negative rate at each teacher threshold, with confidence intervals and
subgroup checks. Do not advertise the score as a probability or select a
universal threshold until the corpus is large and representative. Tune the
weights and thresholds against a held-out set, not the same essays used to
design the heuristic. Preserve teacher override and an appeal path.

## Deployment note

The local tests in this repository cover compilation and a rate-limit
regression. They are **not** a calibrated accuracy study or a production
Supabase integration test. Apply migration 007 only after its preflight and
backup steps, then run the teacher/student smoke flow against a staging
Supabase project before updating production.
