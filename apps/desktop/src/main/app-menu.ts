import type { MenuItemConstructorOptions } from "electron"

export const OPEN_SYSTEM_TOOLS_CHANNEL = "ultra-shell:open-system-tools"

export function createApplicationMenuTemplate(
  appName: string,
  onOpenSystemTools: () => void,
): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        {
          label: "System & Tools",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            onOpenSystemTools()
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
    },
    {
      role: "window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ]
}
