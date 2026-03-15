import type { AppPage } from "../state/app-store.js"

const navItems: Array<{ label: string; page: AppPage }> = [
  { label: "Chat", page: "chat" },
  { label: "Editor", page: "editor" },
  { label: "Browser", page: "browser" },
]

export function TopNav({
  currentPage,
  onSelectPage,
}: {
  currentPage: AppPage
  onSelectPage: (page: AppPage) => void
}) {
  return (
    <nav aria-label="Primary" className="top-nav">
      {navItems.map((item) => {
        const isActive = item.page === currentPage

        return (
          <button
            key={item.page}
            aria-current={isActive ? "page" : undefined}
            className={`top-nav__pill ${isActive ? "top-nav__pill--active" : ""}`}
            type="button"
            onClick={() => onSelectPage(item.page)}
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
