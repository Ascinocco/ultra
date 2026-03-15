import type { ChatRuntimeConfig } from "../chat-service.js"
import type { ChatRuntimeAdapter } from "./types.js"

export class ChatRuntimeRegistry {
  private readonly adapters: Map<
    ChatRuntimeConfig["provider"],
    ChatRuntimeAdapter
  >

  constructor(adapters: ChatRuntimeAdapter[]) {
    this.adapters = new Map(
      adapters.map((adapter) => [adapter.provider, adapter]),
    )
  }

  get(provider: ChatRuntimeConfig["provider"]): ChatRuntimeAdapter {
    const adapter = this.adapters.get(provider)

    if (!adapter) {
      throw new Error(`No chat runtime adapter registered for ${provider}.`)
    }

    return adapter
  }
}
