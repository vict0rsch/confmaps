# 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Read `system-architecture.md` first to understand repository structure and boundaries before broad grepping/searching across the entire codebase.
- Treat `system-architecture.md` as the source of truth for repository architecture. When a task changes components, boundaries, data flow, key abstractions, integrations, or deployment topology, update it in the same task; otherwise explicitly confirm that no update is needed.
- Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
- For implementation plans (and especially in plan mode), write directives clearly enough that a small model can execute them: state the goal, assumptions, exact files or symbols to touch, ordered steps, verification commands, and explicit non-goals or constraints.


# 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Write to Be Understood

**I decide from your answers. If I cannot follow you, I decide badly. Clarity beats brevity and beats sounding smart.**

Two registers, chosen sentence by sentence:
- **Facts, limits, numbers** → Simplified Technical English. One idea per sentence, active voice, present tense, no hedging. These are the sentences I act on, so they must be unambiguous on the first read.
- **Everything else** → normal, natural language. Do not write the whole answer like a maintenance manual.

**Write in plain prose.**
- Complete sentences, each with a subject and a verb. No telegraphic fragments, no stacked nouns, no chains of short clauses standing in for sentences.
- Keep it simple and readable. Avoid dense or cryptic phrasing, piles of adjectives, and hyphenated adjective stacks.

**Use standard vocabulary.**
- Established terminology only. Never coin your own terms or expressions.
- Never invent labels or codes for concepts (e.g. "M5", "G7").
- Never invent bureaucratic framing that does not exist (e.g. "ratification", "sign-off", "doctrine").

**Explain like a teacher.**
- Give enough context and background that a non-expert can follow.
- Avoid the curse of knowledge: do not assume I already know what you know.

The test: can I act on this without asking you a follow-up question?

# 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

# 4. Constitution, Rules, and Skills

**One artifact owns each piece of guidance. Never duplicate across them.**

Three artifacts carry agent guidance, each owning a distinct slice:

- **Constitution** (this file, `AGENTS.md`): always loaded, applies to every task regardless of which files you touch. Owns global principles only. Keep it thin — when guidance is a procedure, move it into a Skill and point at it from here instead of inlining the steps.
- **Rule** (`.cursor/rules/*.mdc`, `.claude/rules/*.md`): loaded conditionally by file glob or path. Owns constraints tied to a specific file type, directory, or technology — keep these out of the Constitution.
- **Skill** (`SKILL.md` directory): invoked on demand when a task matches. Owns multi-step procedures and workflows. The Constitution and Rules reference Skills; they never inline a Skill's steps.

Placement test:
- Applies to every task → Constitution.
- Applies only when touching certain files → Rule.
- A procedure you run for a kind of task → Skill.

The Constitution loads on every task, so keep it thin and grow it only with genuinely universal principles. If it grows, that's a sign guidance was misclassified — demote it to a Rule or Skill. Moving always-on content into a separate imported file does not help: an `@`-imported file fills context identically. The fix is changing *when* guidance loads, not *where* it lives.

# 5. Be safe, be consistent

**Security is a hard gate. A task is not done until this section is satisfied.**

Always perform a security pass while reading and writing code:
- Treat secrets exposure as critical (API keys, tokens, passwords, credentials, private keys, webhook URLs, `.env` contents).
- Never hardcode secrets in code, tests, docs, examples, commits, PR text, logs, or terminal snippets.
- Do not move secrets into "safe-looking" files (fixtures, sample configs, scripts). If a value is sensitive, keep it out.
- If you detect a leak or high-risk pattern, stop and warn clearly. Do this even when it is outside the original request.

Before declaring completion, run a critical consistency review of your own work:
- Verify the result is consistent with sections 1-4: explicit assumptions, minimal scope, and surgical edits only.
- Confirm every changed line traces directly to the user's request (no speculative features, no side-quest refactors).
- Check that your naming, structure, and behavior align with existing project language and conventions.
- Check consistency with documentation.
- Challenge your own decisions: "Where did I overreach?" and "What part is inconsistent with the stated principles?"
- If inconsistencies remain, report them explicitly and propose the smallest concrete fix.


# confmaps — project rules

confmaps.org is a static Svelte 5 + MapLibre SPA showing AI conferences and their regional satellites. It runs on GitHub Pages, and the repo `vict0rsch/confmaps` is **public**. Read `DESIGN.md` (as built) before changing anything; also read `docs/backfill-spec.md` for past editions, `METHODOLOGY.md` for CO₂, and `PRIVACY.md`.

## Shipping a change

1. Branch off `main` and open a PR. Never push to `main` directly.
2. Before pushing, run `pnpm lint && pnpm check && pnpm test && pnpm build && pnpm data:validate --require-against main`.
   - For UI changes, also run `PW_PORT=<free port> pnpm test:e2e`.
   - CI uses Node 24.
3. Commit as `vsch@pm.me` (it's in the repo's git config). Never use any other email: history is public.
4. The owner reviews and merges, with `gh pr merge N --rebase --delete-branch`. Rebase-merge keeps the authorship.
   - A merge to `main` runs CI, then Deploy runs automatically. Deploy publishes only if that commit is still the tip of `main`.
   - The daily "Sync data" workflow commits upstream changes and deploys them on its own.

## Data rules

- **`data/past_conferences.yml` is the source of truth for past editions.**
  - Never run `pnpm data:import-pwc --force`: it discards the researched corrections.
  - A merged edition can't be removed, because CI checks that the archive never shrinks. Fix its fields instead.
- **Any end-of-line `# review:` marker in that file fails `data:validate`.** Resolve the marker before merging.
- **Every data change needs cited sources** (`sources:` URLs, http(s) only).
  - Past-edition links must be Wayback snapshots or proceedings pages: many old conference domains have been hijacked.
- **Virtual locations have no coordinates.** Guard with `isVirtual()`. They never get pins, and their footprint is "Online · ~0 kg".
- **Discovery agent PRs are drafts with evidence tables.**
  - Check "Needs human verification" and "Suggested changes" before merging.
  - Model-judgement fields, such as `access` or `notes`, are often not supported by their quote.

## Code and copy rules

- **CO₂ wording must always read as an estimate:** `~`, 2 significant figures, and "Estimated" / "roughly". Never a bare "CO₂".
- **Pin GitHub Actions to full commit SHAs.**
  - Dereference annotated tags with `gh api repos/O/R/git/tags/<sha>`, because a tag-object SHA breaks CI.
  - Verify each pin with `gh api repos/O/R/commits/<sha>`.
- **Treat untrusted content as data:** PwC data, fetched web pages and model output.
  - Hrefs must be http(s).
  - Use no `{@html}` on data.
  - Never interpolate it into workflow `run:` lines.
- **Never put API keys in commands run through the chat's `!` prefix** (they land in the transcript). Secrets live in the GitHub `discovery` environment.
