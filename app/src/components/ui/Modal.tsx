"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icons } from "@/components/brand/icons";
import { useTheme } from "@/lib/theme";

// Generic modal: backdrop + centered dialog, Esc + click-outside
// closes, framer-motion entrance/exit. Renders into a portal so the
// dialog escapes any sticky/overflow ancestors.
//
// A11y (added in PR #135 — focus trap pass):
//   - `role="dialog"` + `aria-modal="true"` (already there)
//   - `aria-labelledby` links the title to the dialog so screen readers
//     announce it on focus
//   - Autofocus: dialog gets focus on mount (tabIndex={-1}) so screen
//     readers read the title and Tab navigates inside
//   - Focus trap: Tab + Shift+Tab cycle through focusable elements
//     inside the dialog only — keyboard users can't tab into the
//     content behind the backdrop
//   - Focus restoration: when the modal closes, focus returns to the
//     element that was active before opening (typically the trigger
//     button), matching native `<dialog>` semantics

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 460,
  closeable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
  closeable?: boolean;
}) {
  const { tokens, isDark } = useTheme();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Element that had focus before the modal opened — restored on close.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // ─── (1) capture the trigger so we can restore focus on close ──
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;

    // ─── (2) move focus into the dialog ───────────────────────────
    // Schedule via rAF so the framer-motion mount completes first
    // and the dialog ref is attached. Falls back to setTimeout for
    // environments without rAF.
    const focusDialog = () => {
      if (dialogRef.current && document.activeElement !== dialogRef.current) {
        dialogRef.current.focus();
      }
    };
    const raf =
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(focusDialog)
        : (setTimeout(focusDialog, 0) as unknown as number);

    // ─── (3) keyboard handling: Esc + Tab/Shift+Tab focus trap ────
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeable) {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusables.length === 0) {
        // No interactive children — keep focus on the dialog itself.
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      // If focus has somehow escaped the dialog (e.g. clicked the
      // backdrop and tabbed), pull it back to the first focusable.
      if (!active || !dialogRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    // ─── (4) lock body scroll while modal is open ─────────────────
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(raf);
      } else {
        clearTimeout(raf);
      }
      // ─── (5) restore focus to the trigger ──────────────────────
      // Guard against the previous element being detached (e.g. if
      // a route change happened while the modal was open).
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) {
        prev.focus();
      }
    };
  }, [open, onClose, closeable]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => closeable && onClose()}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            background: isDark ? "rgba(0,0,0,0.55)" : "rgba(20,20,20,0.35)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: width,
              maxHeight: "calc(100vh - 40px)",
              overflowY: "auto",
              background: tokens.surface1,
              border: `1px solid ${tokens.borderStr}`,
              borderRadius: 18,
              boxShadow: "0 28px 80px rgba(0,0,0,0.45)",
              padding: 22,
              fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              color: tokens.text,
              outline: "none", // tabIndex={-1} adds an outline by default
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  id={titleId}
                  style={{
                    fontFamily: "var(--font-syne), Syne",
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    color: tokens.text,
                  }}
                >
                  {title}
                </div>
                {subtitle && (
                  <div
                    style={{
                      fontSize: 12,
                      color: tokens.text2,
                      marginTop: 4,
                      lineHeight: 1.5,
                    }}
                  >
                    {subtitle}
                  </div>
                )}
              </div>
              {closeable && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: tokens.muted,
                    padding: 4,
                    display: "flex",
                  }}
                >
                  <Icons.close size={18} stroke={tokens.muted} />
                </button>
              )}
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
