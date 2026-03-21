import { useEffect, useRef, type RefObject } from "react"

const NEAR_BOTTOM_THRESHOLD = 80

export function shouldAutoScroll(
  scrollBottom: number,
  scrollHeight: number,
  threshold: number,
): boolean {
  return scrollHeight - scrollBottom <= threshold
}

export function useAutoScroll(
  scrollRef: RefObject<HTMLElement | null>,
  deps: unknown[],
): void {
  const isNearBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function handleScroll() {
      // Ignore scroll events triggered by our own scrollTo
      if (programmaticScrollRef.current) return

      const el = scrollRef.current
      if (!el) return
      isNearBottomRef.current = shouldAutoScroll(
        el.scrollTop + el.clientHeight,
        el.scrollHeight,
        NEAR_BOTTOM_THRESHOLD,
      )
    }

    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [scrollRef])

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      programmaticScrollRef.current = true
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      // Reset flag after a tick so subsequent user scrolls are detected
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
