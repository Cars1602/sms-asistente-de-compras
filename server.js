require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const { generarOrdenDesdeCarpeta } = require("./processor");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "1224186667440867";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const CONFIG_PATH = path.join(__dirname, "config.json");
const batches = new Map();
const outboundMessages = new Map();

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const MENSAJE_SALUDO_DEFAULT = [
    "Hola. Soy UpdsAsistent, el asistente virtual encargado del envio de informacion de facturacion.",
    "",
    "Le hago llegar los datos solicitados de manera automatica. Por favor, verifique que la informacion sea correcta. Si necesita realizar alguna consulta, correccion o requiere asistencia adicional, nuestro equipo estara disponible para ayudarle.",
    "",
    "Gracias por su atencion."
].join("\n");

function validarConfigWhatsApp(accion) {
    const faltantes = [];
    if (!WHATSAPP_TOKEN) faltantes.push("WHATSAPP_TOKEN");
    if (!PHONE_NUMBER_ID) faltantes.push("PHONE_NUMBER_ID");
    if (faltantes.length) {
        throw new Error(`No se puede ${accion}. Falta configurar en Render: ${faltantes.join(", ")}`);
    }
}

function cargarConfig() {
    const envRecipients = cargarRecipientsDesdeEnv();
    const envSelected = cargarNumerosDesdeEnv(process.env.DEFAULT_ACTIVE_RECIPIENTS || process.env.DEFAULT_ACTIVE_RECIPIENT);
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return {
                recipients: envRecipients,
                activeRecipient: envSelected[0] || envRecipients[0]?.number || "",
                selectedRecipients: envSelected.length ? envSelected : envRecipients.map(r => r.number)
            };
        }
        const raw = fs.readFileSync(CONFIG_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const fileRecipients = Array.isArray(parsed.recipients) ? parsed.recipients : [];
        const merged = [...envRecipients];
        for (const recipient of fileRecipients) {
            if (!merged.some(r => r.number === recipient.number)) {
                merged.push(recipient);
            }
        }
        return {
            recipients: merged,
            activeRecipient: parsed.activeRecipient || envSelected[0] || merged[0]?.number || "",
            selectedRecipients: Array.isArray(parsed.selectedRecipients) && parsed.selectedRecipients.length
                ? parsed.selectedRecipients
                : (envSelected.length ? envSelected : (parsed.activeRecipient ? [parsed.activeRecipient] : merged.map(r => r.number)))
        };
    } catch (error) {
        console.error("Error leyendo config.json:", error.message);
        return {
            recipients: envRecipients,
            activeRecipient: envSelected[0] || envRecipients[0]?.number || "",
            selectedRecipients: envSelected.length ? envSelected : envRecipients.map(r => r.number)
        };
    }
}

function guardarConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function cargarRecipientsDesdeEnv() {
    const raw = process.env.DEFAULT_RECIPIENTS || "";
    if (!raw.trim()) return [];
    return raw
        .split(",")
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
            const [namePart, numberPart] = item.includes(":") ? item.split(":") : ["", item];
            const number = normalizarNumeroBolivia(numberPart);
            return number ? { name: namePart.trim(), number } : null;
        })
        .filter(Boolean);
}

function cargarNumerosDesdeEnv(raw) {
    return String(raw || "")
        .split(",")
        .map(item => normalizarNumeroBolivia(item))
        .filter(Boolean);
}

function obtenerDestinatarios(config) {
    const selected = Array.isArray(config.selectedRecipients) ? config.selectedRecipients : [];
    const valid = selected.filter(number => config.recipients.some(r => r.number === number));
    if (valid.length) return [...new Set(valid)];
    if (config.activeRecipient) return [config.activeRecipient];
    return [];
}

function normalizarNumeroBolivia(input) {
    let digits = String(input || "").replace(/\D/g, "");
    if (!digits) return "";
    digits = digits.replace(/^00/, "");
    digits = digits.replace(/^0+/, "");
    if (!digits.startsWith("591")) {
        digits = `591${digits}`;
    }
    return digits;
}

function mostrarNumero(numero) {
    return numero ? `+${numero}` : "ninguno";
}

function envFlag(nombre, valorPorDefecto = false) {
    const raw = process.env[nombre];
    if (raw === undefined) return valorPorDefecto;
    return ["1", "true", "si", "sí", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function resumenConfigSeguro() {
    const config = cargarConfig();
    const destinos = obtenerDestinatarios(config);
    return {
        whatsappToken: Boolean(WHATSAPP_TOKEN),
        phoneNumberId: Boolean(PHONE_NUMBER_ID),
        verifyToken: Boolean(VERIFY_TOKEN),
        openaiApiKey: Boolean(OPENAI_API_KEY),
        javascriptProcessor: true,
        openaiVendorAnalysis: envFlag("OPENAI_VENDOR_ANALYSIS", true),
        destinatariosGuardados: config.recipients.length,
        destinatariosMarcados: destinos.length,
        destinatariosActivos: destinos.map(mostrarNumero),
        uptimeSeconds: Math.round(process.uptime())
    };
}

function estadoTextoSeguro() {
    const estado = resumenConfigSeguro();
    return [
        "Estado del servidor:",
        `WHATSAPP_TOKEN: ${estado.whatsappToken ? "configurado" : "faltante"}`,
        `PHONE_NUMBER_ID: ${estado.phoneNumberId ? "configurado" : "faltante"}`,
        `Destinatarios marcados: ${estado.destinatariosMarcados}`,
        `Enviar a: ${estado.destinatariosActivos.join(", ") || "ninguno"}`,
        "Procesador: JavaScript",
        "Para procesar: envia PDF(s) y luego escribe SON TODOS. Para borrar el lote escribe CANCELAR."
    ].join("\n");
}

function esConsultaEstado(texto) {
    const clean = String(texto || "").trim().toLowerCase();
    return ["estado", "status", "config", "configuracion", "diagnostico"].includes(clean);
}

function esSaludo(texto) {
    const clean = String(texto || "").trim().toLowerCase();
    return ["hola", "buenas", "buen dia", "buenos dias", "buenas tardes", "buenas noches"].includes(clean);
}

function pareceToken(texto) {
    const clean = String(texto || "").replace(/\s/g, "");
    return clean.length >= 80 && /^[A-Za-z0-9_.=-]+$/.test(clean);
}

function registrarMensajeSaliente(data, numero, tipo, filename) {
    const messageId = data?.messages?.[0]?.id;
    if (!messageId) return;
    outboundMessages.set(messageId, {
        numero,
        tipo,
        filename,
        createdAt: new Date().toISOString()
    });
    console.log(`Meta acepto ${tipo} para ${mostrarNumero(numero)} con id ${messageId}`);
}

function procesarEstadosWhatsApp(statuses) {
    for (const status of statuses || []) {
        const info = outboundMessages.get(status.id);
        const destino = info?.numero || status.recipient_id || "";
        const errores = Array.isArray(status.errors) && status.errors.length
            ? ` errores=${JSON.stringify(status.errors)}`
            : "";
        console.log(
            `Estado WhatsApp ${status.status} para ${mostrarNumero(destino)} id=${status.id}${errores}`
        );
    }
}

function nombreSeguroArchivo(filename) {
    const base = path.basename(filename || "entrada.pdf");
    return base.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "entrada.pdf";
}

function esDocumentoPdf(documento) {
    const mimeType = String(documento?.mime_type || "").toLowerCase();
    const filename = String(documento?.filename || "").toLowerCase();
    return mimeType === "application/pdf" || filename.endsWith(".pdf");
}

function obtenerBatch(numero) {
    if (!batches.has(numero)) {
        const dir = path.join(__dirname, "temp", `lote_${numero}_${Date.now()}`);
        fs.mkdirSync(dir, { recursive: true });
        batches.set(numero, {
            dir,
            outputPath: path.join(dir, `orden_compra_${numero}.pdf`),
            files: [],
            prompted: false,
            processing: false,
            canceled: false
        });
    }
    return batches.get(numero);
}

function esConfirmacionFinal(texto) {
    const clean = String(texto || "").trim().toLowerCase();
    return ["son todos", "listo", "enviar", "terminado", "ya son todos"].includes(clean);
}

function esCancelacion(texto) {
    const clean = String(texto || "").trim().toLowerCase();
    return ["cancelar", "cancela", "cancelado", "anular", "borrar lote", "reiniciar"].includes(clean);
}

async function descargarMediaWhatsApp(mediaId, outputPath) {
    validarConfigWhatsApp("descargar el PDF de WhatsApp");
    const response = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    const mediaData = await response.json();
    if (!response.ok) {
        throw new Error(`Error al obtener URL del media: ${JSON.stringify(mediaData)}`);
    }

    const fileResponse = await fetch(mediaData.url, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    if (!fileResponse.ok) {
        throw new Error(`Error al descargar archivo: ${fileResponse.statusText}`);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
}

async function subirMediaWhatsApp(filePath, mimeType) {
    validarConfigWhatsApp("subir el PDF a WhatsApp");
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });
    const formData = new FormData();
    formData.append("file", blob, path.basename(filePath));
    formData.append("messaging_product", "whatsapp");

    const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/media`, {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Error al subir media: ${JSON.stringify(data)}`);
    }
    return data.id;
}

async function enviarDocumentoWhatsApp(numero, mediaId, filename) {
    validarConfigWhatsApp("enviar el documento por WhatsApp");
    const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: numero,
            type: "document",
            document: { id: mediaId, filename }
        }),
        headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
        }
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Error al enviar documento: ${JSON.stringify(data)}`);
    }
    registrarMensajeSaliente(data, numero, "document", filename);
    return data;
}

async function enviarTextoWhatsAppDirecto(numero, mensaje) {
    validarConfigWhatsApp("enviar mensajes por WhatsApp");
    const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: numero,
            type: "text",
            text: { preview_url: false, body: mensaje }
        }),
        headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
        }
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }
    registrarMensajeSaliente(data, numero, "text", "");
    return data;
}

async function enviarWhatsApp(numero, mensaje) {
    try {
        return await enviarTextoWhatsAppDirecto(numero, mensaje);
    } catch (error) {
        console.error("Error en enviarWhatsApp:", error.message);
        return null;
    }
}

async function responderIA(textoUsuario) {
    try {
        if (!openai) {
            return "Enviame los PDF como documentos. Cuando termines, escribe SON TODOS. Para borrar el lote, escribe CANCELAR.";
        }
        const respuesta = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "Responde siempre en español, de forma breve, respetuosa y útil. Si el usuario quiere convertir una orden de compra, indícale que envíe todos los PDF y luego escriba SON TODOS. Para borrar el lote debe escribir CANCELAR."
                },
                { role: "user", content: textoUsuario }
            ],
            max_tokens: 100
        });
        return respuesta.choices[0].message.content;
    } catch (error) {
        console.error("Error al consultar OpenAI:", error.message);
        return "Envíame los PDF como documentos. Cuando termines, escribe SON TODOS. Para borrar el lote, escribe CANCELAR.";
    }
}

function ejecutarJavascriptOrden(userTempDir, outputPath) {
    const timeoutMs = Number(process.env.PROCESS_TIMEOUT_MS || 240000);
    return Promise.race([
        generarOrdenDesdeCarpeta(userTempDir, outputPath, { tipoCambio: 6.97 }),
        new Promise((_, reject) => setTimeout(
            () => reject(new Error(`El procesamiento supero ${Math.round(timeoutMs / 60000)} minuto(s). Se cancelo para no saturar Render.`)),
            timeoutMs
        ))
    ]);
}

async function procesarLoteEnSegundoPlano(numero, batch) {
    const config = cargarConfig();
    const destinos = obtenerDestinatarios(config);

    if (!destinos.length) {
        batch.processing = false;
        await enviarWhatsApp(numero, "Falta configurar destinatarios. Abre /config, marca uno o varios numeros y vuelve a escribir SON TODOS.");
        return;
    }

    try {
        await enviarWhatsApp(numero, `Procesando ${batch.files.length} PDF(s) con JavaScript.`);
        await ejecutarJavascriptOrden(batch.dir, batch.outputPath);

        if (batch.canceled) {
            batches.delete(numero);
            return;
        }

        if (!fs.existsSync(batch.outputPath)) {
            batch.processing = false;
            await enviarWhatsApp(numero, "Termine el analisis, pero no se genero el PDF final. Revisa que los PDF tengan items legibles.");
            return;
        }

        await enviarWhatsApp(numero, "PDF generado. Ahora lo estoy subiendo a WhatsApp para enviarlo.");
        const mediaId = await subirMediaWhatsApp(batch.outputPath, "application/pdf");

        if (batch.canceled) {
            batches.delete(numero);
            return;
        }

        const enviados = [];
        const fallidos = [];
        for (const destino of destinos) {
            try {
                const respuestaEnvio = await enviarDocumentoWhatsApp(destino, mediaId, `Orden_de_Compra_${numero}.pdf`);
                enviados.push(destino);
                console.log(`Documento enviado a ${mostrarNumero(destino)}:`, JSON.stringify(respuestaEnvio));
            } catch (errorEnvio) {
                fallidos.push({ destino, error: errorEnvio.message });
                console.error(`No se pudo enviar a ${mostrarNumero(destino)}:`, errorEnvio.message);
            }
        }

        if (enviados.length) {
            await enviarWhatsApp(numero, `Listo. Envie la orden final a: ${enviados.map(mostrarNumero).join(", ")}.`);
        }
        if (fallidos.length) {
            const resumenFallidos = fallidos
                .map(f => `${mostrarNumero(f.destino)}: ${f.error}`)
                .join("\n");
            await enviarWhatsApp(numero, `No pude enviar a estos destinatarios:\n${resumenFallidos}`);
        }
        if (!enviados.length) {
            throw new Error("No se pudo enviar el PDF a ningun destinatario. Revisa en Render Logs el error exacto de Meta.");
        }
        batches.delete(numero);
    } catch (err) {
        if (batch.canceled) {
            batches.delete(numero);
            return;
        }
        batch.processing = false;
        console.error("Error procesando lote:", err.message);
        await enviarWhatsApp(numero, `Error procesando el lote: ${err.message}`);
    }
}

app.get("/", (req, res) => {
    res.redirect("/config");
});

app.get("/status", (req, res) => {
    res.json(resumenConfigSeguro());
});

app.get("/test-send", async (req, res) => {
    if (!VERIFY_TOKEN || req.query.token !== VERIFY_TOKEN) {
        return res.status(403).json({ ok: false, error: "token invalido" });
    }

    const numero = normalizarNumeroBolivia(req.query.to);
    const mensaje = String(req.query.text || "Prueba de envio desde el servidor").slice(0, 500);
    if (!numero) {
        return res.status(400).json({ ok: false, error: "numero invalido" });
    }

    try {
        const data = await enviarTextoWhatsAppDirecto(numero, mensaje);
        res.json({ ok: true, to: mostrarNumero(numero), data });
    } catch (error) {
        res.status(500).json({ ok: false, to: mostrarNumero(numero), error: error.message });
    }
});

app.get("/config", (req, res) => {
    const config = cargarConfig();
    const selectedSet = new Set(config.selectedRecipients || []);
    const rows = config.recipients.map(r => `
        <tr>
            <td>${r.name || "-"}</td>
            <td>${mostrarNumero(r.number)}</td>
            <td>
                <input form="selected-form" type="checkbox" name="numbers" value="${r.number}" ${selectedSet.has(r.number) ? "checked" : ""}>
            </td>
            <td>
                <form method="post" action="/config/delete">
                    <input type="hidden" name="number" value="${r.number}">
                    <button type="submit">Quitar</button>
                </form>
            </td>
        </tr>
    `).join("");

    res.send(`<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Destinatario de ordenes</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 32px; color: #151515; background: #f7f7f7; }
        main { max-width: 820px; margin: auto; background: white; padding: 24px; border: 1px solid #ddd; }
        h1 { font-size: 24px; margin-bottom: 8px; }
        .box { border: 1px solid #ccc; padding: 16px; margin: 18px 0; }
        label { display: block; font-weight: bold; margin-top: 10px; }
        input, button { font-size: 16px; padding: 8px; }
        input { width: 100%; box-sizing: border-box; }
        .phone { display: flex; gap: 8px; align-items: center; }
        .prefix { padding: 8px 10px; border: 1px solid #bbb; background: #f2f2f2; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
        .active { font-weight: bold; }
    </style>
</head>
<body>
<main>
    <h1>Envio de ordenes por WhatsApp</h1>
    <p>Destinatarios actuales: <span class="active">${obtenerDestinatarios(config).map(mostrarNumero).join(", ") || "ninguno"}</span></p>
    <div class="box">
        <form method="post" action="/config/recipients">
            <label>Nombre</label>
            <input name="name" placeholder="Ej: Compras, Administracion, Juan">
            <label>Numero Bolivia</label>
            <div class="phone">
                <span class="prefix">+591</span>
                <input name="number" placeholder="Ej: 71030013" required>
            </div>
            <p><button type="submit">Agregar y usar este numero</button></p>
        </form>
    </div>
    <div class="box">
        <h2>Numeros guardados</h2>
        <form id="selected-form" method="post" action="/config/selected"></form>
        <table>
            <thead><tr><th>Nombre</th><th>Numero</th><th>Enviar</th><th></th></tr></thead>
            <tbody>${rows || "<tr><td colspan='4'>Todavia no hay numeros guardados.</td></tr>"}</tbody>
        </table>
        <p><button form="selected-form" type="submit">Guardar destinatarios marcados</button></p>
    </div>
    <p>Flujo: envia todos los PDF al WhatsApp del bot. Cuando termines escribe <b>SON TODOS</b>. Para borrar el lote y empezar de nuevo escribe <b>CANCELAR</b>.</p>
</main>
</body>
</html>`);
});

app.post("/config/recipients", (req, res) => {
    const config = cargarConfig();
    const number = normalizarNumeroBolivia(req.body.number);
    const name = String(req.body.name || "").trim();
    if (number) {
        const existing = config.recipients.find(r => r.number === number);
        if (existing) {
            existing.name = name || existing.name;
        } else {
            config.recipients.push({ name, number });
        }
        config.activeRecipient = number;
        config.selectedRecipients = [...new Set([...(config.selectedRecipients || []), number])];
        guardarConfig(config);
    }
    res.redirect("/config");
});

app.post("/config/active", (req, res) => {
    const config = cargarConfig();
    const number = normalizarNumeroBolivia(req.body.number);
    if (config.recipients.some(r => r.number === number)) {
        config.activeRecipient = number;
        guardarConfig(config);
    }
    res.redirect("/config");
});

app.post("/config/selected", (req, res) => {
    const config = cargarConfig();
    const rawNumbers = Array.isArray(req.body.numbers)
        ? req.body.numbers
        : (req.body.numbers ? [req.body.numbers] : []);
    const selected = rawNumbers
        .map(normalizarNumeroBolivia)
        .filter(number => config.recipients.some(r => r.number === number));
    config.selectedRecipients = [...new Set(selected)];
    config.activeRecipient = config.selectedRecipients[0] || "";
    guardarConfig(config);
    res.redirect("/config");
});

app.post("/config/delete", (req, res) => {
    const config = cargarConfig();
    const number = normalizarNumeroBolivia(req.body.number);
    config.recipients = config.recipients.filter(r => r.number !== number);
    if (config.activeRecipient === number) {
        config.activeRecipient = config.recipients[0]?.number || "";
    }
    guardarConfig(config);
    res.redirect("/config");
});

app.post("/webhook", async (req, res) => {
    try {
        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        if (!value) {
            return res.sendStatus(200);
        }

        if (value.statuses) {
            procesarEstadosWhatsApp(value.statuses);
            return res.sendStatus(200);
        }

        if (!value.messages) {
            return res.sendStatus(200);
        }

        const mensaje = value.messages[0];
        const numero = mensaje.from;

        if (mensaje.type === "document" && mensaje.document && esDocumentoPdf(mensaje.document)) {
            const documentId = mensaje.document.id;
            const filename = nombreSeguroArchivo(mensaje.document.filename || "entrada.pdf");
            const batch = obtenerBatch(numero);
            const uniqueFilename = `${String(batch.files.length + 1).padStart(3, "0")}_${filename}`;
            const inputPath = path.join(batch.dir, uniqueFilename);

            try {
                await descargarMediaWhatsApp(documentId, inputPath);
                batch.files.push(inputPath);
                console.log(`PDF guardado: ${inputPath}`);

                if (!batch.prompted) {
                    batch.prompted = true;
                    const config = cargarConfig();
                    const destinos = obtenerDestinatarios(config);
                    await enviarWhatsApp(
                        numero,
                        `Recibi tu PDF. Puedes enviarme todos los PDF que falten. Cuando termines escribe: SON TODOS. Si quieres borrar este lote escribe: CANCELAR. La orden final se enviara a: ${destinos.map(mostrarNumero).join(", ") || "ningun numero configurado"}.`
                    );
                }
            } catch (err) {
                console.error("Error descargando PDF:", err.message);
                await enviarWhatsApp(numero, `No pude guardar ese PDF: ${err.message}`);
            }
            return res.sendStatus(200);
        }

        if (mensaje.type === "document") {
            console.log(`Documento ignorado de [${numero}] porque no parece PDF: ${JSON.stringify(mensaje.document || {})}`);
            return res.sendStatus(200);
        }

        const texto = mensaje.text?.body;
        if (texto) {
            console.log(`Mensaje recibido de [${numero}]: "${texto}"`);

            if (esConsultaEstado(texto)) {
                await enviarWhatsApp(numero, estadoTextoSeguro());
                return res.sendStatus(200);
            }

            if (pareceToken(texto)) {
                console.log(`Texto ignorado porque parece token de [${numero}]`);
                return res.sendStatus(200);
            }

            if (esSaludo(texto)) {
                await enviarWhatsApp(numero, MENSAJE_SALUDO_DEFAULT);
                return res.sendStatus(200);
            }

            if (esCancelacion(texto)) {
                const batch = batches.get(numero);
                if (!batch) {
                    await enviarWhatsApp(numero, "No hay ningun lote pendiente para cancelar.");
                    return res.sendStatus(200);
                }
                batch.canceled = true;
                batches.delete(numero);
                await enviarWhatsApp(numero, "Lote cancelado. Puedes volver a enviar todos los PDFs desde cero.");
                return res.sendStatus(200);
            }

            if (esConfirmacionFinal(texto)) {
                const batch = batches.get(numero);
                if (!batch || batch.files.length === 0) {
                    await enviarWhatsApp(numero, "Todavía no recibí PDFs para procesar. Envíame los documentos y luego escribe SON TODOS. Para borrar el lote escribe CANCELAR.");
                    return res.sendStatus(200);
                }
                if (batch.processing) {
                    await enviarWhatsApp(numero, "Ya estoy procesando ese lote. Te aviso cuando termine.");
                    return res.sendStatus(200);
                }

                const config = cargarConfig();
                const destinos = obtenerDestinatarios(config);
                if (!destinos.length) {
                    await enviarWhatsApp(numero, "Falta configurar destinatarios. Abre /config en el servidor, marca uno o varios numeros y vuelve a escribir SON TODOS.");
                    return res.sendStatus(200);
                }

                batch.processing = true;
                await enviarWhatsApp(numero, `Perfecto. Inicie el procesamiento de ${batch.files.length} PDF(s). Lo enviare a: ${destinos.map(mostrarNumero).join(", ")}.`);
                procesarLoteEnSegundoPlano(numero, batch);
                return res.sendStatus(200);
            }

            const batch = batches.get(numero);
            if (batch && batch.files.length > 0) {
                console.log(`Texto ignorado con lote pendiente de [${numero}]`);
                return res.sendStatus(200);
            }

            console.log(`Texto ignorado sin comando de [${numero}]`);
        }

        res.sendStatus(200);
    } catch (err) {
        console.error("Error general en webhook:", err.message);
        res.sendStatus(500);
    }
});

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verificado por Meta.");
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

if (process.env.NETLIFY) {
    const serverless = require("serverless-http");
    module.exports.handler = serverless(app);
} else {
    app.listen(PORT, async () => {
        console.log(`Servidor iniciado en el puerto ${PORT}`);
        console.log(`Panel de destinatarios: http://localhost:${PORT}/config`);
        console.log("Estado seguro:", JSON.stringify(resumenConfigSeguro()));

        if (!process.env.RENDER) {
            try {
                const { tunnelmole } = require("tunnelmole");
                const url = await tunnelmole({ port: PORT });
                console.log(`URL para Meta: ${url}/webhook`);
                console.log(`Panel web: ${url}/config`);
            } catch (error) {
                console.log("No se pudo levantar tunel local:", error.message);
            }
        }
    });
}
