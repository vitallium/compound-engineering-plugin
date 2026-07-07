import path from "path"
import type { TargetScope } from "../targets"
import { resolveOpenCodeGlobalRoot } from "./opencode-config"

export function resolveTargetOutputRoot(options: {
  targetName: string
  outputRoot: string
  codexHome: string
  piHome: string
  vibeHome: string
  pluginName?: string
  hasExplicitOutput: boolean
  hasExplicitVibeHome?: boolean
  scope?: TargetScope
}): string {
  const { targetName, outputRoot, codexHome, piHome, vibeHome, hasExplicitOutput, hasExplicitVibeHome, scope } = options
  if (targetName === "codex") return codexHome
  if (targetName === "pi") return piHome
  if (targetName === "antigravity") {
    const base = hasExplicitOutput ? outputRoot : process.cwd()
    return path.join(base, ".agy")
  }
  if (targetName === "vibe") {
    return resolveVibeWriteScope(hasExplicitOutput, scope, Boolean(hasExplicitVibeHome)) === "workspace"
      ? outputRoot
      : vibeHome
  }
  if (targetName === "kiro") {
    const base = hasExplicitOutput ? outputRoot : process.cwd()
    return path.join(base, ".kiro")
  }
  if (targetName === "opencode") {
    // Without an explicit --output, default to the OpenCode global-config root
    // (OPENCODE_CONFIG_DIR or ~/.config/opencode). With an explicit --output,
    // honor it as a workspace root and let the writer nest under .opencode/.
    if (!hasExplicitOutput) return resolveOpenCodeGlobalRoot()
    return outputRoot
  }
  return outputRoot
}

export function resolveVibeWriteScope(
  hasExplicitOutput: boolean,
  scope: TargetScope | undefined,
  hasExplicitVibeHome: boolean,
): TargetScope {
  if (scope === "workspace" || (hasExplicitOutput && scope !== "global" && !hasExplicitVibeHome)) {
    return "workspace"
  }
  return "global"
}

export function resolveTargetWriteScope(options: {
  targetName: string
  hasExplicitOutput: boolean
  hasExplicitVibeHome: boolean
  scope?: TargetScope
  vibeScope?: TargetScope
}): TargetScope | undefined {
  if (options.targetName === "vibe") {
    return resolveVibeWriteScope(options.hasExplicitOutput, options.vibeScope, options.hasExplicitVibeHome)
  }
  if (options.targetName === "opencode") {
    return resolveOpenCodeWriteScope(options.hasExplicitOutput, options.scope)
  }
  return options.scope
}

export function validateVibeOutputOptions(options: {
  scope?: TargetScope
  hasExplicitVibeHome: boolean
}): void {
  if (options.scope === "workspace" && options.hasExplicitVibeHome) {
    throw new Error("--vibe-home cannot be used with --scope workspace.")
  }
}

/**
 * Returns "global" when the OpenCode writer should use the flat global-config
 * layout (no `.opencode/` nesting). This is the case when the user did not
 * pass `--output` and did not pass an explicit `--scope`. Returns the
 * caller's requested scope otherwise so explicit `--scope workspace` still
 * wins.
 */
export function resolveOpenCodeWriteScope(
  hasExplicitOutput: boolean,
  requestedScope: TargetScope | undefined,
): TargetScope | undefined {
  if (requestedScope !== undefined) return requestedScope
  if (!hasExplicitOutput) return "global"
  return undefined
}
