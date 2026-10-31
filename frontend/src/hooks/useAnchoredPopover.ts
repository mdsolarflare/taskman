import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Viewport-anchored popover state
// ---------------------------------------------------------------------------

/** Fired on window whenever an anchored popover opens (detail = its id). */
const POPOVER_OPEN_EVENT = "taskman:anchored-popover-open";
let nextPopoverId = 1;

export interface PopoverAnchor {
  /** Viewport Y for the popover's top edge (field bottom + gap). */
  top: number;
  /** Viewport X of the field's left edge. */
  left: number;
  /** Viewport distance from the window's right edge to the field's right. */
  right: number;
  /** Viewport Y the popover must not pass (window bottom minus margin). */
  maxBottom: number;
}

/**
 * Popover positioning that survives clipping.
 *
 * A position:absolute popover inside the modal card is clipped by the card's
 * overflow-y:auto scroll box - near the card bottom the deadline popovers
 * were cut off by up to 113px until the user scrolled the modal. Measuring
 * the field at open time and anchoring with position:fixed in viewport
 * coordinates escapes the card's clip entirely; scrolling closes the popover
 * and a window resize re-anchors it, so it can never detach from its field.
 *
 * Attach the returned `setAnchorEl` as the callback ref of the element the
 * popover anchors to, and `setPopoverEl` on the popover root. No RefObject
 * crosses this hook's boundary - the anchor it returns is plain state, safe
 * to read during render. Anchored popovers are mutually exclusive: opening
 * one closes the others.
 */
export function useAnchoredPopover(): {
  open: boolean;
  toggle: () => void;
  close: () => void;
  setAnchorEl: (el: HTMLElement | null) => void;
  setPopoverEl: (el: HTMLElement | null) => void;
  anchor: PopoverAnchor | null;
} {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const popoverElRef = useRef<HTMLElement | null>(null);
  const idRef = useRef<number | null>(null);

  const setAnchorEl = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  const setPopoverEl = useCallback((el: HTMLElement | null) => {
    popoverElRef.current = el;
  }, []);

  const measure = useCallback((): PopoverAnchor | null => {
    const el = elRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.bottom + 4,
      left: r.left,
      right: window.innerWidth - r.right,
      maxBottom: window.innerHeight - 8,
    };
  }, []);

  const toggle = useCallback(() => {
    if (!open) {
      setAnchor(measure());
      // Opening closes every other anchored popover (the date, time and
      // zone pickers must never stack).
      if (idRef.current === null) idRef.current = nextPopoverId++;
      globalThis.dispatchEvent(
        new CustomEvent(POPOVER_OPEN_EVENT, { detail: idRef.current }),
      );
    }
    setOpen(!open);
  }, [open, measure]);

  const close = useCallback(() => setOpen(false), []);

  // Another anchored popover opened - close (they never stack).
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent).detail !== idRef.current) setOpen(false);
    };
    globalThis.addEventListener(POPOVER_OPEN_EVENT, onOpen);
    return () => globalThis.removeEventListener(POPOVER_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeFn = () => setOpen(false);
    // Outside click (the popover and its toggle stopPropagation). Scrolling
    // would leave a fixed popover detached from its field, so it closes -
    // EXCEPT scrolls from inside the popover itself (the time picker's
    // wheels and the zone list scroll by design). Resize re-anchors instead
    // - the popover must follow its field, not vanish.
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && popoverElRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reanchor = () => setAnchor(measure());
    globalThis.addEventListener("click", closeFn);
    globalThis.addEventListener("scroll", onScroll, true);
    globalThis.addEventListener("resize", reanchor);
    return () => {
      globalThis.removeEventListener("click", closeFn);
      globalThis.removeEventListener("scroll", onScroll, true);
      globalThis.removeEventListener("resize", reanchor);
    };
  }, [open, measure]);

  return { open, toggle, close, setAnchorEl, setPopoverEl, anchor };
}
