import { AppShell } from "./components/AppShell.js"
import { AppStoreProvider } from "./state/app-store.js"

export function App() {
  return (
    <AppStoreProvider>
      <AppShell />
    </AppStoreProvider>
  )
}
