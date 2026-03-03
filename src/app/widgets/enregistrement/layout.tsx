import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "DDT31 – Enregistrement AN/PC",
};

export default function EnregistrementLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
