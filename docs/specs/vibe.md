# Vibe CLI Target Specification

This document describes how the Compound Engineering plugin is converted to Mistral Vibe CLI format.

## Overview

Vibe CLI is Mistral AI's command-line interface for coding agents. It uses a directory-based structure for skills and agents, with TOML configuration for MCP servers.

## Installation

```bash
# Install Compound Engineering to Vibe CLI
bunx @every-env/compound-plugin install compound-engineering --to vibe

# Or from a local checkout
bun run src/index.ts install compound-engineering --to vibe
```

## Output Structure

The converter writes artifacts to the Vibe home directory (default `~/.vibe/`):

```
.vibe/
├── config.toml          # MCP server configuration (merged)
├── agents/
│   └── <name>.toml      # Agent configuration
├── prompts/
│   └── <name>.md        # Agent system prompts
└── skills/
    └── <name>/
        └── SKILL.md     # Skill definition
```

## Conversion Details

### Skills

Claude Code commands are converted to Vibe skills. Each skill is a single `SKILL.md` file with YAML frontmatter.

**Frontmatter fields:**

| Field | Source | Notes |
|-------|--------|-------|
| `name` | Command name (normalized) | Lowercase, hyphen-separated, max 64 chars |
| `description` | Command description | Truncated to 1024 chars |
| `user-invocable` | `!disableModelInvocation` | `false` if command has `disableModelInvocation: true` |
| `argument-hint` | Command argument hint | Preserved as-is |
| `allowed-tools` | Command allowed-tools | Mapped to Vibe tool names |
| `model` | Command model | Mapped to Vibe model identifier if known |

**Name Normalization:**

1. Convert to lowercase
2. Replace non-alphanumeric characters (except hyphens) with hyphens
3. Trim leading/trailing hyphens
4. Collapse multiple hyphens to single
5. Prefix with `ce-` if doesn't start with a letter
6. Truncate to 64 characters (with warning)

**Example:**
- `workflows:plan` → `workflows-plan`
- `CE-Review` → `ce-ce-review`
- `My_Skill` → `ce-my-skill`

### Skill Directories

Claude Code skills (directory-based) are copied as-is to the Vibe skills directory, with content transformation applied to all `.md` files.

### Agents

Claude Code agents are split into two files:

1. **Agent configuration** (`agents/<name>.toml`):
   - `agent_type`: `agent` or `subagent` (from `--agentMode` option)
   - `display_name`: Original agent name
   - `description`: Agent description
   - `safety`: Safety level (default: `safe`)
   - `active_model`: Mapped model identifier
   - `enabled_tools`: Array of allowed tool names
   - `system_prompt_id`: Agent name (references prompt file)

2. **Agent prompt** (`prompts/<name>.md`):
   - The full agent body content with platform-specific transformations applied

### MCP Servers

MCP servers are added to `config.toml` in a managed block:

```toml
# BEGIN Compound Engineering plugin MCP (compound-engineering) -- do not edit this block
[[mcp_servers]]
name = "server-name"
transport = "stdio"
command = "server-command"

[[mcp_servers]]
name = "another-server"
transport = "http"
url = "https://example.com/mcp"
# END Compound Engineering plugin MCP (compound-engineering)
```

**Supported transports:**
- `stdio`: Command-based servers
- `http`: HTTP-based servers
- `streamable-http`: Streamable HTTP servers

**Unsupported transports** (skipped with warning):
- `sse`
- Any other custom transport

## Tool Mapping

Claude Code tool names are mapped to Vibe CLI tool names:

| Claude Tool | Vibe Tool |
|-------------|-----------|
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit` | `search_replace` |
| `Glob` | `bash` |
| `List` | `list` |
| `Grep` | `grep` |
| `Bash` | `bash` |
| `WebFetch` | `web_fetch` |
| `codex:edit` | `search_replace` |
| `Patch` | `patch` |
| `Task` | `task` |
| `AskUserQuestion` | `ask_user_question` |

**Notes:**
- Scoped tool permissions (e.g., `Bash(git status)`) are **not representable** in Vibe CLI and will cause the artifact to be skipped with a warning
- Unknown tools are omitted from the allow-list

## Model Mapping

Known Claude model identifiers are automatically mapped to Vibe model identifiers:

| Claude Model | Vibe Model |
|--------------|------------|
| `claude-3-5-sonnet-20250620` | `mistral-large-latest` |
| `claude-3-5-sonnet` | `mistral-large-latest` |
| `claude-3-opus-20240229` | `mistral-large-latest` |
| `claude-3-opus` | `mistral-large-latest` |
| `claude-3-sonnet-20240229` | `mistral-medium-latest` |
| `claude-3-sonnet` | `mistral-medium-latest` |
| `claude-3-haiku-20240307` | `mistral-small-latest` |
| `claude-3-haiku` | `mistral-small-latest` |
| `claude-2:1`, `claude-2` | `mistral-medium-latest` |
| `claude-instant-1.2` | `mistral-small-latest` |
| `sonnet` | `mistral-medium-latest` |
| `haiku` | `mistral-small-latest` |
| `opus` | `mistral-large-latest` |

**Behavior:**
- Known Claude models are mapped to equivalent Vibe models
- Unknown Claude models are omitted with a warning, falling back to `--defaultModel` if provided
- Non-Claude model identifiers are passed through as-is

## Content Transformation

Skill and agent content is transformed to replace Claude-specific patterns with Vibe equivalents:

### Task Tracking Tools
- `TaskCreate` / `TaskUpdate` / `TaskList` → `task tracking`
- Platform-specific references are normalized to generic guidance

### Tool Names
- `AskUserQuestion` → `ask_user_question`
- `ToolSearch` → `grep`
- `Glob` → `bash` (in Claude Code context)
- `Grep` → `grep` (in Claude Code context)

### Agent/Subagent References
- `Agent tool` → `task tool`
- `Agent` (backticked, in tool context) → `task`
- `isolation: "worktree"` → removed (not applicable to Vibe)
- `subagent` → `task` (in all contexts)
- `Subagent` → `Task` (capitalized)

### Skill Invocation
- `` `Skill` in Claude Code `` → `direct skill invocation`
- Platform skill-invocation primitive references are normalized

### Worktree References
- `worktree isolation` → `task isolation`
- `.claude/worktrees/` paths are preserved (no Vibe equivalent)

### Platform Mentions
- `In Claude Code, use` → `In Vibe CLI, use`
- `In Claude Code, run` → `In Vibe CLI, run`
- `Claude Code only` → `Vibe CLI`

### Paths
- `.claude/` paths are **preserved** (no automatic transformation)
- Code fences with `.claude/` paths are preserved

**Rationale:** Vibe CLI uses `~/.vibe/` while Claude uses `~/.claude/`, but these are user-configurable and the paths in skill content are examples, not hardcoded requirements. Automatic transformation could break valid examples.

## Scope Options

The `--scope` flag controls where artifacts are installed:

| Scope | Output Location | Use Case |
|-------|-----------------|----------|
| `global` (default) | `~/.vibe/` or `$VIBE_HOME/` | User-wide installation |
| `workspace` | `<output>/.vibe/` | Project-specific installation |

**Note:** `--vibe-home` cannot be used with `--scope workspace`.

## Options

### Convert Command Options

| Option | Default | Description |
|--------|---------|-------------|
| `--to vibe` | - | Target format |
| `--vibe-home <path>` | `$VIBE_HOME` or `~/.vibe` | Custom Vibe home directory |
| `--scope <global\|workspace>` | `global` | Installation scope |
| `--agentMode <primary\|subagent>` | `subagent` | Default agent mode |
| `--defaultModel <model>` | - | Default model for agents |
| `--defaultSafety <level>` | `safe` | Default safety level |

### Install Command Options

Same as convert, plus:

| Option | Default | Description |
|--------|---------|-------------|
| `--plugin <name\|path>` | - | Plugin to install |
| `--branch <branch>` | - | Git branch to clone |
| `--also <targets>` | - | Comma-separated extra targets |

## Limitations

1. **Scoped Tool Permissions**: Vibe CLI only supports whole-tool permissions. Claude Code's scoped permissions like `Bash(git status)` cannot be represented and will cause the affected skill/agent to be skipped.

2. **Claude Model Identifiers**: Claude-specific model names (e.g., `claude-3-sonnet-20240229`) are not valid Vibe model IDs. Known models are mapped automatically; unknown ones are omitted with a warning.

3. **Claude Hooks**: Claude Code's hook system is not implemented for Vibe CLI. Hooks are omitted with a warning.

4. **MCP Transport Limitations**: Only `stdio`, `http`, and `streamable-http` transports are supported. Other transports (e.g., `sse`) are skipped with a warning.

5. **Name Truncation**: Skill/agent names exceeding 64 characters are truncated with a warning. This is a Vibe CLI limitation.

## Managed Install Manifest

The converter maintains an `install-manifest.json` in the plugin directory to track installed artifacts. This enables:

- Clean removal of stale artifacts when reinstalling
- Preservation of user-managed files
- Detection of drift between source and installed artifacts

**Manifest location:** `<vibe-dir>/<plugin-name>/install-manifest.json`

## Testing

Run the vibe-specific tests:

```bash
# All vibe tests
bun test tests/vibe-converter.test.ts tests/vibe-writer.test.ts tests/vibe-content.test.ts

# With parallel execution (as in CI)
bun run test -- tests/vibe-*.test.ts
```

## References

- [Vibe CLI Documentation](https://docs.mistral.ai/vibe/code/cli)
- [Vibe Skills Specification](https://docs.mistral.ai/vibe/code/cli/skills)
- [Vibe Agents Specification](https://docs.mistral.ai/vibe/code/cli/agents)
- [Agent Skills Specification](https://agentskills.io/specification)
