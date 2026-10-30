import { Plugin } from "@opencode/plugin/tui"
import { appendFileSync } from "node:fs"

/**
 * auto-model.status — barra de estado en el footer de OpenCode (estilo status line).
 *
 * En `prompt.footer.status` (sesión) y `home.footer.status` (inicio) muestra:
 *   - Cuota OpenCode Go: 5 h / semana / mes con su hora de reinicio
 *   - Modelo activo y coste acumulado de la sesión
 *
 * El uso de contexto (p. ej. `238.4K (23%)`) ya lo pinta OpenCode en su propio
 * footer, así que no lo duplicamos aquí.
 *
 * Nota de diseño: el estado vive en variables normales, no en signals de Solid
 * (el solid-js que resuelve un plugin local no comparte instancia con el
 * renderizador y las signals no redibujaban). Por eso los datos se cargan ANTES
 * de registrar los slots, y el footer se redibuja con cada cambio reactivo de la
 * sesión (coste, turno, modelo, props).
 *
 * Todo va envuelto en try/catch: si algo falla, la barra lo indica en vez de
 * romper la TUI. Si esta parte fallara al cargar, el enrutado de modelos
 * (parte servidor, index.ts) sigue funcionando igual.
 *
 * Diagnóstico: OPENCODE_STATUS_DEBUG=1 escribe /tmp/status-debug.log
 */

type Meter = { percent?: number; resetsAt?: number; limited?: boolean }
type Cuota = { rolling?: Meter; weekly?: Meter; monthly?: Meter }

const DBG = (() => {
  try {
    return process?.env?.OPENCODE_STATUS_DEBUG === "1"
  } catch {
    return false
  }
})()

const dbg = (msg: string) => {
  if (!DBG) return
  try {
    appendFileSync("/tmp/status-debug.log", `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* nada */
  }
}

const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })

const fecha = (ms: number) =>
  new Date(ms).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })

const restante = (ms: number) => {
  const d = ms - Date.now()
  if (d <= 0) return "ya"
  if (d >= 86_400_000) return `${Math.round(d / 86_400_000)} d`
  const h = Math.floor(d / 3_600_000)
  const m = Math.floor((d % 3_600_000) / 60_000)
  return h > 0 ? `${h} h ${m} m` : `${m} min`
}

const pct = (m?: Meter) => (m?.percent != null ? `${Math.round(m.percent)}%` : "–")

export default Plugin.define({
  id: "auto-model.status",
  async setup(context) {
    dbg("setup → inicio")

    let cuota: Cuota | null = null
    let error = ""
    let sessionID: string | undefined
    let timer: ReturnType<typeof setInterval> | undefined

    const conTiempo = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout " + ms + "ms")), ms)),
      ])

    const refrescar = async () => {
      try {
        const loc = (context.location ?? context.data.location.default()) as never
        const r = (await conTiempo(
          (context.client as never as Record<string, any>)["experimental"].usage.limits({
            location: loc,
          }),
          8000,
        )) as any
        const d = r?.data ?? r
        if (d?.go) {
          cuota = d.go as Cuota
          error = ""
          dbg("cuota OK " + JSON.stringify(cuota).slice(0, 220))
        } else {
          error = "sin go en la respuesta"
          dbg("cuota → sin campo go")
        }
      } catch (e) {
        error = "cuota: " + String(e).slice(0, 70)
        dbg("cuota ERROR " + String(e))
      }
    }

    // Cargado ANTES de registrar los slots: la primera pintada ya lleva datos.
    await refrescar()
    timer = setInterval(() => void refrescar(), 60_000)

    const Bloque = (props: any) => {
      try {
        const id = props?.sessionID
        if (id && id !== sessionID) {
          sessionID = id
          dbg("render → nueva sesión " + id)
        }

        const partes: string[] = []
        const q = cuota

        if (q?.rolling || q?.weekly || q?.monthly) {
          const r = q.rolling
          const w = q.weekly
          const m = q.monthly
          const p1 = `Go ${pct(r)} 5h${r?.resetsAt ? ` ↳${hora(r.resetsAt)} (${restante(r.resetsAt)})` : ""}`
          const p2 = `${pct(w)} sem${w?.resetsAt ? ` ↳${fecha(w.resetsAt)}` : ""}`
          const p3 = `${pct(m)} mes${m?.resetsAt ? ` ↳${fecha(m.resetsAt)}` : ""}`
          partes.push(`${p1} · ${p2} · ${p3}${m?.limited ? " ¡LÍMITE!" : ""}`)
        }

        const ses = id ? (context.data.session.get(id) as any) : undefined

        const ref = ses?.model ?? (context.ui.model.current?.() ?? null)
        const nombre =
          typeof ref === "string" ? ref : ((ref as any)?.name ?? (ref as any)?.id ?? "")
        if (nombre) partes.push(String(nombre))

        const coste = ses?.cost
        if (coste != null && coste !== "") {
          const n = Number(coste)
          if (Number.isFinite(n) && n > 0) partes.push(`$${n.toFixed(2)}`)
        }

        if (error) partes.push("⚠ " + error)
        if (partes.length === 0) partes.push("sin datos")

        const texto = "▪ " + partes.join("  │  ")
        dbg("render → " + texto)

        const dim = (context.theme as any)?.text?.dim ?? (context.theme as any)?.text?.base
        return <text fg={dim}>{texto}</text>
      } catch (e) {
        dbg("render → FATAL " + String(e))
        return null
      }
    }

    try {
      context.ui.slot({
        append: "prompt.footer.status",
        render: (props: any) => <Bloque {...props} />,
      })
      dbg("slot prompt.footer.status registrado")
    } catch (e) {
      dbg("slot prompt.footer.status falló: " + String(e))
    }

    try {
      context.ui.slot({
        append: "home.footer.status",
        render: (props: any) => <Bloque {...props} />,
      })
      dbg("slot home.footer.status registrado")
    } catch (e) {
      dbg("slot home.footer.status falló: " + String(e))
    }

    dbg("setup → fin")

    return () => {
      if (timer) clearInterval(timer)
    }
  },
})
