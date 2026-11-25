import Link from "next/link";
import {
  Wrench,
  ShieldCheck,
  ArrowRight,
  Database,
  ClipboardCheck,
  Lock,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col justify-between p-4 sm:p-8">
      {/* Header */}
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between py-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-black flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 block">
              Asistencia Técnica en Campo
            </span>
            <h1 className="text-xl font-black text-white">SATRuta</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/25">
            <ShieldCheck className="w-3.5 h-3.5" />
            Nube Cifrada UE · AES-256
          </span>
        </div>
      </header>

      {/* Main hero & selector */}
      <main className="max-w-5xl mx-auto w-full my-auto py-12 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white">
            Gestión y Rutas para{" "}
            <span className="text-amber-400">Averías y Revisiones</span> en Campo
          </h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Sincronización multidispositivo en la nube europea con acceso restringido por roles, cifrado de datos personales y soporte offline en aldeas sin cobertura.
          </p>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Admin / Despacho SAT */}
          <Link
            href="/admin"
            className="group block p-7 rounded-3xl bg-slate-900/70 backdrop-blur-md border border-white/[0.08] hover:border-amber-500/60 transition-all duration-200 shadow-xl hover:shadow-2xl hover:shadow-amber-500/10 relative overflow-hidden"
          >
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center group-hover:scale-110 transition duration-200">
                <Database className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                  Despacho / Coordinación SAT
                </span>
                <h3 className="text-2xl font-black text-white flex items-center justify-between">
                  <span>Acceso Coordinador</span>
                  <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-1 transition" />
                </h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Cartera de clientes cifrada en la nube, gestión de averías/revisiones, cálculo de jornada laboral, rutas OSRM por carretera, control de usuarios y cuota de 50 MB.
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-300">
                <span className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-white/[0.08]">
                  Solo Admins
                </span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-white/[0.08]">
                  Satélite Híbrido
                </span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-white/[0.08]">
                  OSRM + Jornada
                </span>
              </div>
            </div>
          </Link>

          {/* Técnico en Campo */}
          <Link
            href="/tecnico"
            className="group block p-7 rounded-3xl bg-slate-900/70 backdrop-blur-md border border-white/[0.08] hover:border-sky-500/60 transition-all duration-200 shadow-xl hover:shadow-2xl hover:shadow-sky-500/10 relative overflow-hidden"
          >
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center group-hover:scale-110 transition duration-200">
                <ClipboardCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-sky-400">
                  Terminal Móvil de Campo
                </span>
                <h3 className="text-2xl font-black text-white flex items-center justify-between">
                  <span>Modo Técnico</span>
                  <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-1 transition" />
                </h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Sincronización automática de avisos activos asignados al turno, navegación GPS directa, registro de tiempos y cobros con cola offline automática sin cobertura.
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-300">
                <span className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-white/[0.08]">
                  Solo Turno Activo
                </span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-white/[0.08]">
                  Offline Seguro
                </span>
                <span className="px-2.5 py-1 rounded-full bg-slate-800/80 border border-white/[0.08]">
                  Cierre Instantáneo
                </span>
              </div>
            </div>
          </Link>
        </div>
      </main>

      <footer className="max-w-5xl mx-auto w-full py-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-emerald-500" />
          Acceso autenticado en la UE (Supabase Irlanda · RLS + AES-256-GCM)
        </span>
        <Link href="/login" className="text-amber-400 hover:underline font-semibold">
          Cambiar de cuenta
        </Link>
      </footer>
    </div>
  );
}
