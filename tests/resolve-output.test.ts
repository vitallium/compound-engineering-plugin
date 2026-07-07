import { afterEach, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { resolveCodexHome, resolveVibeHome } from "../src/utils/resolve-home"
import { resolveOpenCodeWriteScope, resolveTargetOutputRoot, resolveTargetWriteScope } from "../src/utils/resolve-output"

const baseOptions = {
  outputRoot: "/tmp/output",
  codexHome: path.join(os.homedir(), ".codex"),
  piHome: path.join(os.homedir(), ".pi", "agent"),
  vibeHome: path.join(os.homedir(), ".vibe"),
  hasExplicitOutput: false,
  hasExplicitVibeHome: false,
}

describe("resolveTargetOutputRoot", () => {
  test("codex returns codexHome", () => {
    const result = resolveTargetOutputRoot({ ...baseOptions, targetName: "codex" })
    expect(result).toBe(baseOptions.codexHome)
  })

  test("pi returns piHome", () => {
    const result = resolveTargetOutputRoot({ ...baseOptions, targetName: "pi" })
    expect(result).toBe(baseOptions.piHome)
  })

  test("vibe returns vibeHome by default", () => {
    const result = resolveTargetOutputRoot({ ...baseOptions, targetName: "vibe" })
    expect(result).toBe(baseOptions.vibeHome)
  })

  test("vibe returns custom vibeHome when provided", () => {
    const result = resolveTargetOutputRoot({
      ...baseOptions,
      targetName: "vibe",
      vibeHome: "/tmp/custom-vibe",
    })
    expect(result).toBe("/tmp/custom-vibe")
  })

  test("vibe writes a bare explicit output as a workspace root", () => {
    const result = resolveTargetOutputRoot({
      ...baseOptions,
      targetName: "vibe",
      hasExplicitOutput: true,
    })
    expect(result).toBe(baseOptions.outputRoot)
  })

  test("vibe writes an explicit workspace scope to the workspace root", () => {
    const result = resolveTargetOutputRoot({
      ...baseOptions,
      targetName: "vibe",
      scope: "workspace",
    })
    expect(result).toBe(baseOptions.outputRoot)
  })

  test("vibe keeps explicit global scope at vibeHome even with --output", () => {
    const result = resolveTargetOutputRoot({
      ...baseOptions,
      targetName: "vibe",
      hasExplicitOutput: true,
      scope: "global",
    })
    expect(result).toBe(baseOptions.vibeHome)
  })

  test("vibe keeps an explicit --vibe-home at the global root even with --output", () => {
    const result = resolveTargetOutputRoot({
      ...baseOptions,
      targetName: "vibe",
      hasExplicitOutput: true,
      hasExplicitVibeHome: true,
    })
    expect(result).toBe(baseOptions.vibeHome)
  })

  test("opencode with explicit output returns outputRoot as-is", () => {
    const result = resolveTargetOutputRoot({
      ...baseOptions,
      hasExplicitOutput: true,
      targetName: "opencode",
    })
    expect(result).toBe("/tmp/output")
  })

  describe("opencode without explicit output", () => {
    const originalEnv = process.env.OPENCODE_CONFIG_DIR

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalEnv
      }
    })

    test("falls back to ~/.config/opencode when OPENCODE_CONFIG_DIR is unset", () => {
      delete process.env.OPENCODE_CONFIG_DIR
      const result = resolveTargetOutputRoot({ ...baseOptions, targetName: "opencode" })
      expect(result).toBe(path.join(os.homedir(), ".config", "opencode"))
    })

    test("respects OPENCODE_CONFIG_DIR when set", () => {
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode"
      const result = resolveTargetOutputRoot({ ...baseOptions, targetName: "opencode" })
      expect(result).toBe("/custom/opencode")
    })
  })
})

describe("resolveCodexHome", () => {
  const originalCodexHome = process.env.CODEX_HOME

  afterEach(() => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = originalCodexHome
    }
  })

  test("uses CODEX_HOME when no explicit --codex-home is provided", () => {
    process.env.CODEX_HOME = "/tmp/custom-codex-profile"

    expect(resolveCodexHome(undefined)).toBe("/tmp/custom-codex-profile")
  })

  test("lets explicit --codex-home override CODEX_HOME", () => {
    process.env.CODEX_HOME = "/tmp/custom-codex-profile"

    expect(resolveCodexHome("/tmp/explicit-codex")).toBe("/tmp/explicit-codex")
  })
})

describe("resolveVibeHome", () => {
  const originalVibeHome = process.env.VIBE_HOME

  afterEach(() => {
    if (originalVibeHome === undefined) {
      delete process.env.VIBE_HOME
    } else {
      process.env.VIBE_HOME = originalVibeHome
    }
  })

  test("uses VIBE_HOME when no explicit --vibe-home is provided", () => {
    process.env.VIBE_HOME = "/tmp/custom-vibe-profile"

    expect(resolveVibeHome(undefined)).toBe("/tmp/custom-vibe-profile")
  })

  test("lets explicit --vibe-home override VIBE_HOME", () => {
    process.env.VIBE_HOME = "/tmp/custom-vibe-profile"

    expect(resolveVibeHome("/tmp/explicit-vibe")).toBe("/tmp/explicit-vibe")
  })
})

describe("resolveOpenCodeWriteScope", () => {
  test("returns 'global' when no explicit output and no requested scope", () => {
    expect(resolveOpenCodeWriteScope(false, undefined)).toBe("global")
  })

  test("returns undefined when explicit output is given and no requested scope", () => {
    expect(resolveOpenCodeWriteScope(true, undefined)).toBeUndefined()
  })

  test("honors explicit requested scope even without explicit output", () => {
    expect(resolveOpenCodeWriteScope(false, "workspace")).toBe("workspace")
  })

  test("honors explicit requested scope when explicit output is given", () => {
    expect(resolveOpenCodeWriteScope(true, "global")).toBe("global")
  })
})

describe("resolveTargetWriteScope", () => {
  test("preserves ordinary target scopes", () => {
    expect(
      resolveTargetWriteScope({
        targetName: "pi",
        hasExplicitOutput: false,
        hasExplicitVibeHome: false,
        scope: "workspace",
      }),
    ).toBe("workspace")
  })

  test("uses the explicit Vibe scope instead of a target default", () => {
    expect(
      resolveTargetWriteScope({
        targetName: "vibe",
        hasExplicitOutput: true,
        hasExplicitVibeHome: false,
        scope: "global",
        vibeScope: "workspace",
      }),
    ).toBe("workspace")
  })
})
