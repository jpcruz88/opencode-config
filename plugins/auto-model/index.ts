import { Plugin } from "@opencode/plugin"

/**
 * auto-model — enrutado automático por complejidad para OpenCode Go.
 *
 * Clasifica el prompt del usuario (tamaño + palabras clave) y cambia el modelo
 * de la sesión antes de que arranque el turno:
 *
 *   heavy → opencode-go/kimi-k3.1-pro     (tareas difíciles)
 *   mid   → opencode-go/kimi-k2.7-code    (código corriente)
 *   light → opencode-go/glm-5.3-flash     (tareas cortas / baratas)
 *
 * Respeta la elección manual: si el modelo de la sesión no está en la familia
 * gestionada (p. ej. gemini-4-argon, claude-haiku-5-5, beam-free), no se toca.
 */

type Tier = "heavy" | "mid" | "light"

const ROUTES: Record<Tier, { providerID: string; id: string }> = {
  heavy: { providerID: "opencode-go", id: "kimi-k3.1-pro" },
  mid: { providerID: "opencode-go", id: "kimi-k2.7-code" },
  light: { providerID: "opencode-go", id: "glm-5.3-flash" },
}

// Modelos que el router gestiona. Cualquier otro = elección manual → se respeta.
const MANAGED = new Set<string>([
  ...Object.values(ROUTES).map((m) => m.id),
  // modelos por defecto: una sesión nueva arranca aquí y debe enrutar igual
  "big-pickle",
  "iceman-contributor-free",
])

const HEAVY_WORDS = [
  "refactor", "arquitectura", "arquitecto", "redisena", "diseno", "disena",
  "depurar", "diagnostico", "migracion", "migra", "optimiza", "optimizacion",
  "planifica", "plan de", "estrategia", "analiza", "analisis", "a fondo",
  "paso a paso", "step by step", "compara", "comparar", "benchmark",
  "algoritmo", "todo el repositorio", "varios archivos", "clase completa",
  "desde cero", "concurrencia", "rendimiento", "performance", "revisa todo",
  "explica por que", "por que ocurre", "raiz del problema", "falla", "bug raro",
]

const LIGHT_WORDS = [
  "renombra", "formatea", "lint", "comentario", "comentarios", "resume",
  "resumen", "breve", "brevemente", "rapido", "una linea", "cual es",
  "que es", "busca", "grep", "commit", "titulo", "nombra", "explica en una",
]

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")

function classify(text: string): Tier {
  const t = strip(text)
  let score = 0

  const len = text.length
  if (len >= 1000) score += 2
  else if (len >= 400) score += 1
  else if (len <= 150) score -= 1

  let heavyHits = 0
  for (const w of HEAVY_WORDS) if (t.includes(w)) heavyHits++
  score += Math.min(heavyHits * 2, 6)

  let lightHits = 0
  for (const w of LIGHT_WORDS) if (t.includes(w)) lightHits++
  score -= Math.min(lightHits * 2, 5)

  if (score >= 2) return "heavy"
  if (score <= -1) return "light"
  return "mid"
}

function currentModelID(session: unknown): string | undefined {
  const s = session as { model?: unknown } | undefined
  const m = s?.model
  if (typeof m === "string") return m.includes("/") ? m.slice(m.indexOf("/") + 1) : m
  if (m && typeof m === "object") {
    const o = m as { id?: string; modelID?: string }
    return o.id ?? o.modelID
  }
  return undefined
}

export default Plugin.define({
  id: "auto-model",
  async setup(ctx) {
    await ctx.session.hook("prompt", async (event) => {
      try {
        const text = event.prompt?.text ?? ""
        if (!text.trim()) return

        const sessionID = (event as { sessionID?: string }).sessionID
        if (!sessionID) return

        const current = currentModelID(await ctx.session.get({ sessionID }))
        if (current && !MANAGED.has(current)) return // elección manual: no tocar

        const tier = classify(text)
        const target = ROUTES[tier]
        if (current === target.id) return

        await ctx.session.switchModel({ sessionID, model: target })
        console.log(`[auto-model] ${tier} → ${target.providerID}/${target.id}`)
      } catch (err) {
        console.log("[auto-model] " + String(err))
      }
    })

    console.log("[auto-model] cargado")
  },
})
