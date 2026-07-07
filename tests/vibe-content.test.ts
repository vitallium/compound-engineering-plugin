import { describe, expect, test } from "bun:test"
import { transformContentForVibe, hasClaudePatterns } from "../src/utils/vibe-content"

describe("transformContentForVibe", () => {
  describe("Task tracking tools", () => {
    test("replaces TaskCreate with neutral task-tracking guidance", () => {
      const input = "Use TaskCreate to create tasks"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tracking to create tasks")
    })

    test("replaces TaskUpdate with neutral task-tracking guidance", () => {
      const input = "Use TaskUpdate to update tasks"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tracking to update tasks")
    })

    test("replaces TaskList with neutral task-tracking guidance", () => {
      const input = "Use TaskList to list tasks"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tracking to list tasks")
    })

    test("replaces backticked TaskCreate with neutral task-tracking guidance", () => {
      const input = "Use `TaskCreate` to create tasks"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tracking to create tasks")
    })

    test("replaces TaskCreate/TaskUpdate/TaskList pattern", () => {
      const input = "Use TaskCreate/TaskUpdate/TaskList for task management"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tracking for task management")
    })

    test("replaces platform task tracking tool reference", () => {
      const input = `Use the platform's task tracking tool (\`TaskCreate\/\`TaskUpdate\/\`TaskList\` in Claude Code)`
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tracking")
    })

    test("replaces backticked TaskCreate/TaskUpdate/TaskList combined", () => {
      const input = "Use `TaskCreate`/`TaskUpdate`/`TaskList` for task management"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tracking for task management")
    })

    test("does not introduce todo as a tool or change ordinary TODO prose", () => {
      const input = "TODO: revisit this later. Use TaskCreate to track the work."
      const output = transformContentForVibe(input)
      expect(output).toBe("TODO: revisit this later. Use task tracking to track the work.")
      expect(output).not.toContain("`todo`")
      expect(output).not.toContain("todo tool")
    })
  })

  describe("Path transformations", () => {
    test("preserves Claude-specific paths that do not have a verified Vibe equivalent", () => {
      const input = "Check `.claude/launch.json` and .claude/skills/ce-work/SKILL.md"
      expect(transformContentForVibe(input)).toBe(input)
    })

    test("preserves Markdown code fences", () => {
      const input = "```toml\npath = '.claude/launch.json'\n```"
      expect(transformContentForVibe(input)).toBe(input)
    })

    test("preserves .claude/ paths", () => {
      const input = "Check .claude/launch.json"
      const output = transformContentForVibe(input)
      expect(output).toBe(input)
    })

    test("preserves backticked .claude/ paths", () => {
      const input = "Check `.claude/launch.json` for config"
      const output = transformContentForVibe(input)
      expect(output).toBe(input)
    })

    test("preserves .claude/skills/ paths", () => {
      const input = "Look in .claude/skills/ce-work/SKILL.md"
      const output = transformContentForVibe(input)
      expect(output).toBe(input)
    })

    test("preserves .claude/worktrees/ paths", () => {
      const input = "Worktree at .claude/worktrees/agent-123"
      const output = transformContentForVibe(input)
      expect(output).toBe(input)
    })
  })

  describe("Tool name transformations", () => {
    test("replaces AskUserQuestion with ask_user_question", () => {
      const input = "Use AskUserQuestion for input"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use ask_user_question for input")
    })

    test("replaces backticked AskUserQuestion", () => {
      const input = "Use `AskUserQuestion` for input"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use `ask_user_question` for input")
    })

    test("replaces platform blocking question tool reference", () => {
      const input = `Use the platform's blocking question tool: \`AskUserQuestion\` in Claude Code`
      const output = transformContentForVibe(input)
      expect(output).toBe("Use the `ask_user_question` tool")
    })

    test("replaces ToolSearch with grep", () => {
      const input = "Use ToolSearch to find files"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use grep to find files")
    })

    test("replaces backticked ToolSearch", () => {
      const input = "Use `ToolSearch` to find files"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use `grep` to find files")
    })
  })

  describe("Agent/subagent tool references", () => {
    test("replaces Agent tool with task tool", () => {
      const input = "Use Agent tool for delegation"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task tool for delegation")
    })

    test("replaces Claude Code (Agent tool) reference", () => {
      const input = "In Claude Code (`Agent` tool) we do this"
      const output = transformContentForVibe(input)
      expect(output).toContain("Vibe (`task` tool)")
    })

    test("replaces isolation: worktree pattern", () => {
      const input = "pass `isolation: \"worktree\"` and `run_in_background: true`"
      const output = transformContentForVibe(input)
      // The isolation reference should be removed/cleaned
      expect(output).not.toContain("isolation")
    })
  })

  describe("Skill invocation patterns", () => {
    test("replaces Skill in Claude Code reference", () => {
      const input = "Use `Skill` in Claude Code to invoke"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use direct skill invocation to invoke")
    })

    test("replaces platform skill-invocation primitive", () => {
      const input = "Use the platform's skill-invocation primitive (`Skill` in Claude Code)"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use skill invocation")
    })
  })

  describe("Worktree-specific references", () => {
    test("replaces worktree isolation with task isolation", () => {
      const input = "Use worktree isolation for safety"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task isolation for safety")
    })

    test("preserves .claude/worktrees/ references", () => {
      const input = "Check .claude/worktrees/ for agent work"
      const output = transformContentForVibe(input)
      expect(output).toBe(input)
    })
  })

  describe("Subagent dispatch references", () => {
    test("replaces serial subagents with sequential task execution", () => {
      const input = "Use serial subagents for dependent tasks"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use sequential task execution for dependent tasks")
    })

    test("replaces parallel subagents with concurrent task execution", () => {
      const input = "Use parallel subagents for independent tasks"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use concurrent task execution for independent tasks")
    })

    test("replaces subagent dispatch with task delegation", () => {
      const input = "Use subagent dispatch for work"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use task delegation for work")
    })

    test("replaces each subagent with each task", () => {
      const input = "Wait for each subagent to complete"
      const output = transformContentForVibe(input)
      expect(output).toBe("Wait for each task to complete")
    })

    test("replaces the subagent with the task", () => {
      const input = "Review the subagent results"
      const output = transformContentForVibe(input)
      expect(output).toBe("Review the task results")
    })

    test("replaces a subagent with a task", () => {
      const input = "Dispatch a subagent for this work"
      const output = transformContentForVibe(input)
      expect(output).toBe("Dispatch a task for this work")
    })
  })

  describe("Platform-specific tool references", () => {
    test("replaces Glob in Claude Code with bash", () => {
      const input = "Use Glob in Claude Code for file search"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use bash for file search")
    })

    test("replaces Grep in Claude Code with grep", () => {
      const input = "Use Grep in Claude Code for content search"
      const output = transformContentForVibe(input)
      expect(output).toBe("Use grep for content search")
    })
  })

  describe("Claude Code mentions", () => {
    test("replaces In Claude Code, use with In Vibe CLI, use", () => {
      const input = "In Claude Code, use this approach"
      const output = transformContentForVibe(input)
      expect(output).toBe("In Vibe CLI, use this approach")
    })

    test("replaces In Claude Code, run with In Vibe CLI, run", () => {
      const input = "In Claude Code, run the command"
      const output = transformContentForVibe(input)
      expect(output).toBe("In Vibe CLI, run the command")
    })

    test("replaces Claude Code only with Vibe CLI", () => {
      const input = "This works in Claude Code only"
      const output = transformContentForVibe(input)
      expect(output).toBe("This works in Vibe CLI")
    })
  })

  describe("hasClaudePatterns", () => {
    test("returns true for TaskCreate", () => {
      expect(hasClaudePatterns("Use TaskCreate")).toBe(true)
    })

    test("returns true for .claude/ path", () => {
      expect(hasClaudePatterns("Check .claude/launch.json")).toBe(true)
    })

    test("returns true for AskUserQuestion", () => {
      expect(hasClaudePatterns("Use AskUserQuestion")).toBe(true)
    })

    test("returns true for Agent tool", () => {
      expect(hasClaudePatterns("Use Agent tool")).toBe(true)
    })

    test("returns false for clean Vibe content", () => {
      expect(hasClaudePatterns("Use todo tool")).toBe(false)
    })

    test("returns false for empty string", () => {
      expect(hasClaudePatterns("")).toBe(false)
    })
  })

  describe("Complex transformations", () => {
    test("transforms ce-work style content", () => {
      const input = `
Use the platform's task tracking tool (\`TaskCreate\/\`TaskUpdate\/\`TaskList\` in Claude Code, \`update_plan\` in Codex, or the equivalent on other harnesses) to break the plan into actionable tasks.

For subagent dispatch, use \`Agent\` tool with \`isolation: "worktree"\` for isolation.

Check \`.claude/launch.json\` for configuration.
`.trim()

      const output = transformContentForVibe(input)

      expect(output).toContain("task tracking")
      expect(output).not.toContain("TaskCreate")
      expect(output).not.toContain("TaskUpdate")
      expect(output).not.toContain("TaskList")
      expect(output).not.toContain("`todo`")
      expect(output).not.toContain("todo tool")
      expect(output).not.toContain("`Agent")
      expect(output).not.toContain("isolation")
      expect(output).toContain(".claude/launch.json")
      expect(output).toContain("`task` tool with the explore subagent")
    })
  })

  describe("Performance and edge cases", () => {
    test("handles large content with many patterns efficiently", () => {
      // Create 10KB+ content with repeated patterns
      const largeContent = Array(1000)
        .fill("Use TaskCreate to manage tasks. Check .claude/config.json and Agent tool for more info.")
        .join(" ")

      const start = Date.now()
      const output = transformContentForVibe(largeContent)
      const elapsed = Date.now() - start

      // Should complete in under 100ms for 10KB+ content
      expect(elapsed).toBeLessThan(100)

      // Verify transformations still work
      expect(output).toContain("task tracking")
      expect(output).toContain(".claude/")
      expect(output).not.toContain("TaskCreate")
    })

    test("preserves all Claude path references", () => {
      const input = "Check my.claude/config and .claude/settings"
      const output = transformContentForVibe(input)

      expect(output).toContain("my.claude/config")
      expect(output).toContain(".claude/settings")
    })

    test("does not match partial words in Agent tool replacement", () => {
      // Test that \b word boundary prevents matching "NotAgent tool" as "Agent tool"
      const input = "Use NotAgent tool and Agent tool for different purposes"
      const output = transformContentForVibe(input)

      // NotAgent tool should NOT be transformed
      expect(output).toContain("NotAgent tool")
      // Agent tool SHOULD be transformed
      expect(output).toContain("task tool")
    })

    test("handles edge cases with special characters", () => {
      const input = "Path: .claude/worktrees/abc and .claude/config.json"
      const output = transformContentForVibe(input)

      expect(output).toContain(".claude/worktrees/abc")
      expect(output).toContain(".claude/config.json")
    })

    test("handles empty and null inputs gracefully", () => {
      expect(transformContentForVibe("")).toBe("")
      // Note: null/undefined would cause TypeScript error, but testing empty string
    })

    test("handles content with no frontmatter markers", () => {
      const input = "Just plain content without any --- markers"
      const output = transformContentForVibe(input)
      expect(output).toBe("Just plain content without any --- markers")
    })
  })
})
