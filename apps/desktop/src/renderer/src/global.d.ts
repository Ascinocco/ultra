declare global {
  interface Window {
    ultraShell: {
      appName: string
      chromeVersion: string
      electronVersion: string
      nodeVersion: string
    }
  }
}

export {}
