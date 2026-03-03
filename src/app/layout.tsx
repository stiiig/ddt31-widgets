import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DDT31 Widgets",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* DSFR 1.14 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14/dist/dsfr.min.css"
        />
        <script
          defer
          src="https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14.0/dist/dsfr.module.min.js"
          type="module"
        />
        <script
          defer
          src="https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14.0/dist/dsfr.nomodule.min.js"
          noModule
        />
        {/* FontAwesome 6.5.1 */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
