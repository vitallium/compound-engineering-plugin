/**
 * Vibe CLI types for skill and agent conversion
 * Based on Mistral Vibe CLI's Agent Skills specification
 * See: https://docs.mistral.ai/vibe/code/cli/skills
 * See: https://docs.mistral.ai/vibe/code/cli/agents
 */

import type { ClaudeMcpServer } from "./claude"

// ============================================================================
// Vibe CLI Skill Types
// ============================================================================

export type VibeSkill = {
  name: string
  content: string // Full SKILL.md with YAML frontmatter
}

export type VibeSkillDir = {
  name: string
  sourceDir: string
}

// ============================================================================
// Vibe CLI Agent Types
// Based on: https://docs.mistral.ai/vibe/code/cli/agents
// ============================================================================

/**
 * Vibe CLI Agent Configuration (TOML format)
 * Stored in ~/.vibe/agents/<name>.toml
 */
export type VibeAgentConfig = {
  agent_type: "agent" | "subagent"
  display_name?: string
  description?: string
  safety?: "safe" | "neutral" | "destructive" | "yolo"
  active_model?: string
  system_prompt_id?: string
  enabled_tools?: string[]
  disabled_tools?: string[]
  // Per-tool permissions
  tools?: Record<string, { permission: "always" | "ask" | "never" }>
  metadata?: Record<string, string>
}

/**
 * Vibe CLI Agent - complete representation
 * Includes both config (TOML) and prompt (Markdown)
 */
export type VibeAgent = {
  name: string
  config: VibeAgentConfig
  promptContent: string
}

export type VibeMcpServer =
  | ({
    name: string
    transport: "stdio"
    command: string
    args?: string[]
    env?: Record<string, string>
  })
  | ({
    name: string
    transport: "http" | "streamable-http"
    url: string
    headers?: Record<string, string>
  })

export type VibeBundle = {
  pluginName?: string
  agents: VibeAgent[]
  generatedSkills: VibeSkill[]
  skillDirs: VibeSkillDir[]
  mcpServers?: VibeMcpServer[]
}

export type { ClaudeMcpServer }
