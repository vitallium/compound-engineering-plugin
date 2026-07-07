/**
 * Transform Claude Code content to Vibe CLI-compatible content.
 *
 * Handles platform-specific differences:
 * 1. Task-tracking calls: Task(Create|Update|List|Get|Stop|Output) -> neutral guidance
 * 2. Claude paths: .claude/ -> .vibe/
 * 3. Tool names: AskUserQuestion -> ask_user_question
 * 4. Agent tool references: Agent tool -> task tool
 * 5. Worktree isolation references
 * 6. Skill invocation patterns
 */

/**
 * Transform Claude Code skill/content body to Vibe CLI format.
 * Only transforms the body content, not frontmatter.
 */
export function transformContentForVibe(body: string): string {
  let result = body

  // ========================================================================
  // Phase 1: Task tracking primitives (TaskCreate, TaskUpdate, TaskList, etc.)
  // ========================================================================
  // Vibe documents `task` for subagent delegation, not task-list management.
  // Keep task tracking tool-neutral rather than inventing a Vibe tool name.
  result = result.replace(
    /the platform's task tracking tool \(`TaskCreate\/`TaskUpdate\/`TaskList` in Claude Code[^)]*\)/g,
    'task tracking',
  )

  // Backticked combined task-tracking primitives. Do this before individual names.
  result = result.replace(
    /`TaskCreate`\/`TaskUpdate`\/`TaskList`/g,
    'task tracking',
  )

  // Legacy generated wording from earlier conversions.
  result = result.replace(
    /\(`todo` in Claude Code, `update_plan` in Codex, or the equivalent on other harnesses\)/g,
    '(task tracking or the equivalent)',
  )

  // Plain combined task-tracking primitives.
  result = result.replace(
    /TaskCreate\/TaskUpdate\/TaskList/g,
    'task tracking',
  )

  // Individual task-tracking primitives, including backticked forms.
  result = result.replace(
    /`?Task(Create|Update|List|Get|Stop|Output)`?/g,
    'task tracking',
  )

  // ========================================================================
  // Phase 3: Tool name transformations
  // ========================================================================
  // Pattern: platform's blocking question tool: `AskUserQuestion` in Claude Code
  // Must be done FIRST before individual AskUserQuestion replacement
  result = result.replace(
    /the platform's (blocking )?question tool: `AskUserQuestion` in Claude Code/g,
    'the `ask_user_question` tool',
  )

  // Pattern: platform's skill-invocation primitive (`Skill` in Claude Code)
  result = result.replace(
    /the platform's skill-invocation primitive\s+\(`Skill` in Claude Code[^)]*\)/g,
    'skill invocation',
  )

  // AskUserQuestion -> ask_user_question
  result = result.replace(/AskUserQuestion/g, 'ask_user_question')

  // Backticked: `AskUserQuestion` -> `ask_user_question`
  result = result.replace(/`AskUserQuestion`/g, '`ask_user_question`')

  // ToolSearch -> grep (Vibe uses grep for search)
  result = result.replace(/ToolSearch/g, 'grep')

  // Backticked: `ToolSearch` -> `grep`
  result = result.replace(/`ToolSearch`/g, '`grep`')

  // ========================================================================
  // Phase 4: Agent/subagent tool references
  // ========================================================================
  // Pattern: Agent tool with isolation (must be BEFORE Agent tool replacement)
  result = result.replace(
    /`Agent` tool with `isolation: "worktree"` for isolation/g,
    '`task` tool with the explore subagent',
  )

  // Pattern: Claude Code (`Agent` tool) -> Vibe (task tool)
  // Must be done FIRST before general "Agent tool" replacement
  result = result.replace(
    /Claude Code \(`Agent` tool[^)]*\)/g,
    'Vibe (`task` tool)',
  )

  // Backticked `Agent` in context of tool -> `task`
  result = result.replace(/`Agent` tool/g, '`task` tool')

  // "Agent tool" -> "task tool" (Vibe's subagent primitive)
  // But only when referring to the tool, not generic "agent"
  // Added \b word boundaries to avoid matching partial words
  result = result.replace(/\bAgent tool\b/g, 'task tool')

  // Pattern: isolation: "worktree" -> remove (not applicable to Vibe)
  result = result.replace(/`isolation: "worktree"`/g, '')
  result = result.replace(/isolation: "worktree"/g, '')

  // Clean up double commas from removed isolation
  result = result.replace(/,\s*,/g, ',')
  result = result.replace(/,\s*\)/g, ')')
  result = result.replace(/\s+and\s+/g, ' and ')

  // ========================================================================
  // Phase 5: Skill invocation patterns
  // ========================================================================
  // "Skill in Claude Code" -> "skill"
  result = result.replace(/`Skill` in Claude Code/g, 'direct skill invocation')

  // ========================================================================
  // Phase 6: Worktree-specific references
  // ========================================================================
  // worktree isolation references
  result = result.replace(/worktree isolation/g, 'subagent isolation')

  // ========================================================================
  // Phase 7: Claude Code mentions (contextual)
  // ========================================================================
  // "In Claude Code" when followed by specific patterns -> "In Vibe CLI"
  // Added \b to ensure "In Claude Code" is matched as a complete phrase
  result = result.replace(
    /\bIn Claude Code, (use|run|call|invoke)/g,
    'In Vibe CLI, $1',
  )

  // "Claude Code only" -> "Vibe CLI"
  // Added \b to match complete phrase only
  result = result.replace(/\bClaude Code only\b/g, 'Vibe CLI')

  // ========================================================================
  // Phase 8: Subagent dispatch references
  // ========================================================================
  // Serial subagents -> sequential task execution
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bserial subagents\b/g, 'sequential task execution')

  // Parallel subagents -> concurrent task execution
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bparallel subagents\b/g, 'concurrent task execution')

  // Subagent dispatch -> task delegation
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bsubagent dispatch\b/g, 'task delegation')

  // "each subagent" -> "each task"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\beach subagent\b/g, 'each task')

  // "the subagent" -> "the task"
  result = result.replace(/\bthe subagent\b/g, 'the task')

  // "a subagent" -> "a task"
  result = result.replace(/\ba subagent\b/g, 'a task')

  // "every subagent" -> "every task"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bevery subagent\b/g, 'every task')

  // "subagents" -> "tasks" (plural)
  result = result.replace(/\bsubagents\b/g, 'tasks')

  // "Subagent" (capitalized) -> "Task"
  result = result.replace(/\bSubagent\b/g, 'Task')

  // "subagent isolation" -> "task isolation"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bsubagent isolation\b/g, 'task isolation')

  // "per-subagent" -> "per-task"
  result = result.replace(/per-subagent/g, 'per-task')

  // "subagent or task" -> "task"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bsubagent or task\b/g, 'task')

  // "completed subagent" -> "completed task"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bcompleted subagent\b/g, 'completed task')

  // "Each subagent gets" -> "Each task gets"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bEach subagent gets\b/g, 'Each task gets')

  // "each parallel subagent" -> "each parallel task"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\beach parallel subagent\b/g, 'each parallel task')

  // "Subagents may" -> "Tasks may"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bSubagents may\b/g, 'Tasks may')

  // "Parallel subagent mode" -> "Parallel task mode"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bParallel subagent mode\b/g, 'Parallel task mode')

  // "generic subagent" -> "generic task"
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bgeneric subagent\b/g, 'generic task')

  // ========================================================================
  // Phase 9: Platform-specific tool references
  // ========================================================================
  // Glob (Claude Code) -> bash or grep
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bGlob in Claude Code\b/g, 'bash')

  // Grep in Claude Code -> grep
  // Added \b word boundaries to avoid partial matches
  result = result.replace(/\bGrep in Claude Code\b/g, 'grep')

  // ========================================================================
  // Phase 10: Cleanup
  // ========================================================================
  // Remove double spaces (but preserve newlines and single spaces)
  // Only collapse horizontal whitespace (spaces, tabs), not vertical (newlines)
  result = result.replace(/[ \t]{2,}/g, ' ')

  // Fix spaces after punctuation (for sentences) - but only for sentence-ending punctuation
  // Don't touch spaces before dots in paths like ".vibe/"
  result = result.replace(/([.!?]) +([A-Z])/g, '$1 $2')

  return result
}

/**
 * Check if a string contains any Claude-specific patterns that need transformation.
 */
export function hasClaudePatterns(content: string): boolean {
  const patterns = [
    /Task(Create|Update|List|Get|Stop|Output)/,
    /\.claude\//,
    /AskUserQuestion/,
    /ToolSearch/,
    /Agent tool/,
    /worktree isolation/,
    /\.claude\/worktrees\//,
    /serial subagents/,
    /parallel subagents/,
    /subagent dispatch/,
  ]

  return patterns.some((pattern) => pattern.test(content))
}
