"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icons } from "@/components/brand/icons";
import { useTheme } from "@/lib/theme";

// Generic modal: backdrop + centered dialog, Esc + click-outside
// closes, framer-motion entrance/exit. Renders into a portal so the
// dialog escapes any sticky/overflow ancestors.

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeable) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock body scroll while modal is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
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
            role="dialog"
            aria-modal="true"
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
