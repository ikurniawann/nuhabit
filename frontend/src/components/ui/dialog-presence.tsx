"use client"

import * as React from "react"

type Presence = { open: boolean; onExitComplete: () => void }

const PresenceContext = React.createContext<Presence | null>(null)

/** Fallback unmount when no dialog under the presence reports its exit. */
const EXIT_FALLBACK_MS = 1000

type Absent = null | undefined | false

/**
 * Keeps a conditionally rendered dialog mounted until its exit animation ends.
 *
 * Replace `{item && <EditDialog item={item} />}` with
 * `<DialogPresence value={item}>{(item) => <EditDialog item={item} />}</DialogPresence>`.
 * While `value` is null, undefined or false, the children keep the last value
 * and every Dialog, AlertDialog or Sheet inside closes. They unmount once the
 * exit finishes. Reopening mounts a fresh instance, so forms start clean.
 */
export function DialogPresence<T>({
  value,
  children,
}: {
  value: T | Absent
  children: (value: T) => React.ReactNode
}) {
  // A presence nested in a closing presence closes with it.
  const parent = React.useContext(PresenceContext)
  const present = value !== null && value !== undefined && value !== false && (parent?.open ?? true)
  const [state, setState] = React.useState(() => ({
    value: present ? (value as T) : undefined,
    open: present,
    mounted: present,
    key: 0,
  }))

  let current = state
  if (present && (!state.open || state.value !== value)) {
    current = { value: value as T, open: true, mounted: true, key: state.open ? state.key : state.key + 1 }
  } else if (!present && state.open) {
    current = { ...state, open: false }
  }
  if (current !== state) setState(current)

  const onExitComplete = React.useCallback(() => {
    setState((s) => (s.open || !s.mounted ? s : { ...s, value: undefined, mounted: false }))
    if (parent && !parent.open) parent.onExitComplete()
  }, [parent])

  const closing = current.mounted && !current.open
  React.useEffect(() => {
    if (!closing) return
    const timer = setTimeout(onExitComplete, EXIT_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [closing, onExitComplete])

  const presence = React.useMemo(() => ({ open: current.open, onExitComplete }), [current.open, onExitComplete])

  if (!current.mounted) return null
  return (
    <PresenceContext.Provider key={current.key} value={presence}>
      {children(current.value as T)}
    </PresenceContext.Provider>
  )
}

/**
 * Lets a controlled dialog root follow the nearest DialogPresence: it closes
 * when the presence closes and reports when its exit animation has finished.
 */
export function usePresenceProps<
  P extends { open?: boolean; onOpenChangeComplete?: (open: boolean) => void },
>(props: P): P {
  const presence = React.useContext(PresenceContext)
  if (!presence || props.open === undefined) return props
  return {
    ...props,
    open: props.open && presence.open,
    onOpenChangeComplete: (open: boolean) => {
      props.onOpenChangeComplete?.(open)
      if (!open && !presence.open) presence.onExitComplete()
    },
  }
}
