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
): void {
  const isNearBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const prevScrollHeightRef = useRef(0)

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
    const el = scrollRef.current
    if (!el) return

    prevScrollHeightRef.current = el.scrollHeight

    const observer = new ResizeObserver(() => {
      const currentScrollHeight = el.scrollHeight
      if (
        currentScrollHeight > prevScrollHeightRef.current &&
        isNearBottomRef.current
      ) {
        programmaticScrollRef.current = true
        el.scrollTop = el.scrollHeight
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false
        })
      }
      prevScrollHeightRef.current = currentScrollHeight
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRef])
}
