import { relative } from "node:path"

import type { BrowserWindow, WebContentsView } from "electron"
import { WebContentsView as ElectronWebContentsView } from "electron"

import type {
  EditorHostAdapter,
  EditorHostRect,
  EditorHostStatusListener,
  EditorHostStatusSnapshot,
  EditorHostSyncRequest,
} from "../shared/editor-host.js"
import { createInitialEditorHostStatus } from "../shared/editor-host.js"
import type { CodeOssServer } from "./code-oss-server.js"

type Logger = {
  info: (message: string) => void
  error: (message: string) => void
}

type ViewLike = Pick<WebContentsView, "setBounds" | "setVisible"> & {
  webContents: {
    loadURL: (url: string) => Promise<void>
    focus: () => void
    sendInputEvent: (event: Record<string, unknown>) => void
  }
}

type BrowserWindowLike = Pick<BrowserWindow, "contentView">

type ViewFactory = () => ViewLike

const KEY_MODIFIER =
  process.platform === "darwin"
    ? (["meta"] as string[])
    : (["control"] as string[])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export class EditorWorkspaceHost implements EditorHostAdapter {
  private readonly listeners = new Set<EditorHostStatusListener>()
  private readonly viewFactory: ViewFactory
  private readonly logger: Logger
  private readonly server: CodeOssServer
  private window: BrowserWindowLike | null = null
  private view: ViewLike | null = null
  private attached = false
  private visible = false
  private bounds: EditorHostRect | null = null
  private workspacePath: string | null = null
  private currentUrl: string | null = null
  private status = createInitialEditorHostStatus()

  constructor(
    server: CodeOssServer,
    logger: Logger = console,
    viewFactory: ViewFactory = () =>
      new ElectronWebContentsView() as unknown as ViewLike,
  ) {
    this.server = server
    this.logger = logger
    this.viewFactory = viewFactory

    this.server.subscribe((status) => {
      this.status = status
      this.emitStatus()
    })
  }

  attachToWindow(window: BrowserWindowLike): void {
    this.window = window
  }

  getStatus(): EditorHostStatusSnapshot {
    return { ...this.status }
  }

  subscribe(listener: EditorHostStatusListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())

    return () => {
      this.listeners.delete(listener)
    }
  }

  async sync(
    request: EditorHostSyncRequest,
  ): Promise<EditorHostStatusSnapshot> {
    this.visible = request.visible
    this.bounds = request.bounds

    const workspaceChanged = request.workspacePath !== this.workspacePath
    this.workspacePath = request.workspacePath

    if (!request.visible || !request.workspacePath) {
      this.detachView()
      return this.getStatus()
    }

    if (!this.bounds) {
      return this.getStatus()
    }

    if (!this.window) {
      this.updateStatus({
        phase: "error",
        message: "Editor host is not attached to a browser window.",
        workspacePath: request.workspacePath,
        serverUrl: null,
      })
      return this.getStatus()
    }

    const serverUrl = await this.server.ensureRunning(request.workspacePath)
    const nextUrl = serverUrl

    if (!this.view) {
      this.view = this.viewFactory()
    }

    if (!this.attached) {
      this.window.contentView.addChildView(this.view as never)
      this.attached = true
    }

    this.view.setVisible(true)
    this.view.setBounds(this.bounds)

    if (workspaceChanged || this.currentUrl !== nextUrl) {
      this.currentUrl = nextUrl
      await this.view.webContents.loadURL(nextUrl)
    }

    return this.getStatus()
  }

  async openWorkspace(path: string): Promise<void> {
    this.workspacePath = path
    await this.sync({
      visible: this.visible,
      bounds: this.bounds,
      workspacePath: path,
    })
  }

  async openFile(path: string): Promise<void> {
    if (!this.view || !this.workspacePath) {
      throw new Error("Editor host is not ready.")
    }

    const relativePath = relative(this.workspacePath, path) || path

    this.view.webContents.focus()
    await this.sendShortcut("p", KEY_MODIFIER)
    await sleep(80)
    await this.typeText(relativePath)
    await sleep(50)
    await this.pressKey("Enter")
  }

  async openDiff(leftPath: string, rightPath: string): Promise<void> {
    this.logger.info(
      `[editor-host] open_diff stubbed for spike: ${leftPath} -> ${rightPath}`,
    )
  }

  async openChangedFiles(paths: string[]): Promise<void> {
    if (paths[0]) {
      await this.openFile(paths[0])
    }
  }

  async createTerminal(cwd: string, _label?: string): Promise<void> {
    if (!this.view) {
      throw new Error("Editor host is not ready.")
    }

    if (this.workspacePath !== cwd) {
      await this.openWorkspace(cwd)
      await sleep(200)
    }

    this.view.webContents.focus()
    await this.sendShortcut("`", KEY_MODIFIER)
  }

  async runDebug(_profileId?: string): Promise<void> {
    this.logger.info("[editor-host] run_debug stubbed for spike")
  }

  async stop(): Promise<void> {
    this.detachView()
    await this.server.stop()
  }

  private detachView(): void {
    if (this.view) {
      this.view.setVisible(false)
    }

    if (this.attached && this.window && this.view) {
      this.window.contentView.removeChildView(this.view as never)
      this.attached = false
    }
  }

  private async sendShortcut(
    keyCode: string,
    modifiers: string[],
  ): Promise<void> {
    if (!this.view) {
      return
    }

    this.view.webContents.sendInputEvent({
      type: "keyDown",
      keyCode,
      modifiers,
    })
    this.view.webContents.sendInputEvent({
      type: "keyUp",
      keyCode,
      modifiers,
    })
  }

  private async pressKey(keyCode: string): Promise<void> {
    if (!this.view) {
      return
    }

    this.view.webContents.sendInputEvent({ type: "keyDown", keyCode })
    this.view.webContents.sendInputEvent({ type: "keyUp", keyCode })
  }

  private async typeText(text: string): Promise<void> {
    if (!this.view) {
      return
    }

    for (const character of text) {
      this.view.webContents.sendInputEvent({
        type: "char",
        keyCode: character,
        text: character,
      })
      await sleep(6)
    }
  }

  private updateStatus(
    partial: Partial<EditorHostStatusSnapshot> &
      Pick<EditorHostStatusSnapshot, "message">,
  ): void
  private updateStatus(partial: Partial<EditorHostStatusSnapshot>): void
  private updateStatus(partial: Partial<EditorHostStatusSnapshot>): void {
    this.status = {
      ...this.status,
      ...partial,
      workspacePath: partial.workspacePath ?? this.status.workspacePath,
      serverUrl:
        partial.serverUrl === undefined
          ? this.status.serverUrl
          : partial.serverUrl,
    }
    this.emitStatus()
  }

  private emitStatus(): void {
    for (const listener of this.listeners) {
      listener(this.getStatus())
    }
  }
}
