import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PelletRoute | Gestión y Optimización de Reparto de Pellets",
  description:
    "Aplicación Web Progresiva (PWA) para gestionar clientes, pedidos de palés y sacos de pellets, flota de camiones y rutas de reparto.",
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
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
