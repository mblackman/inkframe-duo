import { useEffect, type RefObject } from "react";

/**
 * Progressive-enhancement roving-tabindex fallback for `focusgroup="toolbar ..."`.
 * Only installs when native `HTMLElement.prototype.focusGroup` is unsupported.
 */
export function useToolbarFocusGroup(
  toolbarRef: RefObject<HTMLElement | null>,
  orientationKey?: string
): void {
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!bar) return;
    if (typeof HTMLElement === "undefined" || "focusGroup" in HTMLElement.prototype) {
      return;
    }

    const getItems = (): HTMLElement[] =>
      Array.from(
        bar.querySelectorAll<HTMLElement>(
          'button:not([hidden]), [role="button"]:not([hidden]), select:not([hidden])'
        )
      ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

    const syncTabIndices = () => {
      const items = getItems();
      if (items.length === 0) return;
      const activeIdx = items.findIndex((el) => el.tabIndex === 0);
      const keepIdx = activeIdx >= 0 ? activeIdx : 0;
      items.forEach((el, idx) => {
        el.tabIndex = idx === keepIdx ? 0 : -1;
      });
    };

    syncTabIndices();

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const items = getItems();
      if (!items.includes(target)) return;
      items.forEach((el) => {
        el.tabIndex = el === target ? 0 : -1;
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const items = getItems();
      const idx = items.indexOf(target);
      if (idx === -1) return;

      const vertical = bar.getAttribute("aria-orientation") === "vertical";
      const rtl = getComputedStyle(bar).direction === "rtl";

      let nextIdx: number | null = null;
      if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = items.length - 1;
      } else if (vertical) {
        if (e.key === "ArrowDown") nextIdx = (idx + 1) % items.length;
        else if (e.key === "ArrowUp") nextIdx = (idx - 1 + items.length) % items.length;
      } else {
        const dir = rtl ? -1 : 1;
        if (e.key === "ArrowRight") nextIdx = (idx + dir + items.length) % items.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - dir + items.length) % items.length;
      }

      if (nextIdx === null) return;
      e.preventDefault();
      items.forEach((el, i) => {
        el.tabIndex = i === nextIdx ? 0 : -1;
      });
      items[nextIdx]?.focus();
    };

    bar.addEventListener("focusin", onFocusIn);
    bar.addEventListener("keydown", onKeyDown);

    return () => {
      bar.removeEventListener("focusin", onFocusIn);
      bar.removeEventListener("keydown", onKeyDown);
    };
  }, [toolbarRef, orientationKey]);
}
