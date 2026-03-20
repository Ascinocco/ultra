import { useEffect, useRef, type RefObject } from "react"

const NEAR_BOTTOM_THRESHOLD = 50

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

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function handleScroll() {
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
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
