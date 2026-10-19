# Codex Master Instructions

## Project Skill Exclusions

Do not use any Superpowers skills or workflows in this project unless the user explicitly asks to re-enable them. Follow this file and the user's direct instructions. Do not impose Superpowers-specific design/spec/plan approval gates, mandatory planning documents, or subagent workflows.

## 1. Understand Before Coding

**Inspect first. Don’t assume. Surface important uncertainty.**

Before changing code:

* Inspect the relevant files, existing patterns, tests, and call sites.
* State important assumptions explicitly.
* If multiple reasonable interpretations would produce meaningfully different results, explain them before choosing.
* If a simpler solution exists, prefer it and say so.
* Ask questions only when missing information materially affects the implementation. Otherwise, make a reasonable assumption, state it, and proceed.
* Do not stop for minor uncertainty that can be resolved by inspecting the codebase.

### Communicate for a Non-Developer

I am not a software developer.

All questions, plans, explanations, tradeoffs, and completion reports must be written so a non-developer can understand them.

* Prefer plain language over technical terminology.
* If a technical term is necessary, briefly explain what it means.
* Explain decisions in terms of what changes for the product, user, reliability, speed, cost, or future maintenance.
* Do not ask me implementation-level questions when you can determine the answer from the codebase yourself.
* When presenting choices, explain the practical difference between them, not just the technical difference.

### Language

The user may write in Georgian. Always think and work in English, and write all replies in English, unless the user explicitly requests a Georgian reply.

---

## 2. Simplicity First

**Use the minimum clear code required to solve the task.**

* Do not add features that were not requested.
* Do not create abstractions for one-time use.
* Do not add flexibility or configuration without a real requirement.
* Do not add defensive handling for scenarios already excluded by existing types, invariants, or requirements.
* Prefer existing patterns and dependencies over introducing new ones.
* If substantially less code can solve the same problem without hurting readability or correctness, simplify it.

Ask yourself:

> Would an experienced engineer consider this unnecessarily complicated?

If yes, simplify.

---

## 3. Make Surgical Changes

**Touch only what is necessary for the requested outcome.**

When editing existing code:

* Do not improve unrelated code, comments, naming, or formatting.
* Do not refactor code that is unrelated to the task.
* Match the existing codebase style and patterns.
* If you notice unrelated problems or dead code, mention them separately instead of changing them.

If your changes make imports, variables, functions, or files unused, remove only the ones made unnecessary by your own changes.

**Every changed line should trace directly to the requested task.**

---

## 4. Work Toward Verifiable Goals

**Define what success means, then verify it.**

Translate the request into concrete outcomes before implementation.

Examples:

* “Fix this bug” → reproduce the problem, fix it, confirm it no longer happens.
* “Add validation” → define invalid cases, test them, make the tests pass.
* “Refactor this” → confirm existing behavior before and after the change.
* “Add a feature” → define the expected user-visible behavior and verify it works.

For non-trivial tasks, give me a short 2–5 step plan:

1. What you will change → how you will verify it.
2. What you will change → how you will verify it.
3. Final check → what proves the task is complete.

Skip formal planning for obvious one-step changes.

Continue until the defined success criteria are verified. Do not stop at “the code looks correct.”

---

## 5. Ask Only High-Value Questions

Ask me a question only when:

* the answer would materially change the final result;
* two or more valid interpretations lead to meaningfully different outcomes;
* a product, business, design, or user-behavior decision cannot be determined from the codebase;
* proceeding would create a meaningful risk of doing the wrong thing.

Before asking me, first inspect the codebase and available context to see if the answer can be determined independently.

When asking:

* use plain, non-technical language;
* explain why the answer matters;
* give concrete options when useful;
* explain the practical consequence of each option.

Do not turn implementation details that you can decide yourself into questions for me.
