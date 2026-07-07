import { describe, expect, spyOn, test } from "bun:test"
import { convertClaudeToVibe, transformSkillContentForVibe } from "../src/converters/claude-to-vibe"
import type { ClaudePlugin } from "../src/types/claude"

const fixturePlugin: ClaudePlugin = {
  root: "/tmp/plugin",
  manifest: { name: "fixture", version: "1.0.0" },
  agents: [
    {
      name: "Security Reviewer",
      description: "Security-focused agent",
      capabilities: ["Read"],
      body: "Focus on vulnerabilities.",
      sourcePath: "/tmp/plugin/agents/security-reviewer.md",
    },
  ],
  commands: [
    {
      name: "workflows:plan",
      description: "Planning command",
      argumentHint: "[FOCUS]",
      allowedTools: ["Read", "Bash"],
      body: "Plan the work.",
      sourcePath: "/tmp/plugin/commands/workflows/plan.md",
    },
  ],
  skills: [
    {
      name: "existing-skill",
      description: "Existing skill",
      sourceDir: "/tmp/plugin/skills/existing-skill",
      skillPath: "/tmp/plugin/skills/existing-skill/SKILL.md",
    },
  ],
  hooks: undefined,
  mcpServers: {
    local: { type: "stdio", command: "echo", args: ["hello"], env: { TOKEN: "secret" } },
    remote: { type: "streamable-http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
  },
}

describe("convertClaudeToVibe", () => {
  test("converts agents, commands, skills, and MCP servers into a writer-ready bundle", () => {
    const bundle = convertClaudeToVibe(fixturePlugin, {
      agentType: "subagent",
      defaultSafety: "neutral",
    })

    expect(bundle.pluginName).toBe("fixture")
    expect(bundle.skillDirs).toHaveLength(1)
    expect(bundle.generatedSkills).toHaveLength(1)
    expect(bundle.agents).toHaveLength(1)
    expect(bundle.mcpServers).toEqual([
      {
        name: "local",
        transport: "stdio",
        command: "echo",
        args: ["hello"],
        env: { TOKEN: "secret" },
      },
      {
        name: "remote",
        transport: "streamable-http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
      },
    ])
  })

  test("generated skills preserve description, argument-hint, and converted allowed tools", () => {
    const bundle = convertClaudeToVibe(fixturePlugin)
    const skill = bundle.generatedSkills[0]

    expect(skill.name).toBe("workflows-plan")
    expect(skill.content).toContain("description: Planning command")
    expect(skill.content).toContain('argument-hint: "[FOCUS]"')
    expect(skill.content).toContain("- read_file")
    expect(skill.content).toContain("- bash")
  })

  test("filters skills for Vibe and fails closed on unrepresentable tool restrictions", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      commands: [{
        ...fixturePlugin.commands[0],
        allowedTools: ["Bash(git status)"],
      }],
      agents: [{
        ...fixturePlugin.agents[0],
        capabilities: ["Bash(git status)"],
        model: "claude-sonnet-4-20250514",
      }],
      skills: [
        ...fixturePlugin.skills,
        {
          name: "codex-only",
          sourceDir: "/tmp/plugin/skills/codex-only",
          skillPath: "/tmp/plugin/skills/codex-only/SKILL.md",
          ce_platforms: ["codex"],
        },
      ],
      hooks: { hooks: { PreToolUse: [] } },
    })

    expect(bundle.skillDirs.map((skill) => skill.name)).toEqual(["existing-skill"])
    expect(bundle.generatedSkills).toEqual([])
    expect(bundle.agents).toEqual([])
    expect(warn).toHaveBeenCalledTimes(4)
    warn.mockRestore()
  })

  test("keeps only exact tool mappings and omits source Claude models", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      commands: [{
        ...fixturePlugin.commands[0],
        allowedTools: ["Read", "Bash(git status)"],
      }],
      agents: [{
        ...fixturePlugin.agents[0],
        capabilities: ["Read", "Bash(git status)"],
        model: "claude-sonnet-4-20250514",
      }],
    })

    expect(bundle.generatedSkills[0]?.content).toContain("- read_file")
    expect(bundle.generatedSkills[0]?.content).not.toContain("- bash")
    expect(bundle.agents[0]?.config.enabled_tools).toEqual(["read_file"])
    expect(bundle.agents[0]?.config.active_model).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  test("skips empty explicit tool restrictions and uses a Vibe default for Claude models", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const emptyRestrictions = convertClaudeToVibe({
      ...fixturePlugin,
      commands: [{ ...fixturePlugin.commands[0], allowedTools: [] }],
      agents: [{ ...fixturePlugin.agents[0], capabilities: [] }],
    })
    const models = convertClaudeToVibe({
      ...fixturePlugin,
      agents: [
        { ...fixturePlugin.agents[0], model: "claude-sonnet-4-20250514" },
        { ...fixturePlugin.agents[0], name: "Vibe Reviewer", model: "codestral" },
      ],
    }, { defaultModel: "mistral-large-latest" })

    expect(emptyRestrictions.generatedSkills).toEqual([])
    expect(emptyRestrictions.agents).toEqual([])
    expect(models.agents[0]?.config.active_model).toBe("mistral-large-latest")
    expect(models.agents[1]?.config.active_model).toBe("codestral")
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  test("copied skill frontmatter preserves explicit user-invocable false", () => {
    const content = transformSkillContentForVibe(`---
name: agent-only-skill
description: Agent-only skill
user-invocable: false
---

Use AskUserQuestion.
`)

    expect(content).toContain("user-invocable: false")
    expect(content).toContain("ask_user_question")
  })

  test("duplicate normalized names are skipped deterministically", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})

    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      commands: [
        fixturePlugin.commands[0],
        {
          ...fixturePlugin.commands[0],
          name: "workflows-plan",
          sourcePath: "/tmp/plugin/commands/workflows-plan.md",
        },
      ],
    })

    expect(bundle.generatedSkills).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test("unsupported MCP server shapes warn and skip instead of silently leaking through", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})

    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      mcpServers: {
        broken: { type: "sse", url: "https://example.com/mcp" },
        empty: {},
      },
    })

    expect(bundle.mcpServers).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  describe("frontmatter parsing", () => {
    test("uses shared frontmatter parser for complex YAML", () => {
      const bundle = convertClaudeToVibe({
        ...fixturePlugin,
        commands: [
          {
            name: "complex-command",
            description: "Command with complex frontmatter",
            argumentHint: "[ARG]",
            allowedTools: ["Read", "Write"],
            body: `---
name: complex-command
description: Command with complex frontmatter
argument-hint: "[ARG]"
allowed-tools:
  - Read
  - Write
existing-field: "value with: colon"
nested:
  key: value
---

This is the body content.
`,
            sourcePath: "/tmp/plugin/commands/complex.md",
          },
        ],
      })

      const skill = bundle.generatedSkills[0]
      // Verify frontmatter was parsed correctly
      expect(skill.content).toContain("description: Command with complex frontmatter")
      expect(skill.content).toContain('argument-hint: "[ARG]"')
      expect(skill.content).toContain("- read_file")
      expect(skill.content).toContain("- write_file")
      // Body should be transformed
      expect(skill.content).toContain("This is the body content.")
    })

    test("handles frontmatter with colons in values", () => {
      const bundle = convertClaudeToVibe({
        ...fixturePlugin,
        commands: [
          {
            name: "colon-test",
            // No description on command, so it will use the frontmatter description
            body: `---
name: colon-test
description: "Value: with multiple: colons"
---

Body here.
`,
            sourcePath: "/tmp/plugin/commands/colon.md",
          },
        ],
      })

      const skill = bundle.generatedSkills[0]
      expect(skill.content).toContain('description: "Value: with multiple: colons"')
      expect(skill.content).toContain("Body here.")
    })

    test("handles invalid YAML frontmatter with descriptive error", () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {})
      const originalError = console.error
      console.error = () => {} // Suppress error output

      // This should throw a descriptive error
      expect(() => {
        convertClaudeToVibe({
          ...fixturePlugin,
          commands: [
            {
              name: "invalid-yaml",
              description: "Invalid YAML test",
              body: `---
name: [invalid: yaml: syntax
---

Body here.
`,
              sourcePath: "/tmp/plugin/commands/invalid.md",
            },
          ],
        })
      }).toThrow("Invalid YAML frontmatter")

      console.error = originalError
      warn.mockRestore()
    })
  })

  test("maps Claude model identifiers to Vibe model identifiers", () => {
    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      agents: [
        {
          ...fixturePlugin.agents[0],
          model: "claude-3-sonnet-20240229",
        },
      ],
      commands: [
        {
          ...fixturePlugin.commands[0],
          model: "claude-3-haiku",
        },
      ],
    })

    expect(bundle.agents[0]?.config.active_model).toBe("mistral-medium-latest")
    expect(bundle.generatedSkills[0]?.content).toContain('model: mistral-small-latest')
  })

  test("passes through non-Claude model identifiers", () => {
    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      agents: [
        {
          ...fixturePlugin.agents[0],
          model: "codestral",
        },
      ],
      commands: [
        {
          ...fixturePlugin.commands[0],
          model: "mistral-large-latest",
        },
      ],
    })

    expect(bundle.agents[0]?.config.active_model).toBe("codestral")
    expect(bundle.generatedSkills[0]?.content).toContain('model: mistral-large-latest')
  })

  test("respects disableModelInvocation in user-invocable mapping", () => {
    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      commands: [
        {
          ...fixturePlugin.commands[0],
          disableModelInvocation: true,
        },
      ],
    })

    expect(bundle.generatedSkills[0]?.content).toContain('user-invocable: false')
  })

  test("warns when skill name exceeds 64 characters", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const longName = "a".repeat(70)

    convertClaudeToVibe({
      ...fixturePlugin,
      commands: [
        {
          ...fixturePlugin.commands[0],
          name: longName,
          sourcePath: "/tmp/plugin/commands/long.md",
        },
      ],
    })

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("truncated from 70 to 64 characters")
    )
    warn.mockRestore()
  })

  test("adds List and Patch to tool mappings", () => {
    const bundle = convertClaudeToVibe({
      ...fixturePlugin,
      commands: [
        {
          ...fixturePlugin.commands[0],
          allowedTools: ["List", "Patch"],
          sourcePath: "/tmp/plugin/commands/test.md",
        },
      ],
    })

    const skill = bundle.generatedSkills[0]
    expect(skill?.content).toContain("- list")
    expect(skill?.content).toContain("- patch")
  })
})
