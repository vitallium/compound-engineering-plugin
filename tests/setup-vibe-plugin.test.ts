import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { promises as fs } from "fs"
import os from "os"
import path from "path"

setDefaultTimeout(60_000)

const script = path.join(import.meta.dir, "..", "scripts", "setup-vibe-plugin.ts")

async function makeTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function makeFakeRepo(root: string, skillNames: string[] = ["alpha", "beta"]): Promise<string> {
  const repo = path.join(root, "repo")
  for (const name of skillNames) {
    await fs.mkdir(path.join(repo, "skills", name), { recursive: true })
    await fs.writeFile(path.join(repo, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n\n${name}\n`)
  }
  // A stray non-skill file at the skills/ root must not ship inside the plugin.
  await fs.writeFile(path.join(repo, "skills", "CODING_STANDARDS.md"), "not a skill\n")
  await fs.mkdir(path.join(repo, ".vibe-plugin"), { recursive: true })
  await fs.writeFile(path.join(repo, ".vibe-plugin", "plugin.json"), "{}\n")
  return repo
}

// Child processes get an allowlisted environment; the script is pointed at
// throwaway --repo-root/--vibe-home directories, never this checkout.
function runSetup(args: string[], home: string) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: os.tmpdir(),
  }
  const proc = Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe", env })
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

async function lstatOrNull(target: string) {
  try {
    return await fs.lstat(target)
  } catch {
    return null
  }
}

describe("setup-vibe-plugin", () => {
  test("generates skills and links the plugin user-globally by default", async () => {
    const root = await makeTmpDir("vibe-setup-default-")
    const repo = await makeFakeRepo(root)
    const home = path.join(root, "home")

    const result = runSetup(["--repo-root", repo, "--vibe-home", home], home)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("2 skills")
    expect(result.stdout).toContain("Linked plugin (user scope)")

    const skillsDest = path.join(repo, ".vibe-plugin", "skills")
    expect((await fs.readdir(skillsDest)).sort()).toEqual(["alpha", "beta"])
    expect(await fs.readFile(path.join(skillsDest, "alpha", "SKILL.md"), "utf8")).toContain("name: alpha")

    const linkPath = path.join(home, "plugins", "compound-engineering")
    const stat = await lstatOrNull(linkPath)
    expect(stat?.isSymbolicLink()).toBe(true)
    expect(await fs.readlink(linkPath)).toBe(path.join(repo, ".vibe-plugin"))
  })

  test("is idempotent: a second run reports the existing link", async () => {
    const root = await makeTmpDir("vibe-setup-idem-")
    const repo = await makeFakeRepo(root)
    const home = path.join(root, "home")
    const args = ["--repo-root", repo, "--vibe-home", home]

    expect(runSetup(args, home).code).toBe(0)
    const second = runSetup(args, home)

    expect(second.code).toBe(0)
    expect(second.stdout).toContain("Already linked (user scope)")
    expect(await fs.readlink(path.join(home, "plugins", "compound-engineering"))).toBe(path.join(repo, ".vibe-plugin"))
  })

  test("never overwrites an existing non-symlink entry at the link path", async () => {
    const root = await makeTmpDir("vibe-setup-keep-")
    const repo = await makeFakeRepo(root)
    const home = path.join(root, "home")
    const existing = path.join(home, "plugins", "compound-engineering")
    await fs.mkdir(existing, { recursive: true })
    await fs.writeFile(path.join(existing, "keep.txt"), "user data\n")

    const result = runSetup(["--repo-root", repo, "--vibe-home", home], home)

    expect(result.code).toBe(0)
    expect(result.stderr + result.stdout).toContain("leaving it untouched")
    const stat = await lstatOrNull(existing)
    expect(stat?.isSymbolicLink()).toBe(false)
    expect(await fs.readFile(path.join(existing, "keep.txt"), "utf8")).toBe("user data\n")
  })

  test("does not re-point a symlink that targets a different checkout", async () => {
    const root = await makeTmpDir("vibe-setup-foreign-")
    const repo = await makeFakeRepo(root)
    const home = path.join(root, "home")
    const elsewhere = path.join(root, "elsewhere")
    await fs.mkdir(elsewhere, { recursive: true })
    const linkPath = path.join(home, "plugins", "compound-engineering")
    await fs.mkdir(path.dirname(linkPath), { recursive: true })
    await fs.symlink(elsewhere, linkPath, "dir")

    const result = runSetup(["--repo-root", repo, "--vibe-home", home], home)

    expect(result.code).toBe(0)
    expect(result.stderr + result.stdout).toContain("leaving it untouched")
    expect(await fs.readlink(linkPath)).toBe(elsewhere)
  })

  test("--scope project links into the repo's .vibe/plugins instead of the Vibe home", async () => {
    const root = await makeTmpDir("vibe-setup-project-")
    const repo = await makeFakeRepo(root)
    const home = path.join(root, "home")

    const result = runSetup(["--repo-root", repo, "--vibe-home", home, "--scope", "project"], home)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Linked plugin (project scope)")
    expect(result.stdout).toContain("trusted")
    const linkPath = path.join(repo, ".vibe", "plugins", "compound-engineering")
    expect((await lstatOrNull(linkPath))?.isSymbolicLink()).toBe(true)
    expect(await lstatOrNull(path.join(home, "plugins"))).toBeNull()
  })

  test("--no-link only regenerates the skills tree", async () => {
    const root = await makeTmpDir("vibe-setup-nolink-")
    const repo = await makeFakeRepo(root)
    const home = path.join(root, "home")

    const result = runSetup(["--repo-root", repo, "--vibe-home", home, "--no-link"], home)

    expect(result.code).toBe(0)
    expect((await fs.readdir(path.join(repo, ".vibe-plugin", "skills"))).sort()).toEqual(["alpha", "beta"])
    expect(await lstatOrNull(path.join(home, "plugins", "compound-engineering"))).toBeNull()
  })

  test("rejects an unknown --scope", async () => {
    const root = await makeTmpDir("vibe-setup-badscope-")
    const repo = await makeFakeRepo(root)
    const home = path.join(root, "home")

    const result = runSetup(["--repo-root", repo, "--vibe-home", home, "--scope", "bogus"], home)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown --scope "bogus"')
  })

  test("fails when a skill directory is missing SKILL.md", async () => {
    const root = await makeTmpDir("vibe-setup-badskill-")
    const repo = await makeFakeRepo(root, ["alpha"])
    await fs.mkdir(path.join(repo, "skills", "broken"), { recursive: true })
    const home = path.join(root, "home")

    const result = runSetup(["--repo-root", repo, "--vibe-home", home], home)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("skills/broken is missing SKILL.md")
  })
})
