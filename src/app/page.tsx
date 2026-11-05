import Link from "next/link";
import {
  Truck,
  ShieldCheck,
  MapPin,
  QrCode,
  ArrowRight,
  Database,
  Navigation,
  Flame,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col justify-between p-4 sm:p-8">
      {/* Header */}
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between py-4 border-b border-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500 text-slate-950 font-black flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 block">
              Galicia Rural Logistics
            </span>
            <h1 className="text-xl font-black text-white">PelletGalicia</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            Local-First & Zero-Cloud
          </span>
        </div>
      </header>

      {/* Main hero & selector */}
      <main className="max-w-5xl mx-auto w-full my-auto py-12 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white">
            Optimización de Reparto de Pellets en <span className="text-amber-400">Galicia Rural</span>
          </h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Plataforma local y privada para furgón de reparto. Rutas por carretera real (OSRM + 2-Opt), precisión satelital para aldeas y terminal móvil efímera sin base de datos en la nube.
          </p>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Admin Role */}
          <Link
            href="/admin"
            className="group block p-7 rounded-3xl bg-slate-900 border-2 border-slate-800 hover:border-amber-500 transition-all duration-200 shadow-xl hover:shadow-2xl hover:shadow-amber-500/10 relative overflow-hidden"
          >
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center group-hover:scale-110 transition duration-200">
                <Database className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                  Panel de Control Local
                </span>
                <h3 className="text-2xl font-black text-white flex items-center justify-between">
                  <span>Acceso Administrador</span>
                  <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-1 transition" />
                </h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Gestión de clientes y pedidos en sacos (15 kg), mapa satélite de alta resolución para aldeas, optimizador de viajes por capacidad del furgón (90 sacos máx.), cálculo OSRM por carretera y generación de QR/enlaces efímeros.
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-400">
                <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">💾 IndexedDB / LocalStorage</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">🛰️ Esri Satélite</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">⚡ OSRM 2-Opt</span>
              </div>
            </div>
          </Link>

          {/* Reparto Role */}
          <Link
            href="/reparto"
            className="group block p-7 rounded-3xl bg-slate-900 border-2 border-slate-800 hover:border-sky-500 transition-all duration-200 shadow-xl hover:shadow-2xl hover:shadow-sky-500/10 relative overflow-hidden"
          >
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center group-hover:scale-110 transition duration-200">
                <Truck className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-sky-400">
                  Terminal Móvil de Conducción
                </span>
                <h3 className="text-2xl font-black text-white flex items-center justify-between">
                  <span>Modo Repartidor</span>
                  <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-1 transition" />
                </h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Terminal móvil para el teléfono del chofer en cabina. Se carga mediante el enlace/QR enviado por el Admin, navega dinámicamente con Google Maps multi-parada y destruye permanentemente los datos del cliente al confirmar la entrega.
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-400">
                <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">📲 Cero Rastro en Historial</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">🗺️ Google Maps Multi-Parada</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">🗑️ Borrado Instantáneo</span>
              </div>
            </div>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto w-full text-center text-xs text-slate-600 py-4 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span>PelletGalicia &bull; Sistema de Logística y Rutas para el Rural Gallego</span>
        <span className="text-slate-500">Diseñado con privacidad estricta: Local-First & Zero-Cloud</span>
      </footer>
    </div>
  );
}
