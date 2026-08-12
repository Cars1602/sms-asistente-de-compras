const fs = require("fs");
const path = require("path");
const { procesarArchivo } = require("./extractor");
const { consolidarResultados } = require("./consolidator");
const { generarReportePdf } = require("./pdf_generator");

async function generarOrdenDesdeCarpeta(folderPath, outputPath, opciones = {}) {
    const tipoCambio = Number(opciones.tipoCambio || 6.97);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        throw new Error(`La carpeta '${folderPath}' no existe.`);
    }
    const outputName = path.basename(outputPath);
    const archivos = fs.readdirSync(folderPath)
        .map(nombre => path.join(folderPath, nombre))
        .filter(file => fs.statSync(file).isFile())
        .filter(file => [".pdf"].includes(path.extname(file).toLowerCase()))
        .filter(file => path.basename(file) !== outputName)
        .sort();

    if (!archivos.length) {
        throw new Error(`No se encontraron PDFs en '${folderPath}'.`);
    }

    console.log(`[INFO] Procesando ${archivos.length} PDF(s) con JavaScript.`);
    const resultados = [];
    for (let i = 0; i < archivos.length; i++) {
        const file = archivos[i];
        const t0 = Date.now();
        console.log(`[${i + 1}/${archivos.length}] Procesando: ${path.basename(file)}`);
        const res = await procesarArchivo(file);
        resultados.push({
            archivo: path.basename(file),
            ruta: path.resolve(file),
            paginas: res.paginas || 0,
            imagenes: res.imagenes || 0,
            nits: res.nits || [],
            razon_social: res.razon_social || "",
            cuenta_bancaria: res.cuenta_bancaria || "",
            banco: res.banco || "",
            items: res.items || [],
            fecha: res.fecha || "",
            telefono: res.telefono || "",
            email: res.email || "",
            cheque_girado: res.cheque_girado || "",
            representante_legal: res.representante_legal || res.cheque_girado || "",
            nit: res.nit || "",
            error: res.error || "",
            tiempo_seg: Math.round((Date.now() - t0) / 10) / 100
        });
    }

    const consolidados = consolidarResultados(resultados);
    await generarReportePdf(consolidados, outputPath, tipoCambio);
    console.log(`[OK] Reporte guardado en: ${path.resolve(outputPath)}`);
    return consolidados;
}

function leerArg(nombre, def = "") {
    const idx = process.argv.indexOf(nombre);
    return idx >= 0 ? process.argv[idx + 1] || def : def;
}

if (require.main === module) {
    const folder = leerArg("--folder");
    const output = leerArg("--output", path.join(folder || ".", "orden_compra.pdf"));
    const tipoCambio = Number(leerArg("--tipo-cambio", "6.97"));
    generarOrdenDesdeCarpeta(folder, output, { tipoCambio })
        .catch(error => {
            console.error(error.stack || error.message);
            process.exit(1);
        });
}

module.exports = { generarOrdenDesdeCarpeta };
