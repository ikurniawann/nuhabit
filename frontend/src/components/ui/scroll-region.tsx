"use client"

import * as React from "react"

type ScrollRegionProps = React.ComponentProps<"div"> & {
  /** Screen-reader name of the region while it scrolls, in the page language. */
  label?: string
  /** Scroll direction to watch; "y" for lists that scroll vertically. */
  axis?: "x" | "y"
}

/**
 * Scroll container that keyboard users can focus and scroll with the arrow
 * keys. It turns into a named, focusable region only while its content
 * overflows, so a table that fits adds no extra tab stop.
 */
function ScrollRegion({ label = "Tabel", axis = "x", ...props }: ScrollRegionProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const update = () =>
      setScrollable(axis === "x" ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight)
    const resize = new ResizeObserver(update)
    const observeChildren = () => {
      resize.disconnect()
      resize.observe(el)
      for (const child of Array.from(el.children)) resize.observe(child)
      update()
    }
    // Re-observe when the content swaps, e.g. a skeleton replaced by rows.
    const mutation = new MutationObserver(observeChildren)
    mutation.observe(el, { childList: true })
    observeChildren()
    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [axis])

  return (
    <div
      ref={ref}
      {...props}
      {...(scrollable ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
    />
  )
}

export { ScrollRegion }
