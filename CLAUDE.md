# Global Rules

User-level defaults for Claude Code. These apply to every project. Project-specific details (stack, commands, conventions) live in a `PROJECT.md` at each project's root. Make sure to read this entire document before providing an answer.

## Project context

- At the start of a session, read `./PROJECT.md` from the project root and follow it for stack, commands, conventions, and do-not-touch rules.
- If `./PROJECT.md` is missing, ask me whether to create one. Do not guess project specifics.
- When `PROJECT.md` and these global rules conflict, `PROJECT.md` wins for project-specific facts; these global rules win for communication and engineering conduct.

## Communication

- Audience is a CS undergraduate: explain reasoning in plain terms and define any non-obvious concept.
- Structure every response: state the purpose first, then ordered points from most to least important.
- Be brief. Give the main point and the details that matter; cut tangential examples. Expand only when asked.

## Engineering

### Architecture (top priority)

- Architecture first: read the architecture defined in `PROJECT.md` before writing, creating, or moving any code.
- Prioritize the defined architecture. By default, place every file, module, and test where it dictates and respect its layer and module boundaries.
- Only create a new directory or branch off from the defined structure when it is genuinely necessary — never for convenience. Reuse an existing location that fits before adding one.
- When you do branch off, flag it explicitly in your response: state what you added, where, and why, and whether `PROJECT.md` should be updated to reflect it. Do not bury it.

### Practices

- Delegate heavy implementation to subagents: use the Task tool to spawn Sonnet agents for large or parallelizable coding work. Keep small edits, planning, and explanation on the main thread.
- Do all implementation by spawning Sonnet/Terra subagents. Do not implement with Opus/Sol.
- Fail fast. Surface errors at their source. Do not add fallbacks, catch-all handlers, silent retries, or default values that hide a broken state.
- No TODOs. Do not leave `TODO` comments, placeholder stubs, or "implement later" gaps. If a task can't be finished, stop and explain why.
- Automatically compact context when the context window is >78%.
- When finishing implementations, write a summary to `/docs`.

### File creation boundaries

- Create permanent files only inside the project root. Never write permanent files elsewhere on the system: home directory, parent directories, sibling repos, or global locations.
- If you don't know where a file belongs, do not guess or invent a location. In interactive mode, ask me. In non-interactive / headless mode, stop and fail with an explanation (per Fail fast).
- Throwaway/scratch files go in `./.scratch/` (gitignored) or the system temp dir. Never commit them and never place them outside the project.
- Changing system or global configuration outside the project — global installs, shell/rc files, `~/.gitconfig`, `~/.ssh`, and similar — requires my explicit approval first.
- This rule governs files you deliberately create for a task. It does not restrict Claude Code's own managed state (e.g. `~/.claude/`), which the tool writes regardless.
