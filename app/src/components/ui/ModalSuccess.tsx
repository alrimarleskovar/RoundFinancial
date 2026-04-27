"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { Icons } from "@/components/brand/icons";
import { useTheme } from "@/lib/theme";

// Success state shown inside a modal after the user confirms an
// action. Big circular check + title + subtitle + optional CTA.

export function ModalSuccess({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string | ReactNode;
  cta?: ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "8px 4px 0",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: `${tokens.green}1A`,
          border: `1px solid ${tokens.green}4D`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <Icons.check size={32} stroke={tokens.green} sw={2.4} />
      </div>
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 20,
          fontWeight: 700,
          color: tokens.text,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </div>
      {body && (
        <div
          style={{
            fontSize: 12,
            color: tokens.text2,
            marginTop: 8,
            lineHeight: 1.5,
            maxWidth: 360,
          }}
        >
          {body}
        </div>
      )}
      {cta && <div style={{ marginTop: 18, width: "100%" }}>{cta}</div>}
    </motion.div>
  );
}
