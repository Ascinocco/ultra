import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { promisify } from "node:util"
import type {
  DependencyCheck,
  DependencyScope,
  DependencyStatus,
  DependencyTool,
  EnvironmentReadinessSnapshot,
  EnvironmentSessionMode,
} from "@ultra/shared"

const execFileAsync = promisify(execFile)
const TOOL_TIMEOUT_MS = 2_500

type ToolDefinition = {
  tool: DependencyTool
  displayName: string
  scope: DependencyScope
  command: string
  args: string[]
  helpText: string
}

type ToolCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>

type VersionRequirements = {
  nodeMinVersion: string | null
  pnpmMinVersion: string | null
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    tool: "git",
    displayName: "Git",
    scope: "runtime-required",
    command: "git",
    args: ["--version"],
    helpText: "Install Git and ensure `git` is on PATH.",
  },
  {
    tool: "ov",
    displayName: "Overstory CLI",
    scope: "runtime-required",
    command: "ov",
    args: ["--version"],
    helpText: "Install Overstory and ensure `ov` is on PATH.",
  },
  {
    tool: "tmux",
    displayName: "tmux",
    scope: "runtime-required",
    command: "tmux",
    args: ["-V"],
    helpText: "Install tmux and ensure `tmux` is on PATH.",
  },
  {
    tool: "sd",
    displayName: "Seeds CLI",
    scope: "runtime-required",
    command: "sd",
    args: ["--version"],
    helpText: "Install Seeds and ensure `sd` is on PATH.",
  },
  {
    tool: "codex",
    displayName: "Codex CLI",
    scope: "runtime-required",
    command: "codex",
    args: ["--version"],
    helpText: "Install Codex CLI and ensure `codex` is on PATH.",
  },
  {
    tool: "claude",
    displayName: "Claude Code CLI",
    scope: "runtime-required",
    command: "claude",
    args: ["--version"],
    helpText: "Install Claude Code and ensure `claude` is on PATH.",
  },
  {
    tool: "node",
    displayName: "Node.js",
    scope: "developer-required",
    command: "node",
    args: ["--version"],
    helpText: "Install a supported Node.js version for local development.",
  },
  {
    tool: "pnpm",
    displayName: "pnpm",
    scope: "developer-required",
    command: "pnpm",
    args: ["--version"],
    helpText: "Install a supported pnpm version for local development.",
  },
]

function resolveWorkspaceRoot(): string {
  return process.env.ULTRA_PROJECT_ROOT
    ? process.env.ULTRA_PROJECT_ROOT
    : resolve(import.meta.dirname, "../../../../")
}

function defaultSessionMode(): EnvironmentSessionMode {
  return process.env.ULTRA_BACKEND_SESSION_MODE === "desktop"
    ? "desktop"
    : "development"
}

function normalizeVersion(version: string): string | null {
  const match = version.trim().match(/v?(\d+)\.(\d+)(?:\.(\d+))?/)

  if (!match) {
    return null
  }

  const [, major, minor, patch = "0"] = match
  return `${major}.${minor}.${patch}`
}

function extractVersion(output: string): string | null {
  return normalizeVersion(output)
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part))
  const rightParts = right.split(".").map((part) => Number(part))

  for (let index = 0; index < 3; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0

    if (leftValue > rightValue) {
      return 1
    }

    if (leftValue < rightValue) {
      return -1
    }
  }

  return 0
}

function extractMinimumVersion(input: string | undefined): string | null {
  if (!input) {
    return null
  }

  return normalizeVersion(input)
}

function loadVersionRequirements(): VersionRequirements {
  const workspacePackage = JSON.parse(
    readFileSync(`${resolveWorkspaceRoot()}/package.json`, "utf8"),
  ) as {
    packageManager?: string
    engines?: {
      node?: string
      pnpm?: string
    }
  }

  return {
    nodeMinVersion: extractMinimumVersion(workspacePackage.engines?.node),
    pnpmMinVersion: extractMinimumVersion(
      workspacePackage.engines?.pnpm ??
        workspacePackage.packageManager?.split("@")[1],
    ),
  }
}

async function defaultRunToolCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    timeout: timeoutMs,
    maxBuffer: 64 * 1024,
  })
}

function isRequiredInSession(
  scope: DependencyScope,
  sessionMode: EnvironmentSessionMode,
): boolean {
  return scope === "runtime-required" || sessionMode === "development"
}

function buildCommandLabel(command: string, args: string[]): string {
  return [command, ...args].join(" ")
}

export class EnvironmentReadinessService {
  constructor(
    private readonly sessionMode: EnvironmentSessionMode = defaultSessionMode(),
    private readonly runToolCommand: ToolCommandRunner = defaultRunToolCommand,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly versionRequirements: VersionRequirements = loadVersionRequirements(),
  ) {}

  async getEnvironmentReadiness(): Promise<EnvironmentReadinessSnapshot> {
    return this.buildSnapshot()
  }

  async recheckEnvironment(): Promise<EnvironmentReadinessSnapshot> {
    return this.buildSnapshot()
  }

  private async buildSnapshot(): Promise<EnvironmentReadinessSnapshot> {
    const checks = await Promise.all(
      TOOL_DEFINITIONS.map((tool) => this.checkTool(tool)),
    )

    const status = checks.some(
      (check) => check.requiredInCurrentSession && check.status !== "ready",
    )
      ? "blocked"
      : "ready"

    return {
      status,
      sessionMode: this.sessionMode,
      checkedAt: this.now(),
      checks,
    }
  }

  private async checkTool(tool: ToolDefinition): Promise<DependencyCheck> {
    const requiredInCurrentSession = isRequiredInSession(
      tool.scope,
      this.sessionMode,
    )

    if (!requiredInCurrentSession) {
      return {
        tool: tool.tool,
        displayName: tool.displayName,
        scope: tool.scope,
        requiredInCurrentSession,
        status: "skipped",
        detectedVersion: null,
        command: buildCommandLabel(tool.command, tool.args),
        helpText: tool.helpText,
      }
    }

    try {
      const result = await this.runToolCommand(
        tool.command,
        tool.args,
        TOOL_TIMEOUT_MS,
      )
      const detectedVersion = extractVersion(
        `${result.stdout}\n${result.stderr}`.trim(),
      )

      return {
        tool: tool.tool,
        displayName: tool.displayName,
        scope: tool.scope,
        requiredInCurrentSession,
        status: this.resolveStatus(tool.tool, detectedVersion),
        detectedVersion,
        command: buildCommandLabel(tool.command, tool.args),
        helpText: this.buildHelpText(tool.tool, tool.helpText),
      }
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
        killed?: boolean
      }
      const status: DependencyStatus =
        maybeError.code === "ENOENT" ? "missing" : "error"

      return {
        tool: tool.tool,
        displayName: tool.displayName,
        scope: tool.scope,
        requiredInCurrentSession,
        status,
        detectedVersion: extractVersion(
          `${maybeError.stdout ?? ""}\n${maybeError.stderr ?? ""}`.trim(),
        ),
        command: buildCommandLabel(tool.command, tool.args),
        helpText:
          status === "missing"
            ? this.buildHelpText(tool.tool, tool.helpText)
            : `${tool.helpText} Probe failed while running \`${buildCommandLabel(tool.command, tool.args)}\`.`,
      }
    }
  }

  private resolveStatus(
    tool: DependencyTool,
    detectedVersion: string | null,
  ): DependencyStatus {
    if (tool === "node" && this.versionRequirements.nodeMinVersion) {
      if (
        !detectedVersion ||
        compareVersions(
          detectedVersion,
          this.versionRequirements.nodeMinVersion,
        ) < 0
      ) {
        return "unsupported"
      }
    }

    if (tool === "pnpm" && this.versionRequirements.pnpmMinVersion) {
      if (
        !detectedVersion ||
        compareVersions(
          detectedVersion,
          this.versionRequirements.pnpmMinVersion,
        ) < 0
      ) {
        return "unsupported"
      }
    }

    return "ready"
  }

  private buildHelpText(tool: DependencyTool, fallback: string): string {
    if (tool === "node" && this.versionRequirements.nodeMinVersion) {
      return `Install Node.js ${this.versionRequirements.nodeMinVersion} or newer and ensure \`node\` is on PATH.`
    }

    if (tool === "pnpm" && this.versionRequirements.pnpmMinVersion) {
      return `Install pnpm ${this.versionRequirements.pnpmMinVersion} or newer and ensure \`pnpm\` is on PATH.`
    }

    return fallback
  }
}
