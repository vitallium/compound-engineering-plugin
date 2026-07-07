import fs from "node:fs/promises"
import path from "node:path"
import { backupFile, writeText, ensureDir, copySkillDir, writeTextSecure } from "../utils/files"
import { sanitizePathName } from "../utils/files"
import { canConvertSkillContentForVibe, transformSkillContentForVibe } from "../converters/claude-to-vibe"
import { transformContentForVibe } from "../utils/vibe-content"
import type { VibeBundle, VibeMcpServer } from "../types/vibe"
import {
  cleanupCurrentManagedDirectory,
  cleanupCurrentManagedFile,
  cleanupRemovedManagedDirectories,
  cleanupRemovedManagedFiles,
  readManagedInstallManifestWithLegacyFallback,
  resolveManagedSegment,
  sanitizeManagedPluginName,
  storeRootEscapesManagedRoot,
  writeManagedInstallManifest,
} from "./managed-artifacts"

const AGENT_CONFIGS_GROUP = "agent-configs"
const AGENT_PROMPTS_GROUP = "agent-prompts"
const SKILLS_GROUP = "skills"

/**
 * Resolves Vibe CLI directory paths
 * outputRoot can be:
 * - A directory where .vibe/ should be created (e.g., /tmp/vibe-test)
 * - A directory that IS the .vibe directory (e.g., ~/.vibe or --vibe-home value)
 */
function resolveVibePaths(outputRoot?: string, outputIsVibeRoot = false): VibePaths {
  if (!outputRoot) {
    const home = process.env.HOME || ""
    const vibeHome = process.env.VIBE_HOME || path.join(home, ".vibe")
    return {
      root: vibeHome,
      vibeDir: vibeHome,
      configPath: path.join(vibeHome, "config.toml"),
      skillsDir: path.join(vibeHome, "skills"),
      agentsDir: path.join(vibeHome, "agents"),
      promptsDir: path.join(vibeHome, "prompts"),
    }
  }

  // Check if outputRoot is already a .vibe directory by checking its basename
  const basename = path.basename(outputRoot)
  const isVibeDir = outputIsVibeRoot || basename === ".vibe" || basename === "vibe"

  if (isVibeDir) {
    // outputRoot is already the .vibe directory (e.g., ~/.vibe or --vibe-home ~/.vibe)
    return {
      root: outputRoot,
      vibeDir: outputRoot,
      configPath: path.join(outputRoot, "config.toml"),
      skillsDir: path.join(outputRoot, "skills"),
      agentsDir: path.join(outputRoot, "agents"),
      promptsDir: path.join(outputRoot, "prompts"),
    }
  }

  // outputRoot is a parent directory, create .vibe/ inside it
  return {
    root: outputRoot,
    vibeDir: path.join(outputRoot, ".vibe"),
    configPath: path.join(outputRoot, ".vibe", "config.toml"),
    skillsDir: path.join(outputRoot, ".vibe", "skills"),
    agentsDir: path.join(outputRoot, ".vibe", "agents"),
    promptsDir: path.join(outputRoot, ".vibe", "prompts"),
  }
}

type VibePaths = {
  root: string
  vibeDir: string
  configPath: string
  skillsDir: string
  agentsDir: string
  promptsDir: string
}

export async function writeVibeBundle(
  outputRoot: string,
  bundle: VibeBundle,
  scope?: "global" | "workspace",
): Promise<void> {
  const paths = resolveVibePaths(outputRoot, scope === "global")

  console.log(`Writing Vibe CLI bundle to: ${paths.vibeDir}`)

  await ensureDir(paths.vibeDir)
  await ensureDir(paths.skillsDir)
  await ensureDir(paths.agentsDir)
  await ensureDir(paths.promptsDir)

  const pluginName = sanitizeManagedPluginName(resolveManagedSegment(bundle.pluginName))
  const managedDir = path.join(paths.vibeDir, pluginName)
  const managedDirEscaped = await storeRootEscapesManagedRoot(paths.vibeDir, managedDir)
  const manifest = managedDirEscaped
    ? null
    : await readManagedInstallManifestWithLegacyFallback(managedDir, pluginName)
  const currentAgentConfigs = bundle.agents.map((agent) => `${sanitizePathName(agent.name)}.toml`)
  const currentAgentPrompts = bundle.agents.map((agent) => `${sanitizePathName(agent.name)}.md`)
  const currentSkills = [
    ...bundle.generatedSkills.map((skill) => sanitizePathName(skill.name)),
    ...bundle.skillDirs.map((skill) => sanitizePathName(skill.name)),
  ]
  const agentsEscaped = await storeRootEscapesManagedRoot(paths.vibeDir, paths.agentsDir)
  const promptsEscaped = await storeRootEscapesManagedRoot(paths.vibeDir, paths.promptsDir)
  const skillsEscaped = await storeRootEscapesManagedRoot(paths.vibeDir, paths.skillsDir)

  if (!agentsEscaped) {
    await cleanupRemovedManagedFiles(paths.agentsDir, manifest, AGENT_CONFIGS_GROUP, currentAgentConfigs)
  }
  if (!promptsEscaped) {
    await cleanupRemovedManagedFiles(paths.promptsDir, manifest, AGENT_PROMPTS_GROUP, currentAgentPrompts)
  }
  if (!skillsEscaped) {
    await cleanupRemovedManagedDirectories(paths.skillsDir, manifest, SKILLS_GROUP, currentSkills)
  }

  const preservedAgentConfigs = new Set<string>()
  const preservedAgentPrompts = new Set<string>()
  const preservedSkills = new Set<string>()

  if (bundle.agents.length > 0) {
    console.log(`Writing ${bundle.agents.length} agent(s)...`)
    for (const agent of bundle.agents) {
      const result = await writeVibeAgent(paths, agent, manifest, {
        skipConfig: agentsEscaped,
        skipPrompt: promptsEscaped,
      })
      const safeName = sanitizePathName(agent.name)
      if (result.configPreserved) preservedAgentConfigs.add(`${safeName}.toml`)
      if (result.promptPreserved) preservedAgentPrompts.add(`${safeName}.md`)
    }
  }

  if (bundle.generatedSkills.length > 0) {
    console.log(`Writing ${bundle.generatedSkills.length} generated skill(s)...`)
    for (const skill of bundle.generatedSkills) {
      const safeName = sanitizePathName(skill.name)
      if (skillsEscaped || await writeVibeSkill(paths, skill, manifest)) {
        preservedSkills.add(safeName)
      }
    }
  }

  if (bundle.skillDirs.length > 0) {
    console.log(`Copying ${bundle.skillDirs.length} skill directory(ies)...`)
    for (const skill of bundle.skillDirs) {
      const safeName = sanitizePathName(skill.name)
      if (skillsEscaped || await copyVibeSkillDir(paths, skill, manifest)) {
        preservedSkills.add(safeName)
      }
    }
  }

  if (!managedDirEscaped) {
    await ensureDir(managedDir)
    await writeManagedInstallManifest(managedDir, {
      version: 1,
      pluginName,
      groups: {
        [AGENT_CONFIGS_GROUP]: agentsEscaped ? [] : currentAgentConfigs.filter((name) => !preservedAgentConfigs.has(name)),
        [AGENT_PROMPTS_GROUP]: promptsEscaped ? [] : currentAgentPrompts.filter((name) => !preservedAgentPrompts.has(name)),
        [SKILLS_GROUP]: skillsEscaped ? [] : currentSkills.filter((name) => !preservedSkills.has(name)),
      },
    })
  }

  await writeVibeConfig(paths.configPath, bundle.mcpServers, pluginName)

  console.log("Done!")
}

async function writeVibeAgent(
  paths: VibePaths,
  agent: { name: string; config: Record<string, unknown>; promptContent: string },
  manifest: Awaited<ReturnType<typeof readManagedInstallManifestWithLegacyFallback>>,
  options: { skipConfig: boolean; skipPrompt: boolean },
): Promise<{ configPreserved: boolean; promptPreserved: boolean }> {
  const safeName = sanitizePathName(agent.name)
  const agentConfigPath = path.join(paths.agentsDir, `${safeName}.toml`)
  const promptPath = path.join(paths.promptsDir, `${safeName}.md`)

  const configPreserved = options.skipConfig || await cleanupCurrentManagedFile(
    agentConfigPath,
    manifest,
    AGENT_CONFIGS_GROUP,
    `${safeName}.toml`,
  )
  const promptPreserved = options.skipPrompt || await cleanupCurrentManagedFile(
    promptPath,
    manifest,
    AGENT_PROMPTS_GROUP,
    `${safeName}.md`,
  )
  if (!configPreserved) {
    const configContent = formatToml(agent.config)
    await writeText(agentConfigPath, configContent + "\n")
  }
  if (!promptPreserved) {
    await writeText(promptPath, agent.promptContent + "\n")
  }

  console.log(`  Agent: ${safeName}`)
  return { configPreserved, promptPreserved }
}

async function writeVibeSkill(
  paths: VibePaths,
  skill: { name: string; content: string },
  manifest: Awaited<ReturnType<typeof readManagedInstallManifestWithLegacyFallback>>,
): Promise<boolean> {
  const safeName = sanitizePathName(skill.name)
  const skillDir = path.join(paths.skillsDir, safeName)
  if (await cleanupCurrentManagedDirectory(skillDir, manifest, SKILLS_GROUP, safeName)) return true
  await ensureDir(skillDir)

  const skillPath = path.join(skillDir, "SKILL.md")
  await writeText(skillPath, skill.content + "\n")

  console.log(`  Skill: ${safeName}`)
  return false
}

async function copyVibeSkillDir(
  paths: VibePaths,
  skill: { name: string; sourceDir: string },
  manifest: Awaited<ReturnType<typeof readManagedInstallManifestWithLegacyFallback>>,
): Promise<boolean> {
  const safeName = sanitizePathName(skill.name)
  const destDir = path.join(paths.skillsDir, safeName)
  const sourcePath = path.join(skill.sourceDir, "SKILL.md")
  const sourceContent = await fs.readFile(sourcePath, "utf8")
  if (!canConvertSkillContentForVibe(sourceContent, sourcePath)) {
    // A previous install may have emitted this skill before its source became
    // unrepresentable. Remove only the manifest-owned artifact; an unowned
    // collision is preserved by the same ownership guard as ordinary updates.
    await cleanupCurrentManagedDirectory(destDir, manifest, SKILLS_GROUP, safeName)
    console.warn(`Warning: skipping Vibe skill dir "${safeName}"; no exact Vibe tool mapping remains.`)
    return true
  }
  if (await cleanupCurrentManagedDirectory(destDir, manifest, SKILLS_GROUP, safeName)) return true
  await copySkillDir(skill.sourceDir, destDir, transformSkillContentForVibe, true, transformContentForVibe)

  console.log(`  Skill dir: ${safeName}`)
  return false
}

/**
 * Format a JavaScript object as TOML
 */
function formatToml(obj: Record<string, unknown>, indent: string = ""): string {
  return formatTomlObject(obj, [], indent)
}

async function writeVibeConfig(configPath: string, mcpServers: VibeMcpServer[] | undefined, pluginName: string): Promise<void> {
  const existing = await readFileSafe(configPath)
  const rendered = renderVibeMcpConfig(mcpServers)
  const merged = mergeVibeConfig(existing, rendered, pluginName)
  if (merged === null || merged === existing) return

  const backupPath = await backupFile(configPath)
  if (backupPath) {
    console.log(`Backed up existing config to ${backupPath}`)
  }

  await writeTextSecure(configPath, merged)
}

function renderVibeMcpConfig(mcpServers?: VibeMcpServer[]): string | null {
  if (!mcpServers || mcpServers.length === 0) return null

  const lines: string[] = []
  for (const server of mcpServers) {
    lines.push("[[mcp_servers]]")
    lines.push(`name = ${formatTomlString(server.name)}`)
    lines.push(`transport = ${formatTomlString(server.transport)}`)

    if (server.transport === "stdio") {
      lines.push(`command = ${formatTomlString(server.command)}`)
      if (server.args && server.args.length > 0) {
        lines.push(`args = [${server.args.map((arg) => formatTomlString(arg)).join(", ")}]`)
      }
      if (server.env && Object.keys(server.env).length > 0) {
        lines.push(`env = ${formatTomlInlineTable(server.env)}`)
      }
    } else {
      lines.push(`url = ${formatTomlString(server.url)}`)
      if (server.headers && Object.keys(server.headers).length > 0) {
        lines.push(`headers = ${formatTomlInlineTable(server.headers)}`)
      }
    }

    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function mergeVibeConfig(existingContent: string, mcpToml: string | null, pluginName: string): string | null {
  const startMarker = `# BEGIN Compound Engineering plugin MCP (${pluginName}) -- do not edit this block`
  const endMarker = `# END Compound Engineering plugin MCP (${pluginName})`
  const blockPattern = new RegExp(
    `${escapeForRegex(startMarker)}[\\s\\S]*?${escapeForRegex(endMarker)}\\n?`,
    "g",
  )
  const stripped = existingContent.replace(blockPattern, "").trimEnd()

  if (!mcpToml) {
    if (!existingContent) return null
    return stripped === existingContent.trimEnd() ? existingContent : stripped ? `${stripped}\n` : ""
  }

  const managedBlock = [
    startMarker,
    mcpToml,
    endMarker,
  ].join("\n")

  return stripped
    ? `${stripped}\n\n${managedBlock}\n`
    : `${managedBlock}\n`
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return ""
  }
}

function formatTomlObject(
  obj: Record<string, unknown>,
  pathParts: string[],
  indent: string,
): string {
  const lines: string[] = []
  const nestedTables: Array<[string, Record<string, unknown>]> = []

  for (const [rawKey, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue

    const key = formatTomlKey(rawKey)
    if (Array.isArray(value)) {
      lines.push(`${indent}${key} = [${value.map((item) => formatTomlPrimitive(item)).join(", ")}]`)
      continue
    }

    if (isPlainObject(value)) {
      const nested = value as Record<string, unknown>
      if (Object.keys(nested).length === 0) {
        lines.push(`${indent}${key} = {}`)
      } else {
        nestedTables.push([key, nested])
      }
      continue
    }

    lines.push(`${indent}${key} = ${formatTomlPrimitive(value)}`)
  }

  for (const [key, nested] of nestedTables) {
    if (lines.length > 0) lines.push("")
    lines.push(`${indent}[${[...pathParts, key].join(".")}]`)
    lines.push(formatTomlObject(nested, [...pathParts, key], indent))
  }

  return lines.join("\n")
}

function formatTomlKey(key: string): string {
  return key
    .replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())
    .replace(/^-_/, "")
    .replace(/_+$/, "")
    .replace(/_+/g, "_")
}

function formatTomlString(value: string): string {
  // TOML basic string escaping - wrap in quotes and escape special characters
  // Backslash, double-quote, and control characters need escaping
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

function formatTomlPrimitive(value: unknown): string {
  if (typeof value === "string") return formatTomlString(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return formatTomlString(String(value))
}

function formatTomlInlineTable(obj: Record<string, string>): string {
  return `{ ${Object.entries(obj).map(([key, value]) => `${formatTomlInlineKey(key)} = ${formatTomlString(value)}`).join(", ")} }`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function formatTomlInlineKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : formatTomlString(key)
}
