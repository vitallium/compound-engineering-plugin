/**
 * Converter from Claude Code plugin format to Vibe CLI format
 * 
 * Vibe CLI documentation:
 * - Skills: https://docs.mistral.ai/vibe/code/cli/skills
 * - Agents: https://docs.mistral.ai/vibe/code/cli/agents
 * - Agent Skills spec: https://agentskills.io/specification
 */

import { formatFrontmatter, parseFrontmatter } from "../utils/frontmatter"
import { transformContentForVibe } from "../utils/vibe-content"
import { filterSkillsByPlatform } from "../types/claude"
import type {
  ClaudeAgent,
  ClaudeCommand,
  ClaudeMcpServer,
  ClaudePlugin,
  ClaudeSkill,
} from "../types/claude"
import type { VibeAgent, VibeAgentConfig, VibeBundle, VibeMcpServer, VibeSkill, VibeSkillDir } from "../types/vibe"
import type { ClaudeToOpenCodeOptions } from "./claude-to-opencode"

// ============================================================================
// Model Mapping
// Maps known Claude model identifiers to Vibe CLI model identifiers
// ============================================================================

const CLAUDE_TO_VIBE_MODEL: Record<string, string> = {
  // Claude 3.5 models
  "claude-3-5-sonnet-20250620": "mistral-large-latest",
  "claude-3-5-sonnet": "mistral-large-latest",
  // Claude 3 models
  "claude-3-opus-20240229": "mistral-large-latest",
  "claude-3-opus": "mistral-large-latest",
  "claude-3-sonnet-20240229": "mistral-medium-latest",
  "claude-3-sonnet": "mistral-medium-latest",
  "claude-3-haiku-20240307": "mistral-small-latest",
  "claude-3-haiku": "mistral-small-latest",
  // Claude 2 models
  "claude-2:1": "mistral-medium-latest",
  "claude-2": "mistral-medium-latest",
  // Claude Instant
  "claude-instant-1.2": "mistral-small-latest",
  // Legacy names
  "sonnet": "mistral-medium-latest",
  "haiku": "mistral-small-latest",
  "opus": "mistral-large-latest",
}

function mapClaudeModelToVibe(model: string): string | undefined {
  const normalized = model.toLowerCase()
  for (const [claudeModel, vibeModel] of Object.entries(CLAUDE_TO_VIBE_MODEL)) {
    if (normalized === claudeModel.toLowerCase()) {
      return vibeModel
    }
  }
  return undefined
}

// ============================================================================
// Conversion Options
// ============================================================================

export type ClaudeToVibeOptions = ClaudeToOpenCodeOptions & {
  /**
   * Include skills marked for specific platforms only
   * If not set, includes all skills
   */
  platform?: string
  
  /**
   * Agent type for converted agents: "agent" or "subagent"
   * Default: "agent"
   */
  agentType?: "agent" | "subagent"
  
  /**
   * Default model for agents
   * Default: undefined (uses Vibe CLI default)
   */
  defaultModel?: string
  
  /**
   * Default safety level for agents
   * Default: "safe"
   */
  defaultSafety?: "safe" | "neutral" | "destructive" | "yolo"
}

const DEFAULT_OPTIONS: Required<Omit<ClaudeToVibeOptions, keyof ClaudeToOpenCodeOptions>> = {
  platform: undefined,
  agentType: "agent",
  defaultModel: undefined,
  defaultSafety: "safe",
}

// ============================================================================
// Tool Name Mapping
// Maps CE/Claude tool names to Vibe CLI tool names
// ============================================================================

const TOOL_MAP: Record<string, string> = {
  // File operations
  Read: "read_file",
  Write: "write_file",
  Edit: "search_replace",
  Glob: "bash",
  List: "list",
  
  // Search
  Grep: "grep",
  
  // Shell
  Bash: "bash",
  
  // Web
  WebFetch: "web_fetch",
  
  // Code-specific (Claude Code)
  "codex:edit": "search_replace",
  
  // Patching
  Patch: "patch",
  
  // Vibe-specific
  Task: "task",
  ask_user_question: "ask_user_question",
}

// Tools that are not available in Vibe CLI
const DISABLED_TOOLS = new Set([
  "claude:web_search",
  "claude:list_resources", 
  "claude:read_resource",
])

/**
 * Convert CE tool names to Vibe CLI tool names
 */
function convertToolName(ceTool: string): string | null {
  if (DISABLED_TOOLS.has(ceTool)) {
    return null
  }
  
  const mapped = TOOL_MAP[ceTool]
  if (mapped) return mapped
  
  // Vibe CLI native tools
  const vibeTools = new Set([
    "read_file", "write_file", "search_replace", "grep", "bash",
    "web_fetch", "ask_user_question", "task"
  ])
  
  if (vibeTools.has(ceTool.toLowerCase())) {
    return ceTool.toLowerCase()
  }
  
  return null
}

/**
 * Parse CE allowed-tools format and convert to Vibe CLI format
 * CE format: "Bash(bash *worktree-manager.sh)" or ["Read", "Grep"]
 * Vibe format: array of tool names
 */
type ConvertedToolRestriction = {
  explicit: boolean
  tools: string[]
  unsupported: string[]
}

function splitToolDeclarations(value: string): string[] {
  const declarations: string[] = []
  let start = 0
  let depth = 0

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === "(") depth += 1
    if (character === ")" && depth > 0) depth -= 1
    if (character === "," && depth === 0) {
      declarations.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  declarations.push(value.slice(start).trim())
  return declarations.filter(Boolean)
}

function convertAllowedTools(
  ceAllowedTools: string | string[] | undefined,
): ConvertedToolRestriction {
  if (ceAllowedTools === undefined) {
    return { explicit: false, tools: [], unsupported: [] }
  }

  const declarations = Array.isArray(ceAllowedTools)
    ? ceAllowedTools.flatMap(splitToolDeclarations)
    : splitToolDeclarations(ceAllowedTools)
  const tools: string[] = []
  const unsupported: string[] = []

  for (const declaration of declarations) {
    // Vibe can only represent whole-tool permissions. Mapping Bash(git *) to
    // bash would broaden the source permission, so retain exact names only.
    if (declaration.includes("(")) {
      unsupported.push(declaration)
      continue
    }
    const converted = convertToolName(declaration)
    if (converted) {
      tools.push(converted)
    } else {
      unsupported.push(declaration)
    }
  }

  return { explicit: true, tools: [...new Set(tools)].sort(), unsupported }
}

function warnForToolRestriction(
  artifact: string,
  restriction: ConvertedToolRestriction,
): boolean {
  if (!restriction.explicit) return false
  if (restriction.tools.length === 0) {
    const detail = restriction.unsupported.length > 0
      ? `no exact Vibe tool mapping exists for: ${restriction.unsupported.join(", ")}`
      : "the source allow-list is empty"
    console.warn(
      `Warning: skipping Vibe ${artifact}; ${detail}.`,
    )
    return true
  }
  if (restriction.unsupported.length === 0) return false
  console.warn(
    `Warning: Vibe ${artifact} omits unsupported scoped or unknown tool restrictions: ${restriction.unsupported.join(", ")}.`,
  )
  return false
}

function isClaudeModelIdentifier(model: string): boolean {
  return /^(anthropic\/)?claude-/i.test(model) || /^(haiku|sonnet|opus)$/i.test(model)
}

// ============================================================================
// Name Normalization
// ============================================================================

const VIBE_SKILL_NAME_MAX_LENGTH = 64

/**
 * Normalize skill/agent name for Vibe CLI
 */
export function normalizeName(name: string): string {
  let normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-+/g, "-")
  
  if (!/^[a-z]/.test(normalized)) {
    normalized = "ce-" + normalized
  }
  
  const originalLength = normalized.length
  if (normalized.length > VIBE_SKILL_NAME_MAX_LENGTH) {
    normalized = normalized.slice(0, VIBE_SKILL_NAME_MAX_LENGTH)
    console.warn(`Warning: skill/agent name "${name}" truncated from ${originalLength} to ${VIBE_SKILL_NAME_MAX_LENGTH} characters to fit Vibe CLI limits.`)
  }
  
  return normalized.replace(/-+/g, "-")
}

/**
 * Sanitize description for Vibe CLI (max 1024 chars)
 */
function sanitizeDescription(description: string | undefined): string | undefined {
  if (!description) return undefined
  const maxLength = 1024
  if (description.length > maxLength) {
    return description.slice(0, maxLength - 3) + "..."
  }
  return description
}

// ============================================================================
// Skill Conversion
// ============================================================================

function convertSkillToSkillDir(
  skill: ClaudeSkill,
  usedNames: Set<string>,
): VibeSkillDir | null {
  const name = normalizeName(skill.name)
  if (usedNames.has(name)) {
    console.warn(`Duplicate skill name: ${name} (from ${skill.name})`)
    return null
  }
  usedNames.add(name)
  
  return {
    name,
    sourceDir: skill.sourceDir,
  }
}

function convertCommandToSkill(
  command: ClaudeCommand,
  usedNames: Set<string>,
): VibeSkill | null {
  const name = normalizeName(command.name)
  if (usedNames.has(name)) {
    console.warn(`Duplicate command/skill name: ${name} (from ${command.name})`)
    return null
  }
  usedNames.add(name)
  
  const { data, body } = parseFrontmatter(command.body, command.sourcePath)
  
  // Transform the body content from Claude-specific to Vibe-compatible
  const transformedBody = transformContentForVibe(body)
  
  const frontmatter: Record<string, unknown> = {
    name,
    description: sanitizeDescription(command.description || data.description as string),
    "user-invocable": command.disableModelInvocation === true ? false : true,
  }
  
  // Map model field if present
  const model = command.model || (data.model as string | undefined)
  if (model && model !== "inherit" && model !== "default") {
    const vibeModel = mapClaudeModelToVibe(model)
    if (vibeModel) {
      frontmatter["model"] = vibeModel
    } else if (!isClaudeModelIdentifier(model)) {
      // Non-Claude model identifier, pass through as-is
      frontmatter["model"] = model
    }
  }
  
  const allowedTools = convertAllowedTools(
    command.allowedTools ?? data["allowed-tools"] as string[] | string | undefined,
  )
  if (warnForToolRestriction(`skill "${name}"`, allowedTools)) {
    return null
  }
  if (allowedTools.tools.length > 0) {
    frontmatter["allowed-tools"] = allowedTools.tools
  }
  
  if (command.argumentHint || data["argument-hint"]) {
    frontmatter["argument-hint"] = command.argumentHint || data["argument-hint"]
  }
  
  const formattedFrontmatter = formatFrontmatter(frontmatter)
  return {
    name,
    content: `${formattedFrontmatter}\n\n${transformedBody}`,
  }
}

// ============================================================================
// Agent Conversion
// ============================================================================

function convertAgentToVibeAgent(
  agent: ClaudeAgent,
  options: Required<Omit<ClaudeToVibeOptions, keyof ClaudeToOpenCodeOptions>>,
  usedNames: Set<string>,
): VibeAgent | null {
  const name = normalizeName(agent.name)
  if (usedNames.has(name)) {
    console.warn(`Duplicate agent name: ${name} (from ${agent.name})`)
    return null
  }
  usedNames.add(name)
  
  const { data, body } = parseFrontmatter(agent.body, agent.sourcePath)
  
  // Transform the body content from Claude-specific to Vibe-compatible
  const transformedBody = transformContentForVibe(body)
  
  const config: VibeAgentConfig = {
    agent_type: options.agentType,
    display_name: agent.name,
    description: sanitizeDescription(agent.description || data.description as string),
    safety: options.defaultSafety,
  }
  
  // Map model field if present
  const model = agent.model || (data.model as string | undefined)
  if (model && model !== "inherit" && model !== "default") {
    const vibeModel = mapClaudeModelToVibe(model)
    if (vibeModel) {
      config.active_model = vibeModel
    } else if (isClaudeModelIdentifier(model)) {
      console.warn(`Warning: omitting Claude model "${model}" from Vibe agent "${name}"; configure a Vibe model explicitly.`)
      if (options.defaultModel) config.active_model = options.defaultModel
    } else {
      // Non-Claude model identifier, pass through as-is
      config.active_model = model
    }
  } else if (options.defaultModel) {
    config.active_model = options.defaultModel
  }
  
  const ceTools = agent.capabilities ?? data.capabilities as string[] | string | undefined
  const allowedTools = convertAllowedTools(ceTools)
  if (warnForToolRestriction(`agent "${name}"`, allowedTools)) {
    return null
  }
  if (allowedTools.tools.length > 0) {
    config.enabled_tools = allowedTools.tools
  }
  
  config.system_prompt_id = name
  
  return {
    name,
    config,
    promptContent: transformedBody,
  }
}

function convertMcpServers(
  servers?: Record<string, ClaudeMcpServer>,
): VibeMcpServer[] | undefined {
  if (!servers || Object.keys(servers).length === 0) return undefined

  const result: VibeMcpServer[] = []

  for (const [name, server] of Object.entries(servers)) {
    const explicitType = server.type?.trim().toLowerCase()

    if (server.command) {
      if (explicitType && explicitType !== "stdio") {
        console.warn(`Warning: MCP server "${name}" declares unsupported transport "${server.type}" for a command-based server. Skipping.`)
        continue
      }

      result.push({
        name,
        transport: "stdio",
        command: server.command,
        args: server.args?.length ? server.args : undefined,
        env: server.env && Object.keys(server.env).length > 0 ? server.env : undefined,
      })
      continue
    }

    if (server.url) {
      const transport = explicitType === "streamable-http" ? "streamable-http" : "http"
      if (explicitType && explicitType !== "http" && explicitType !== "streamable-http") {
        console.warn(`Warning: MCP server "${name}" declares unsupported transport "${server.type}" for a URL-based server. Skipping.`)
        continue
      }

      result.push({
        name,
        transport,
        url: server.url,
        headers: server.headers && Object.keys(server.headers).length > 0 ? server.headers : undefined,
      })
      continue
    }

    console.warn(`Warning: MCP server "${name}" has no command or url. Skipping.`)
  }

  return result.length > 0 ? result : undefined
}

// ============================================================================
// Main Converter
// ============================================================================

/**
 * Convert a Claude Code plugin to Vibe CLI format
 */
export function convertClaudeToVibe(
  plugin: ClaudePlugin,
  options: ClaudeToVibeOptions = {},
): VibeBundle {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const usedNames = new Set<string>()
  
  // Default to including everything if not specified
  const includeSkills = options.includeSkills !== false
  const includeCommands = options.includeCommands !== false
  const includeAgents = options.includeAgents !== false
  
  const skillDirs: VibeSkillDir[] = []
  if (includeSkills) {
    const skills = filterSkillsByPlatform(plugin.skills, "vibe")
    
    for (const skill of skills) {
      const converted = convertSkillToSkillDir(skill, usedNames)
      if (converted) {
        skillDirs.push(converted)
      }
    }
  }
  
  const generatedSkills: VibeSkill[] = []
  if (includeCommands) {
    for (const command of plugin.commands) {
      const converted = convertCommandToSkill(command, usedNames)
      if (converted) {
        generatedSkills.push(converted)
      }
    }
  }
  
  const agents: VibeAgent[] = []
  if (includeAgents) {
    for (const agent of plugin.agents) {
      const converted = convertAgentToVibeAgent(agent, opts, usedNames)
      if (converted) {
        agents.push(converted)
      }
    }
  }

  const mcpServers = convertMcpServers(plugin.mcpServers)

  if (plugin.hooks && Object.keys(plugin.hooks.hooks).length > 0) {
    console.warn("Warning: Vibe hook conversion is not implemented; Claude hooks were omitted.")
  }

  return {
    pluginName: plugin.manifest.name,
    agents,
    generatedSkills,
    skillDirs,
    mcpServers,
  }
}

// ============================================================================
// Content Transformation
// ============================================================================

/**
 * Transform CE skill content for Vibe CLI
 */
export function transformSkillContentForVibe(
  content: string,
  sourcePath?: string,
): string {
  const { data, body } = parseFrontmatter(content, sourcePath)
  
  // Transform the body content from Claude-specific to Vibe-compatible
  const transformedBody = transformContentForVibe(body)
  
  const newFrontmatter: Record<string, unknown> = {
    name: data.name,
    description: data.description,
  }
  
  if (data["argument-hint"]) {
    newFrontmatter["argument-hint"] = data["argument-hint"]
  }
  
  // Handle model field mapping
  const model = data.model as string | undefined
  if (model && model !== "inherit" && model !== "default") {
    const vibeModel = mapClaudeModelToVibe(model)
    if (vibeModel) {
      newFrontmatter["model"] = vibeModel
    } else if (!isClaudeModelIdentifier(model)) {
      newFrontmatter["model"] = model
    }
  }
  
  const allowedTools = convertAllowedTools(
    data["allowed-tools"] as string[] | string | undefined,
  )
  warnForToolRestriction(`skill content${sourcePath ? ` at ${sourcePath}` : ""}`, allowedTools)
  if (allowedTools.tools.length > 0) {
    newFrontmatter["allowed-tools"] = allowedTools.tools
  }
  
  newFrontmatter["user-invocable"] = data["disable-model-invocation"] === true ? false : (data["user-invocable"] === false ? false : true)
  
  const formattedFrontmatter = formatFrontmatter(newFrontmatter)
  return `${formattedFrontmatter}\n\n${transformedBody}`
}

/**
 * A Vibe skill with an explicit tool allow-list is safe to emit only when at
 * least one whole-tool permission remains after conversion.
 */
export function canConvertSkillContentForVibe(content: string, sourcePath?: string): boolean {
  const { data } = parseFrontmatter(content, sourcePath)
  const restriction = convertAllowedTools(data["allowed-tools"] as string[] | string | undefined)
  return !restriction.explicit || restriction.tools.length > 0
}
