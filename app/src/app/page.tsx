import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RoundFi — Cooperative credit, on-chain",
};

export default function HomePage() {
  return (
    <iframe
      src="/prototype/index.html"
      title="RoundFi Desktop"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: "none",
      }}
    />
  );
}
