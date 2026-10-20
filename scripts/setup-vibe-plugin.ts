#!/usr/bin/env bun
/**
 * Set up and install the native Vibe plugin (.vibe-plugin/).
 *
 * 1. Generates .vibe-plugin/skills/ by hardlinking each skill directory from
 *    the shared skills/ tree (falling back to a recursive copy where hardlinks
 *    are unsupported). Vibe requires every path inside a plugin to resolve
 *    within the plugin root, so a symlink from .vibe-plugin/skills to ../skills
 *    is rejected; and git cannot track hardlinks, so .vibe-plugin/skills/ is
 *    gitignored and regenerated here.
 * 2. Links the plugin into Vibe's plugin directory as a symlink:
 *      user scope (default): <vibe-home>/plugins/compound-engineering
 *      project scope:        <repo>/.vibe/plugins/compound-engineering
 *    where <vibe-home> is --vibe-home, else $VIBE_HOME, else ~/.vibe.
 *
 * Existing entries at the link path are never overwritten: an identical
 * symlink is reported as already linked, anything else is left untouched
 * with a warning.
 *
 * Usage: bun run vibe:setup [-- --scope user|project] [--vibe-home <path>]
 *                           [--no-link] [--repo-root <path>]
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { expandHome, resolveVibeHome } from "../src/utils/resolve-home"

const { values } = parseArgs({
  options: {
    scope: { type: "string", default: "user" },
    "vibe-home": { type: "string" },
    "no-link": { type: "boolean", default: false },
    "repo-root": { type: "string" },
    help: { type: "boolean", default: false },
  },
})

if (values.help) {
  console.log("Usage: bun run vibe:setup [-- --scope user|project] [--vibe-home <path>] [--no-link] [--repo-root <path>]")
  process.exit(0)
}

const scope = values.scope
if (scope !== "user" && scope !== "project") {
  console.error(`Unknown --scope "${scope}". Use "user" (default) or "project".`)
  process.exit(1)
}

const repoRoot = values["repo-root"]
  ? path.resolve(expandHome(values["repo-root"]))
  : path.join(import.meta.dir, "..")
const vibeHome = resolveVibeHome(values["vibe-home"] ? expandHome(values["vibe-home"]) : undefined)
const skillsSource = path.join(repoRoot, "skills")
const vibePluginDir = path.join(repoRoot, ".vibe-plugin")
const skillsDest = path.join(vibePluginDir, "skills")

if (!existsSync(skillsSource)) {
  console.error(`Source skills directory not found: ${skillsSource}`)
  process.exit(1)
}

// Validate source: every skill directory must contain SKILL.md.
// Non-directory entries (e.g., .DS_Store) are ignored.
const entries = readdirSync(skillsSource, { withFileTypes: true })
const skillDirs = entries.filter((entry) => entry.isDirectory())
if (skillDirs.length === 0) {
  console.error(`No skill directories found in ${skillsSource}`)
  process.exit(1)
}
for (const entry of skillDirs) {
  if (!existsSync(path.join(skillsSource, entry.name, "SKILL.md"))) {
    console.error(`skills/${entry.name} is missing SKILL.md`)
    process.exit(1)
  }
}

// Clean existing destination (symlink, directory, or stale files).
if (existsSync(skillsDest)) {
  const stat = lstatSync(skillsDest)
  if (stat.isSymbolicLink() || stat.isFile()) {
    unlinkSync(skillsDest)
  } else {
    rmSync(skillsDest, { recursive: true, force: true })
  }
}

// Copy only skill directories -- stray files at the skills/ root (e.g.
// CODING_STANDARDS.md) are not skills and must not ship inside the plugin.
// Try hardlinks first (cp -R -l). Falls back to copy if hardlinks are unsupported.
const sources = skillDirs.map((entry) => path.join(skillsSource, entry.name))
mkdirSync(skillsDest, { recursive: true })
let mode: "hardlinked" | "copied" = "copied"
const hardlinkResult = Bun.spawnSync(
  ["cp", "-R", "-l", ...sources, skillsDest],
  { stdout: "ignore", stderr: "ignore" },
)
if (hardlinkResult.exitCode === 0) {
  mode = "hardlinked"
} else {
  const copyResult = Bun.spawnSync(
    ["cp", "-R", ...sources, skillsDest],
    { stdout: "ignore", stderr: "pipe" },
  )
  if (copyResult.exitCode !== 0) {
    console.error(`Failed to copy skills: ${copyResult.stderr.toString()}`)
    process.exit(1)
  }
}

// Remove .DS_Store files if they were copied.
for (const dsStore of new Bun.Glob("**/.DS_Store").scanSync(skillsDest)) {
  unlinkSync(path.join(skillsDest, dsStore))
}

const skillCount = readdirSync(skillsDest, { withFileTypes: true }).filter(
  (entry) => entry.isDirectory(),
).length

console.log(`Vibe plugin skills ${mode}: ${skillCount} skills -> ${path.relative(repoRoot, skillsDest)}`)
console.log(`Plugin ready at: ${path.relative(repoRoot, vibePluginDir)}`)

if (values["no-link"]) {
  console.log("Skipping plugin link (--no-link). Link manually with:")
  console.log(`  mkdir -p <plugins-dir> && ln -s "${vibePluginDir}" <plugins-dir>/compound-engineering`)
  process.exit(0)
}

const pluginsDir = scope === "project"
  ? path.join(repoRoot, ".vibe", "plugins")
  : path.join(vibeHome, "plugins")
const linkPath = path.join(pluginsDir, "compound-engineering")

mkdirSync(pluginsDir, { recursive: true })

const existing = (() => {
  try {
    return lstatSync(linkPath)
  } catch {
    return null
  }
})()

if (existing) {
  if (existing.isSymbolicLink()) {
    const current = path.resolve(path.dirname(linkPath), readlinkSync(linkPath))
    if (current === vibePluginDir) {
      console.log(`Already linked (${scope} scope): ${linkPath} -> ${vibePluginDir}`)
    } else {
      console.warn(`Warning: ${linkPath} is a symlink to ${current}, not this checkout; leaving it untouched.`)
      console.warn(`To point it here instead: ln -sfn "${vibePluginDir}" "${linkPath}"`)
    }
  } else {
    console.warn(`Warning: ${linkPath} exists and is not a symlink; leaving it untouched.`)
    console.warn(`To install alongside manually: ln -s "${vibePluginDir}" "${linkPath}" (after moving that entry)`)
  }
} else {
  try {
    symlinkSync(vibePluginDir, linkPath, process.platform === "win32" ? "junction" : "dir")
    console.log(`Linked plugin (${scope} scope): ${linkPath} -> ${vibePluginDir}`)
  } catch (error) {
    console.error(`Failed to create symlink ${linkPath}: ${(error as Error).message}`)
    console.error(`Link manually: mkdir -p "${pluginsDir}" && ln -s "${vibePluginDir}" "${linkPath}"`)
    process.exit(1)
  }
}

if (scope === "project") {
  console.log("Note: project-scope plugins load only in trusted folders (vibe --trust or /trusted-folders).")
}
console.log("Next: in a running Vibe session run /reload-plugins (or start a new session),")
console.log("then check /plugins -- compound-engineering should list all skills under Components.")
console.log("Invoke a skill as /compound-engineering:<skill-name>, e.g. /compound-engineering:ce-plan")
