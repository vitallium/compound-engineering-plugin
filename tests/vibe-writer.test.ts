import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { writeVibeBundle } from "../src/targets/vibe"
import type { VibeBundle } from "../src/types/vibe"

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe("writeVibeBundle", () => {
  test("writes agents, skills, prompts, and MCP config into the expected .vibe layout", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-writer-"))
    const bundle: VibeBundle = {
      pluginName: "compound-engineering",
      agents: [
        {
          name: "security-reviewer",
          config: {
            agent_type: "agent",
            display_name: "Security Reviewer",
            safety: "safe",
            enabled_tools: ["bash", "grep"],
            tools: {
              bash: { permission: "always" },
            },
          },
          promptContent: "Review code carefully.",
        },
      ],
      generatedSkills: [
        {
          name: "plan",
          content: "---\nname: plan\ndescription: Plan\n---\n\nPlan the work.",
        },
      ],
      skillDirs: [
        {
          name: "skill-one",
          sourceDir: path.join(import.meta.dir, "fixtures", "sample-plugin", "skills", "skill-one"),
        },
      ],
      mcpServers: [
        {
          name: "local-tooling",
          transport: "stdio",
          command: "echo",
          args: ["fixture"],
          env: { TOKEN: "secret" },
        },
        {
          name: "context7",
          transport: "http",
          url: "https://mcp.context7.com/mcp",
        },
      ],
    }

    await writeVibeBundle(tempRoot, bundle)

    expect(await exists(path.join(tempRoot, ".vibe", "agents", "security-reviewer.toml"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".vibe", "prompts", "security-reviewer.md"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".vibe", "skills", "plan", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".vibe", "skills", "skill-one", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".vibe", "config.toml"))).toBe(true)

    const agentToml = await fs.readFile(path.join(tempRoot, ".vibe", "agents", "security-reviewer.toml"), "utf8")
    expect(agentToml).toContain('agent_type = "agent"')
    expect(agentToml).toContain('enabled_tools = ["bash", "grep"]')
    expect(agentToml).toContain("[tools.bash]")
    expect(agentToml).toContain('permission = "always"')

    const configToml = await fs.readFile(path.join(tempRoot, ".vibe", "config.toml"), "utf8")
    expect(configToml).toContain("[[mcp_servers]]")
    expect(configToml).toContain('name = "local-tooling"')
    expect(configToml).toContain('transport = "stdio"')
    expect(configToml).toContain('env = { TOKEN = "secret" }')
    expect(configToml).toContain('transport = "http"')
  })

  test("does not double-nest when output root is already .vibe", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-home-"))
    const vibeRoot = path.join(tempRoot, ".vibe")
    const bundle: VibeBundle = {
      agents: [
        {
          name: "reviewer",
          config: { agent_type: "agent" },
          promptContent: "Reviewer prompt.",
        },
      ],
      generatedSkills: [],
      skillDirs: [],
    }

    await writeVibeBundle(vibeRoot, bundle)

    expect(await exists(path.join(vibeRoot, "agents", "reviewer.toml"))).toBe(true)
    expect(await exists(path.join(vibeRoot, ".vibe"))).toBe(false)
  })

  test("refreshes transformed skill content on reinstall instead of preserving stale files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-refresh-"))
    const sourceSkillDir = path.join(tempRoot, "source-skill")
    await fs.mkdir(sourceSkillDir, { recursive: true })
    const skillPath = path.join(sourceSkillDir, "SKILL.md")

    await fs.writeFile(skillPath, "---\nname: ce-plan\ndescription: Plan\n---\n\nFirst version.\n")
    await writeVibeBundle(tempRoot, {
      agents: [],
      generatedSkills: [],
      skillDirs: [{ name: "ce-plan", sourceDir: sourceSkillDir }],
    })

    await fs.writeFile(skillPath, "---\nname: ce-plan\ndescription: Plan\n---\n\nSecond version.\n")
    await writeVibeBundle(tempRoot, {
      agents: [],
      generatedSkills: [],
      skillDirs: [{ name: "ce-plan", sourceDir: sourceSkillDir }],
    })

    const installed = await fs.readFile(path.join(tempRoot, ".vibe", "skills", "ce-plan", "SKILL.md"), "utf8")
    expect(installed).toContain("Second version.")
  })

  test("transforms copied reference markdown without adding skill frontmatter", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-reference-transform-"))
    const sourceSkillDir = path.join(tempRoot, "source-skill")
    const referencesDir = path.join(sourceSkillDir, "references")
    await fs.mkdir(referencesDir, { recursive: true })
    await fs.writeFile(
      path.join(sourceSkillDir, "SKILL.md"),
      "---\nname: ce-promote\ndescription: Promote\n---\n\nUse AskUserQuestion.\n",
    )
    await fs.writeFile(
      path.join(referencesDir, "spiral-cli.md"),
      "Call `AskUserQuestion` after `ToolSearch` finds the schema.\n",
    )

    await writeVibeBundle(tempRoot, {
      agents: [],
      generatedSkills: [],
      skillDirs: [{ name: "ce-promote", sourceDir: sourceSkillDir }],
    })

    const reference = await fs.readFile(
      path.join(tempRoot, ".vibe", "skills", "ce-promote", "references", "spiral-cli.md"),
      "utf8",
    )
    expect(reference).toBe("Call `ask_user_question` after `grep` finds the schema.\n")
  })

  test("merges managed MCP entries without clobbering user config", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-config-merge-"))
    const vibeRoot = path.join(tempRoot, ".vibe")
    await fs.mkdir(vibeRoot, { recursive: true })
    const configPath = path.join(vibeRoot, "config.toml")

    await fs.writeFile(configPath, 'active_model = "codestral"\n')

    await writeVibeBundle(vibeRoot, {
      agents: [],
      generatedSkills: [],
      skillDirs: [],
      mcpServers: [
        {
          name: "context7",
          transport: "http",
          url: "https://mcp.context7.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
      ],
    })

    const config = await fs.readFile(configPath, "utf8")
    expect(config).toContain('active_model = "codestral"')
    expect(config).toContain(MANAGED_BLOCK_START)
    expect(config).toContain('headers = { Authorization = "Bearer x" }')

    const files = await fs.readdir(vibeRoot)
    expect(files.some((file) => file.startsWith("config.toml.bak."))).toBe(true)
  })

  test("does not rewrite config when this plugin has no MCP changes", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-config-noop-"))
    const vibeRoot = path.join(tempRoot, ".vibe")
    await fs.mkdir(vibeRoot, { recursive: true })
    const configPath = path.join(vibeRoot, "config.toml")
    const original = 'active_model = "codestral"\n'
    await fs.writeFile(configPath, original)

    await writeVibeBundle(tempRoot, {
      pluginName: "plugin-a",
      agents: [],
      generatedSkills: [],
      skillDirs: [],
    })

    expect(await fs.readFile(configPath, "utf8")).toBe(original)
    expect((await fs.readdir(vibeRoot)).some((file) => file.startsWith("config.toml.bak."))).toBe(false)
  })

  test("preserves unmanaged artifacts while refreshing artifacts owned by the same plugin", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-owned-artifacts-"))
    const vibeRoot = path.join(tempRoot, ".vibe")
    await fs.mkdir(path.join(vibeRoot, "agents"), { recursive: true })
    await fs.mkdir(path.join(vibeRoot, "prompts"), { recursive: true })
    await fs.mkdir(path.join(vibeRoot, "skills", "plan"), { recursive: true })
    await fs.writeFile(path.join(vibeRoot, "agents", "reviewer.toml"), "# user agent\n")
    await fs.writeFile(path.join(vibeRoot, "prompts", "reviewer.md"), "user prompt\n")
    await fs.writeFile(path.join(vibeRoot, "skills", "plan", "SKILL.md"), "user skill\n")

    await writeVibeBundle(tempRoot, {
      pluginName: "plugin-a",
      agents: [{ name: "reviewer", config: { agent_type: "agent" }, promptContent: "managed prompt" }],
      generatedSkills: [{ name: "plan", content: "managed skill" }],
      skillDirs: [],
    })

    expect(await fs.readFile(path.join(vibeRoot, "agents", "reviewer.toml"), "utf8")).toBe("# user agent\n")
    expect(await fs.readFile(path.join(vibeRoot, "prompts", "reviewer.md"), "utf8")).toBe("user prompt\n")
    expect(await fs.readFile(path.join(vibeRoot, "skills", "plan", "SKILL.md"), "utf8")).toBe("user skill\n")

    await writeVibeBundle(tempRoot, {
      pluginName: "plugin-a",
      agents: [{ name: "owned", config: { agent_type: "agent" }, promptContent: "first" }],
      generatedSkills: [],
      skillDirs: [],
    })
    await writeVibeBundle(tempRoot, {
      pluginName: "plugin-a",
      agents: [{ name: "owned", config: { agent_type: "agent" }, promptContent: "second" }],
      generatedSkills: [],
      skillDirs: [],
    })

    expect(await fs.readFile(path.join(vibeRoot, "prompts", "owned.md"), "utf8")).toContain("second")

    await writeVibeBundle(tempRoot, {
      pluginName: "plugin-b",
      agents: [{ name: "owned", config: { agent_type: "agent" }, promptContent: "other plugin" }],
      generatedSkills: [],
      skillDirs: [],
    })

    expect(await fs.readFile(path.join(vibeRoot, "prompts", "owned.md"), "utf8")).toContain("second")
  })

  test("skips copied skills whose explicit tool restriction has no Vibe equivalent", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-scoped-skill-"))
    const sourceSkillDir = path.join(tempRoot, "source-skill")
    await fs.mkdir(sourceSkillDir, { recursive: true })
    await fs.writeFile(
      path.join(sourceSkillDir, "SKILL.md"),
      "---\nname: scoped-skill\ndescription: Scoped\nallowed-tools: Bash(git status)\n---\n\nRun git status.\n",
    )

    await writeVibeBundle(tempRoot, {
      pluginName: "plugin-a",
      agents: [],
      generatedSkills: [],
      skillDirs: [{ name: "scoped-skill", sourceDir: sourceSkillDir }],
    })

    expect(await exists(path.join(tempRoot, ".vibe", "skills", "scoped-skill"))).toBe(false)
  })

  test("removes a stale managed skill when its source becomes unconvertible", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-stale-scoped-skill-"))
    const sourceSkillDir = path.join(tempRoot, "source-skill")
    const sourcePath = path.join(sourceSkillDir, "SKILL.md")
    await fs.mkdir(sourceSkillDir, { recursive: true })
    await fs.writeFile(sourcePath, "---\nname: scoped-skill\ndescription: Scoped\n---\n\nRead files.\n")
    const bundle: VibeBundle = {
      pluginName: "plugin-a",
      agents: [],
      generatedSkills: [],
      skillDirs: [{ name: "scoped-skill", sourceDir: sourceSkillDir }],
    }

    await writeVibeBundle(tempRoot, bundle)
    await fs.writeFile(
      sourcePath,
      "---\nname: scoped-skill\ndescription: Scoped\nallowed-tools: Bash(git status)\n---\n\nRun git status.\n",
    )
    await writeVibeBundle(tempRoot, bundle)

    expect(await exists(path.join(tempRoot, ".vibe", "skills", "scoped-skill"))).toBe(false)
  })

  test("keeps each plugin's MCP block isolated on refresh", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-mcp-ownership-"))
    const bundle = (pluginName: string, mcpServers: VibeBundle["mcpServers"]): VibeBundle => ({
      pluginName,
      agents: [],
      generatedSkills: [],
      skillDirs: [],
      mcpServers,
    })

    await writeVibeBundle(tempRoot, bundle("plugin-a", [{
      name: "a-server", transport: "stdio", command: "a",
    }]))
    await writeVibeBundle(tempRoot, bundle("plugin-b", [{
      name: "b-server", transport: "stdio", command: "b",
    }]))
    await writeVibeBundle(tempRoot, bundle("plugin-a", []))

    const config = await fs.readFile(path.join(tempRoot, ".vibe", "config.toml"), "utf8")
    expect(config).not.toContain('name = "a-server"')
    expect(config).toContain('name = "b-server"')
  })
})

const MANAGED_BLOCK_START = "# BEGIN Compound Engineering plugin MCP (compound-engineering) -- do not edit this block"
