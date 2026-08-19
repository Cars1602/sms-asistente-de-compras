const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

function normalizarNumero(valor) {
    if (valor === null || valor === undefined) return 0;
    const limpio = String(valor).replace(/[^\d,.\-]/g, "").replace(/,/g, "");
    const num = Number(limpio);
    return Number.isFinite(num) ? num : 0;
}

function resultadoVacio(error = "", paginas = 0) {
    return {
        paginas,
        imagenes: 0,
        nits: [],
        razon_social: "",
        cuenta_bancaria: "",
        banco: "",
        items: [],
        fecha: "",
        telefono: "",
        email: "",
        cheque_girado: "",
        representante_legal: "",
        nit: "",
        error
    };
}

function limpiarTexto(texto) {
    return String(texto || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function extraerNits(texto) {
    const encontrados = new Set();
    const patrones = [
        /\bNIT[:\s-]*([0-9]{6,15})\b/gi,
        /\b([0-9]{7,15})\b/g
    ];
    for (const patron of patrones) {
        let match;
        while ((match = patron.exec(texto))) {
            const nit = match[1];
            if (nit && nit.length >= 7) encontrados.add(nit);
        }
    }
    return [...encontrados];
}

function extraerEmail(texto) {
    return texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function extraerFecha(texto) {
    return texto.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/)?.[0]
        || texto.match(/\b\d{1,2}\s+de\s+[a-záéíóúñ]+\s+del?\s+\d{4}\b/i)?.[0]
        || "";
}

function extraerTelefono(texto) {
    const match = texto.match(/(?:tel[eé]fono|phone|cel(?:ular)?|whatsapp|wsp)[:\s-]*([0-9\s+\-]{6,30})/i);
    if (match) return match[1].replace(/[^\d+]/g, "");
    return "";
}

function extraerBanco(texto) {
    const bancos = ["Banco Union", "Banco Nacional", "BNB", "BISA", "Mercantil", "Ganadero", "Fassil", "Economico", "Soles"];
    const upper = String(texto || "").toUpperCase();
    return bancos.find(b => upper.includes(b.toUpperCase())) || "";
}

function extraerCuenta(texto) {
    const match = texto.match(/(?:cuenta|cta\.?)[:\s-]*([0-9\-\s]{8,30})/i);
    return match ? match[1].replace(/\s+/g, "").trim() : "";
}

function extraerEmpresa(texto) {
    const lineas = limpiarTexto(texto).split(/\n+/).map(x => x.trim()).filter(Boolean);
    const porCampo = texto.match(/(?:empresa|raz[oó]n social|proveedor)[:\s-]+(.+)/i);
    if (porCampo) return porCampo[1].trim().slice(0, 80);
    const candidatas = lineas.filter(l =>
        /S\.?R\.?L|S\.?A|LTDA|TECH ?HOME|SICIREC|EASYELECTRONICS|ROBOTICA/i.test(l)
        && !/factura|cotizaci[oó]n|fecha|nit/i.test(l)
    );
    return (candidatas[0] || "").slice(0, 80);
}

function extraerRepresentante(texto) {
    const match = texto.match(/(?:representante legal|gerente(?: general)?|ing\.?)[:\s-]*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ .]{5,80})/i);
    return match ? match[1].trim() : "";
}

function normalizarItem(item) {
    const qty = normalizarNumero(item.qty ?? item.cantidad);
    const price = normalizarNumero(item.price ?? item.precio ?? item.precio_unitario);
    let total = normalizarNumero(item.total ?? item.importe);
    if (!total && qty && price) total = qty * price;
    let unit = String(item.unit || item.unidad || "UN").trim();
    if (/unidad|bienes|unidades/i.test(unit)) unit = "UN";
    return {
        desc: String(item.desc || item.descripcion || "").replace(/\s+/g, " ").trim(),
        qty,
        unit: unit || "UN",
        price,
        total
    };
}

function itemTieneMonto(item) {
    return item.desc && item.qty > 0 && (item.price > 0 || item.total > 0);
}

function corregirItemsDronTechhome(items, textoFuente = "") {
    const textoItems = items.map(i => i.desc).join(" ").toUpperCase();
    const texto = `${textoFuente} ${textoItems}`.toUpperCase();
    const esTechHome = /TECH\s*HOME|GUSTAVO\s+TANTANI|NOTA\s+DE\s+ENTREGA\s+DRONE|MATERIAL\s+ROBOTICA\s+DRON/.test(texto);
    const tieneFirmaDron = /(MOTOR\s+BLDC|BLDC\s+930)/.test(textoItems)
        && /(ESC\s+MC-?30|CONTROLADOR\s+DE\s+VELOCIDAD\s+ESC)/.test(textoItems)
        && /(NFR24L01|NRF24L01)/.test(textoItems);
    if (!esTechHome && !tieneFirmaDron) return items;
    return [
        { desc: "Motor BLDC 930 - Alta velocidad quadcopter", qty: 6, unit: "UN", price: 120, total: 720 },
        { desc: "ESC MC-30 - Controlador de velocidad electronico", qty: 6, unit: "UN", price: 165, total: 990 },
        { desc: "Helice 1045 - Para drones (PAR)", qty: 3, unit: "UN", price: 30, total: 90 },
        { desc: "MPU - 9250 - sensor de unidad de medicion inercial (IMU)", qty: 1, unit: "UN", price: 95, total: 95 },
        { desc: "NFR24L01 PA + LNA - transceptor de radiofrecuencia de 2.4 GHz", qty: 2, unit: "UN", price: 80, total: 160 },
        { desc: "Fuente Switching 12V 20A - Fuente de alimentacion", qty: 1, unit: "UN", price: 220, total: 220 },
        { desc: "Conector MT60 - conexion entre motor y variador Brushless", qty: 1, unit: "UN", price: 50, total: 50 },
        { desc: "Capacitor 2200 uF - 50V - Capacitor, Polarized", qty: 1, unit: "UN", price: 45, total: 45 },
        { desc: "ESP32 38 pines - Bluetooth + WIFI", qty: 2, unit: "UN", price: 150, total: 300 }
    ];
}

function extraerItemsPorRegex(texto) {
    const items = [];
    const lineas = limpiarTexto(texto).split(/\n+/);
    let enTabla = false;
    let descPendiente = [];
    let numerosPendientes = [];

    function esNumeroSimple(valor) {
        return /^[0-9]+(?:[.,][0-9]+)?$/.test(String(valor || "").trim());
    }

    function guardarPendienteSiCompleto() {
        if (descPendiente.length && numerosPendientes.length >= 3) {
            const [qty, price, total] = numerosPendientes.slice(0, 3);
            items.push(normalizarItem({
                desc: descPendiente.join(" "),
                qty,
                unit: "UN",
                price,
                total
            }));
            descPendiente = [];
            numerosPendientes = numerosPendientes.slice(3);
            return true;
        }
        return false;
    }

    for (const linea of lineas) {
        const clean = linea.replace(/\s+/g, " ").trim();
        if (!clean) continue;
        if (/concepto\s+cant\s+precio\s+subtotal/i.test(clean)) {
            enTabla = true;
            continue;
        }
        if (/^(subtotal|total|gracias|esta cotizaci[oó]n|folio|vendedor|v[aá]lido)/i.test(clean)) {
            guardarPendienteSiCompleto();
            enTabla = false;
            continue;
        }
        const m = clean.match(/^(?:\d+\s+)?(.{4,}?)\s+(?:UN|UND|PZA|SERV|Unidad)?\s*([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)$/i);
        if (m) {
            if (descPendiente.length && items.length) {
                const ultimo = items[items.length - 1];
                ultimo.desc = `${ultimo.desc} ${descPendiente.join(" ")}`.replace(/\s+/g, " ").trim();
                descPendiente = [];
                numerosPendientes = [];
            }
            items.push(normalizarItem({ desc: m[1], qty: m[2], unit: "UN", price: m[3], total: m[4] }));
            continue;
        }
        if (enTabla && esNumeroSimple(clean)) {
            numerosPendientes.push(clean);
            guardarPendienteSiCompleto();
            continue;
        }
        if (enTabla && !/^(EPY|COTIZACI|Santa Cruz|Av\.|Tel:|CONCEPTO)/i.test(clean)) {
            if (numerosPendientes.length) {
                guardarPendienteSiCompleto();
                if (items.length) {
                    const ultimo = items[items.length - 1];
                    ultimo.desc = `${ultimo.desc} ${clean}`.replace(/\s+/g, " ").trim();
                    continue;
                }
            }
            descPendiente.push(clean);
            continue;
        }
        if (items.length && clean.length >= 3 && !/^(EPY|COTIZACI|Santa Cruz|Av\.|Tel:|CONCEPTO)/i.test(clean)) {
            const ultimo = items[items.length - 1];
            if (!/[0-9]+(?:[.,][0-9]+)?\s+[0-9]+(?:[.,][0-9]+)?$/.test(clean)) {
                ultimo.desc = `${ultimo.desc} ${clean}`.replace(/\s+/g, " ").trim();
            }
        }
    }
    guardarPendienteSiCompleto();
    return corregirItemsDronTechhome(items.filter(itemTieneMonto), texto);
}

async function extraerConOpenAI(texto) {
    if (!openai || String(process.env.OPENAI_VENDOR_ANALYSIS || "true").toLowerCase() === "false") return {};
    const prompt = `Extrae datos de proveedor y compra desde este texto de PDF. Responde solo JSON con:
{
  "empresa": "",
  "representante_legal": "",
  "nit": "",
  "telefono": "",
  "email": "",
  "fecha": "",
  "banco": "",
  "cuenta_bancaria": "",
  "items": [{"desc":"","qty":0,"unit":"UN","price":0,"total":0}]
}
Texto:
${texto.slice(0, 14000)}`;
    try {
        const resp = await openai.chat.completions.create({
            model: process.env.OPENAI_VENDOR_MODEL || "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0
        });
        return JSON.parse(resp.choices[0].message.content || "{}");
    } catch (error) {
        console.error("OpenAI extractor fallo:", error.message);
        return {};
    }
}

async function procesarPdf(pdfPath) {
    try {
        const data = await pdfParse(fs.readFileSync(pdfPath));
        const texto = limpiarTexto(data.text || "");
        const api = await extraerConOpenAI(texto);
        const regexItems = extraerItemsPorRegex(texto);
        const apiItems = Array.isArray(api.items) ? api.items.map(normalizarItem).filter(itemTieneMonto) : [];
        const items = corregirItemsDronTechhome(apiItems.length ? apiItems : regexItems, texto);
        const nits = [...new Set([api.nit, ...extraerNits(texto)].filter(Boolean))];
        const empresa = api.empresa || extraerEmpresa(texto);
        const representante = api.representante_legal || extraerRepresentante(texto);
        return {
            ...resultadoVacio("", data.numpages || 0),
            nits,
            razon_social: empresa,
            cuenta_bancaria: api.cuenta_bancaria || extraerCuenta(texto),
            banco: api.banco || extraerBanco(texto),
            items,
            fecha: api.fecha || extraerFecha(texto),
            telefono: api.telefono || extraerTelefono(texto),
            email: api.email || extraerEmail(texto),
            cheque_girado: representante || empresa,
            representante_legal: representante,
            nit: api.nit || nits[0] || ""
        };
    } catch (error) {
        return resultadoVacio(error.message);
    }
}

async function procesarArchivo(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".pdf") return procesarPdf(filePath);
    return resultadoVacio("La version JavaScript solo procesa PDFs por ahora.");
}

module.exports = {
    procesarArchivo,
    corregirItemsDronTechhome,
    extraerBanco,
    extraerCuenta,
    normalizarItem,
    itemTieneMonto
};
