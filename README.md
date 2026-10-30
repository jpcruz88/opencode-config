# opencode-config

Mi configuración de [OpenCode](https://opencode.ai) v2: **enrutado automático de modelos por complejidad** para la suscripción OpenCode Go (Go Plus), más comandos rápidos y el script `gomodel`.

Pensada para clonarse directamente en `~/.config/opencode` de cualquier Mac.

## Qué incluye

| Archivo | Qué hace |
|---|---|
| `opencode.jsonc` | Config global: plugin del router, agente `explore` barato y comandos `/potente` `/codigo` `/flash` |
| `plugins/auto-model/index.ts` | Router: clasifica cada mensaje y cambia el modelo antes de arrancar el turno |
| `plugins/auto-model/tui.tsx` | Barra de estado en el footer: cuota Go con reinicios, modelo y coste |
| `bin/gomodel` | Selector de modelos de Go con topes/peticiones por modelo y consulta de cuota |

No incluye credenciales: `service.json` (contraseña local) y los tokens de `~/.local/share/opencode/` quedan fuera con `.gitignore`.

## Instalación

### Máquina nueva (sin config previa)

```bash
git clone https://github.com/jpcruz88/opencode-config.git ~/.config/opencode
mkdir -p ~/.local/bin
ln -sf ~/.config/opencode/bin/gomodel ~/.local/bin/gomodel
gomodel        # comprueba
```

### Ya tienes config en `~/.config/opencode`

No clones encima (fallaría si hay archivos): copia lo que quieras.

```bash
git clone https://github.com/jpcruz88/opencode-config.git /tmp/opencode-config
cp /tmp/opencode-config/opencode.jsonc ~/.config/opencode/
cp -R /tmp/opencode-config/plugins ~/.config/opencode/
cp /tmp/opencode-config/bin/gomodel ~/.local/bin/gomodel && chmod +x ~/.local/bin/gomodel
```

Los cambios de config se recargan solos; si algo queda raro: `opencode service restart`.

## Cómo funciona el router

Antes de cada mensaje del usuario (una vez por turno) el plugin clasifica la tarea y cambia el modelo de la sesión:

| Señal del mensaje | Modelo |
|---|---|
| Largo (≥1000 car.) o palabras tipo *refactor, arquitectura, depurar, migración, plan, comparar, paso a paso* | `opencode-go/kimi-k3.1-pro` |
| Caso corriente | `opencode-go/kimi-k2.7-code` |
| Corto (≤150 car.) o palabras tipo *renombra, resume, breve, comenta, grep* | `opencode-go/glm-5.3-flash` |

El router **respeta tu elección manual**: solo actúa si el modelo de la sesión está en su familia gestionada (los tres anteriores + `iceman-contributor-free` + `big-pickle`). Si eliges `gemini-4-argon`, `grok-4.7`, `claude-haiku-5-5`, `beam-free`… no lo toca.

Verificación hecha:

| Prueba | Resultado |
|---|---|
| Prompt de arquitectura largo desde `glm-5.3-flash` | → `kimi-k3.1-pro` ✅ |
| Prompt medio («refactoriza src/auth.ts») | → `kimi-k2.7-code` ✅ |
| Prompt corto («renombra la variable x») | → se queda en `glm-5.3-flash` ✅ |
| Modelo manual `beam-free` + prompt difícil | → no interviene ✅ |
| Sesión nueva sin `--model` + prompt difícil | → `kimi-k3.1-pro` ✅ |

**Desactivarlo**: borra la línea `plugins` de `opencode.jsonc`.

**Cambiar los modelos**: edita `ROUTES` arriba del todo en `plugins/auto-model/index.ts`.

## Barra de estado en el footer

`plugins/auto-model/tui.tsx` añade una línea al footer de la TUI, tanto en la pantalla de inicio como dentro de una sesión:

```
▪ Go 82% 5h ↳20:12 (2 h 0 m) · 70% sem ↳1/11 · 35% mes ↳27/11  │  kimi-k3.1-pro  │  $0.42
```

| Fragmento | Significado |
|---|---|
| `Go 82% 5h ↳20:12 (2 h 0 m)` | Cuota de la ventana de 5 h gastada y cuándo se reinicia (5 h = 20% del tope mensual de cada modelo) |
| `70% sem ↳1/11 · 35% mes ↳27/11` | Semana y mes gastados con su fecha de reinicio |
| `kimi-k3.1-pro` | Modelo de la sesión |
| `$0.42` | Coste acumulado de la sesión |

El **uso de contexto** no se duplica: OpenCode ya lo pinta en su propio footer (por ejemplo `238.4K (23%)`).

Los datos se cargan antes de registrar los slots y se refrescan cada 60 s. Si la TUI ya estaba abierta al guardar, ejecuta `/reload` (o reiníciala).

**Diagnóstico**: `OPENCODE_STATUS_DEBUG=1 opencode` escribe `/tmp/status-debug.log` con cada render y cada fallo de la barra.

**Implementación**: el estado vive en variables normales, no en signals de Solid — un plugin local resuelve otro `solid-js` que el renderizador, y las signals no redibujaban la barra.

## Comandos

En la TUI:

- `/potente` · `/codigo` · `/flash` — fuerzan un modelo y ejecutan lo que escribas después.
- `/models` — selector completo.

En terminal:

```bash
gomodel                       # lista de modelos con tope mensual y peticiones (Go Plus por defecto)
gomodel go                    # mismos datos para el plan Go ($10)
gomodel uso                   # cuota en vivo: 5 h / semana / mes y fecha de reinicio
gomodel menu                  # selector interactivo
gomodel 1 "tu prompt"         # ejecuta directo con el modelo nº1
```

Los topes que muestra `gomodel` son los del plan contratado (Go Plus por defecto): cada modelo tiene 5 h = 20% de su tope mensual, semana = 50%, mes = 100%.

## Pendiente / ideas

- Ver el gasto **por modelo**: crear presupuestos en Console › Settings › Budgets (`per=model`) y `gomodel uso` los imprime.
- Añadir `mimo-v2.6-flash` a la familia gestionada si se quiere enrautar también esa sesión.
