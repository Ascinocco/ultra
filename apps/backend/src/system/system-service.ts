import { randomUUID } from "node:crypto"

import type {
  BackendCapabilities,
  BackendInfoSnapshot,
  SystemHelloResult,
  SystemPingResult,
} from "@ultra/shared"
import { IPC_PROTOCOL_VERSION } from "@ultra/shared"

const BACKEND_VERSION = "0.0.0"

export class SystemService {
  private readonly sessionId = `sess_${randomUUID()}`
  private readonly capabilities: BackendCapabilities = {
    supportsProjects: true,
    supportsLayoutPersistence: true,
    supportsSubscriptions: false,
    supportsBackendInfo: true,
  }

  hello(): SystemHelloResult {
    return {
      acceptedProtocolVersion: IPC_PROTOCOL_VERSION,
      backendVersion: BACKEND_VERSION,
      sessionId: this.sessionId,
      capabilities: this.capabilities,
    }
  }

  getBackendInfo(): BackendInfoSnapshot {
    return {
      protocolVersion: IPC_PROTOCOL_VERSION,
      backendVersion: BACKEND_VERSION,
      sessionId: this.sessionId,
      capabilities: this.capabilities,
      runtime: "node",
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }
  }

  ping(now: () => string = () => new Date().toISOString()): SystemPingResult {
    return {
      status: "ok",
      timestamp: now(),
    }
  }
}
