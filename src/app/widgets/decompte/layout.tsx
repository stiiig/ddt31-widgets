import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "DDT31 – Décompte des actes",
};

export default function DecompteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
