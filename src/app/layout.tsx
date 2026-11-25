import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SATRuta | Gestión de Averías, Revisiones y Rutas en Campo",
  description:
    "Plataforma privada para coordinación de equipos técnicos, rutas OSRM por carretera y terminal móvil en campo con datos cifrados en la UE.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#d97706",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
