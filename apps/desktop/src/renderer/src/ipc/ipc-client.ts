import type {
  CommandMethodName,
  QueryMethodName,
  SubscribeRequestEnvelope,
  SubscriptionEventEnvelope,
  SubscriptionMethodName,
} from "@ultra/shared"
import {
  parseSubscribeRequest,
  parseSubscriptionEventEnvelope,
} from "@ultra/shared"

export class IpcClient {
  async query<T = unknown>(
    name: QueryMethodName,
    payload?: unknown,
  ): Promise<T> {
    return window.ultraShell.ipcQuery(name, payload) as Promise<T>
  }

  async command<T = unknown>(
    name: CommandMethodName,
    payload?: unknown,
  ): Promise<T> {
    return window.ultraShell.ipcCommand(name, payload) as Promise<T>
  }

  async subscribe(
    name: SubscriptionMethodName,
    payload: SubscribeRequestEnvelope["payload"],
    listener: (event: SubscriptionEventEnvelope) => void,
  ): Promise<() => Promise<void>> {
    const request = parseSubscribeRequest({
      protocol_version: "1.0",
      request_id: "req_subscribe_validation",
      type: "subscribe",
      name,
      payload,
    })
    const { subscriptionId } = await window.ultraShell.ipcSubscribe(
      request.name,
      request.payload,
    )

    const unsubscribeEvent = window.ultraShell.onIpcSubscriptionEvent(
      (subscriptionEvent) => {
        const parsedEvent = parseSubscriptionEventEnvelope(subscriptionEvent)

        if (parsedEvent.subscription_id === subscriptionId) {
          listener(parsedEvent)
        }
      },
    )

    return async () => {
      unsubscribeEvent()
      await window.ultraShell.ipcUnsubscribe(subscriptionId)
    }
  }
}

export const ipcClient = new IpcClient()
