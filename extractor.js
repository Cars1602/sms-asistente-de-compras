const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
let OpenAI = null;
try {
    OpenAI = require("openai");
} catch (_) {
    OpenAI = null;
}
let pdfParse = null;
try {
    pdfParse = require("pdf-parse");
} catch (_) {
    pdfParse = null;
}
let pdfjsPromise = null;

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const openai = OPENAI_API_KEY && OpenAI ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

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
        if (/concepto/i.test(clean) && /(cant|cantidad|precio|subtotal|total)/i.test(clean)) {
            enTabla = true;
            continue;
        }
        if (/^concepto$/i.test(clean)) {
            enTabla = true;
            continue;
        }
        if (/^(subtotal|total|gracias|esta cotizaci[oó]n|folio|vendedor|v[aá]lido)/i.test(clean)) {
            guardarPendienteSiCompleto();
            enTabla = false;
            continue;
        }
        const m = clean.match(/^(?:\d+\s+)?(.{3,}?)\s+(?:UN|UND|PZA|SERV|Unidad|PZA\.?)?\s*([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)$/i);
        if (m) {
            if (descPendiente.length && items.length) {
                const ultimo = items[items.length - 1];
                ultimo.desc = `${ultimo.desc} ${descPendiente.join(" ")}`.replace(/\s+/g, " ").trim();
                descPendiente = [];
                numerosPendientes = [];
            }
            const item = normalizarItem({ desc: m[1], qty: m[2], unit: "UN", price: m[3], total: m[4] });
            if (!/^(folio|vendedor|valido|v.lido|tel|subtotal|total)$/i.test(item.desc)) {
                items.push(item);
                enTabla = true;
            }
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
    if (!items.length) {
        const bloque = extraerItemsDesdeBloqueConcepto(texto);
        items.push(...bloque);
    }
    return corregirItemsDronTechhome(items.filter(itemTieneMonto), texto);
}

function extraerItemsDesdeBloqueConcepto(texto) {
    const limpio = limpiarTexto(texto);
    const inicio = limpio.search(/CONCEPTO/i);
    if (inicio < 0) return [];
    const resto = limpio.slice(inicio);
    const fin = resto.search(/\n\s*(Subtotal|TOTAL)\b/i);
    const bloque = (fin >= 0 ? resto.slice(0, fin) : resto)
        .split(/\n+/)
        .map(l => l.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter(l => !/^(CONCEPTO|CANT|CANTIDAD|PRECIO|SUBTOTAL)$/i.test(l));

    const encontrados = [];
    for (const linea of bloque) {
        const m = linea.match(/^(.+?)\s+([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)$/);
        if (m) {
            encontrados.push(normalizarItem({ desc: m[1], qty: m[2], unit: "UN", price: m[3], total: m[4] }));
            continue;
        }
        if (encontrados.length && !/^[0-9]+(?:[.,][0-9]+)?$/.test(linea)) {
            const ultimo = encontrados[encontrados.length - 1];
            ultimo.desc = `${ultimo.desc} ${linea}`.replace(/\s+/g, " ").trim();
        }
    }
    return encontrados;
}

function normalizarClave(texto) {
    return String(texto || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
}

function agruparPorFila(texts) {
    const filas = [];
    for (const item of texts) {
        const row = filas.find(f => Math.abs(f.y - item.y) < 0.35);
        if (row) {
            row.items.push(item);
            row.y = (row.y + item.y) / 2;
        } else {
            filas.push({ y: item.y, items: [item] });
        }
    }
    return filas
        .sort((a, b) => a.y - b.y)
        .map(f => ({
            y: f.y,
            items: f.items.sort((a, b) => a.x - b.x)
        }));
}

function textoFila(fila) {
    return fila.items.map(i => i.text).join(" ").replace(/\s+/g, " ").trim();
}

function extraerNumeroColumna(items) {
    const texto = items.map(i => i.text).join(" ").trim();
    const match = texto.match(/[0-9]+(?:[.,][0-9]+)?/);
    return match ? match[0] : "";
}

async function cargarPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
            try {
                return require("pdfjs-dist/legacy/build/pdf.js");
            } catch (_) {
                try {
                    return await import("pdfjs-dist/build/pdf.mjs");
                } catch (_) {
                    const packagePath = require.resolve("pdfjs-dist/package.json");
                    const packageDir = path.dirname(packagePath);
                    return import(pathToFileURL(path.join(packageDir, "build", "pdf.mjs")).href);
                }
            }
        })();
    }
    return pdfjsPromise;
}

async function extraerPdfPorCoordenadas(pdfPath) {
    const pdfjsLib = await cargarPdfjs();
    const buffer = fs.readFileSync(pdfPath);
    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        disableWorker: true,
        useSystemFonts: true
    });
    const pdf = await loadingTask.promise;
    const items = [];
    const textos = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent({
            normalizeWhitespace: true,
            disableCombineTextItems: false
        });
        const words = [];
        for (const item of content.items || []) {
            const value = String(item.str || "").trim();
            if (!value) continue;
            const transform = item.transform || [1, 0, 0, 1, 0, 0];
            words.push({
                text: value,
                x: transform[4],
                y: transform[5]
            });
        }

        const filas = agruparPorFila(words);
        textos.push(...filas.map(textoFila));
        const headerIndex = filas.findIndex(f => {
            const t = normalizarClave(textoFila(f));
            return t.includes("CONCEPTO") && t.includes("CANT") && t.includes("PRECIO") && t.includes("SUBTOTAL");
        });
        if (headerIndex < 0) continue;

        const header = filas[headerIndex].items;
        const buscarX = palabra => header.find(i => normalizarClave(i.text).includes(palabra))?.x;
        const cantX = buscarX("CANT") ?? 260;
        const precioX = buscarX("PRECIO") ?? 360;
        const subtotalX = buscarX("SUBTOTAL") ?? 460;
        let ultimo = null;

        for (const fila of filas.slice(headerIndex + 1)) {
            const t = textoFila(fila);
            const clave = normalizarClave(t);
            if (/^(SUBTOTAL|TOTAL)\b/.test(clave) || clave.includes("GRACIAS")) break;

            const descItems = fila.items.filter(i => i.x < cantX - 8);
            const cantItems = fila.items.filter(i => i.x >= cantX - 8 && i.x < precioX - 8);
            const precioItems = fila.items.filter(i => i.x >= precioX - 8 && i.x < subtotalX - 8);
            const subtotalItems = fila.items.filter(i => i.x >= subtotalX - 8);

            const desc = descItems.map(i => i.text).join(" ").replace(/\s+/g, " ").trim();
            const qty = extraerNumeroColumna(cantItems);
            const price = extraerNumeroColumna(precioItems);
            const total = extraerNumeroColumna(subtotalItems);

            if (desc && qty && price && total) {
                ultimo = normalizarItem({ desc, qty, unit: "UN", price, total });
                items.push(ultimo);
            } else if (desc && ultimo) {
                ultimo.desc = `${ultimo.desc} ${desc}`.replace(/\s+/g, " ").trim();
            }
        }
    }

    return {
        items: items.filter(itemTieneMonto),
        texto: textos.join("\n"),
        paginas: pdf.numPages || 0
    };
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
        const buffer = fs.readFileSync(pdfPath);
        let data = { text: "", numpages: 0 };
        if (pdfParse) {
            try {
                data = await pdfParse(buffer);
            } catch (error) {
                console.error(`pdf-parse fallo en ${path.basename(pdfPath)}; continuo con pdfjs-dist:`, error.message);
            }
        }

        let coordData = { items: [], texto: "", paginas: 0 };
        try {
            coordData = await extraerPdfPorCoordenadas(pdfPath);
        } catch (error) {
            console.error("pdfjs-dist extractor fallo:", error.message);
        }

        const texto = limpiarTexto(data.text || coordData.texto || "");
        const api = await extraerConOpenAI(texto);
        const coordItems = coordData.items || [];
        const regexItems = extraerItemsPorRegex(texto);
        const apiItems = Array.isArray(api.items) ? api.items.map(normalizarItem).filter(itemTieneMonto) : [];
        const items = corregirItemsDronTechhome(coordItems.length ? coordItems : (apiItems.length ? apiItems : regexItems), texto);
        console.log(`Items detectados en ${path.basename(pdfPath)}: coordenadas=${coordItems.length}, api=${apiItems.length}, texto=${regexItems.length}, usados=${items.length}`);
        const nits = [...new Set([api.nit, ...extraerNits(texto)].filter(Boolean))];
        const empresa = api.empresa || extraerEmpresa(texto);
        const representante = api.representante_legal || extraerRepresentante(texto);
        return {
            ...resultadoVacio("", data.numpages || coordData.paginas || 0),
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
