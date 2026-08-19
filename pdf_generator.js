const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { corregirItemsDronTechhome, normalizarItem, itemTieneMonto } = require("./extractor");

function fmtMoney(n) {
    return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n) {
    const num = Number(n || 0);
    return Number.isInteger(num) ? String(num) : String(num.toFixed(2)).replace(/\.?0+$/, "");
}

function numeroALetras(num) {
    const unidades = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
    const especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
    const decenas = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
    const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
    function menorMil(n) {
        if (n === 0) return "";
        if (n === 100) return "CIEN";
        if (n < 10) return unidades[n];
        if (n < 20) return especiales[n - 10];
        if (n < 30) return n === 20 ? "VEINTE" : `VEINTI${unidades[n - 20]}`;
        if (n < 100) return decenas[Math.floor(n / 10)] + (n % 10 ? ` Y ${unidades[n % 10]}` : "");
        return centenas[Math.floor(n / 100)] + (n % 100 ? ` ${menorMil(n % 100)}` : "");
    }
    const entero = Math.floor(Number(num || 0));
    const centavos = Math.round((Number(num || 0) - entero) * 100);
    let texto = "";
    if (entero >= 1000000) {
        const millones = Math.floor(entero / 1000000);
        texto += millones === 1 ? "UN MILLON" : `${menorMil(millones)} MILLONES`;
        if (entero % 1000000) texto += ` ${numeroALetras(entero % 1000000).replace(/\s+\d{2}\/100$/, "")}`;
    } else if (entero >= 1000) {
        const miles = Math.floor(entero / 1000);
        texto += miles === 1 ? "MIL" : `${menorMil(miles)} MIL`;
        if (entero % 1000) texto += ` ${menorMil(entero % 1000)}`;
    } else {
        texto = menorMil(entero) || "CERO";
    }
    return `${texto} ${String(centavos).padStart(2, "0")}/100`;
}

function drawCell(doc, x, y, w, h, text = "", opts = {}) {
    const fill = opts.fill;
    if (fill) doc.rect(x, y, w, h).fill(fill).fillColor("black");
    doc.rect(x, y, w, h).stroke("black");
    if (text !== null && text !== undefined && text !== "") {
        doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(opts.size || 6.4)
            .fillColor("black")
            .text(String(text), x + (opts.pad ?? 4), y + (opts.valignTop ? 3 : Math.max(2, (h - (opts.size || 6.4)) / 2 - 1)), {
                width: w - 2 * (opts.pad ?? 4),
                height: h - 2,
                align: opts.align || "left"
            });
    }
}

function checkbox(doc, x, y, checked) {
    doc.rect(x, y, 9, 9).stroke("black");
    if (checked) doc.font("Helvetica-Bold").fontSize(8).text("X", x + 1.8, y + 0.4, { width: 8, align: "center" });
}

function drawItemsHeader(doc, xs, col, y, blue) {
    drawCell(doc, xs[0], y, col[0], 33, "CANTIDAD DE\nITEM", { fill: blue, bold: true, align: "center", size: 5.7 });
    drawCell(doc, xs[1], y, col[1], 33, "DESCRIPCION", { fill: blue, bold: true, align: "center" });
    drawCell(doc, xs[2], y, col[2], 33, "UNIDADES", { fill: blue, bold: true, align: "center" });
    drawCell(doc, xs[3], y, col[3], 33, "CANTIDAD", { fill: blue, bold: true, align: "center" });
    drawCell(doc, xs[4], y, col[4], 33, "PRECIO\nUNITARIO", { fill: blue, bold: true, align: "center" });
    drawCell(doc, xs[5], y, col[5] + col[6], 16, "Importe", { fill: blue, bold: true, align: "center" });
    drawCell(doc, xs[5], y + 16, col[5], 17, "$us.", { fill: blue, bold: true, align: "center" });
    drawCell(doc, xs[6], y + 16, col[6], 17, "Bs.", { fill: blue, bold: true, align: "center" });
    return y + 33;
}

function generarReportePdf(resultados, outputPath, tipoCambio = 6.97) {
    const conItems = resultados.filter(r => Array.isArray(r.items) && r.items.length && !r.error);
    const doc = new PDFDocument({ size: "LETTER", margin: 0 });
    const stream = fs.createWriteStream(outputPath);
    const done = new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
        doc.on("error", reject);
    });
    doc.pipe(stream);

    if (!conItems.length) {
        doc.fontSize(16).text("Reporte Consolidado (Sin Items de Compra Detectados)", 50, 60);
        doc.end();
        return done;
    }

    const startX = 50;
    const formW = 504;
    const blue = "#D6E4F0";
    const logoPath = path.join(__dirname, "img", "image.png");

    conItems.forEach((datos, idx) => {
        if (idx > 0) doc.addPage();
        let y = 54;

        drawCell(doc, startX, y, 91, 60, "");
        if (fs.existsSync(logoPath)) doc.image(logoPath, startX + 22, y + 7, { width: 50 });
        drawCell(doc, startX + 91, y, 165, 60, "ORDEN DE COMPRA\n\nDEPARTAMENTO DE CONTABILIDAD Y FINANZAS SCZ", { bold: true, size: 10.5, align: "center", pad: 6 });
        const rightX = startX + 256;
        drawCell(doc, rightX, y, 86, 9, "VERSION", { bold: true, align: "center" });
        drawCell(doc, rightX + 86, y, 162, 9, "CODIGO", { bold: true, align: "center" });
        drawCell(doc, rightX, y + 9, 86, 9, "2026", { align: "center" });
        drawCell(doc, rightX + 86, y + 9, 162, 9, "0", { align: "center" });
        drawCell(doc, rightX, y + 18, 86, 32, "VIGENCIA", { bold: true, align: "center" });
        drawCell(doc, rightX + 86, y + 18, 162, 32, "Nro DE PAGINAS", { bold: true, align: "center" });
        drawCell(doc, rightX, y + 50, 86, 10, "1/0/1900", { align: "center" });
        drawCell(doc, rightX + 86, y + 50, 162, 10, "1", { align: "center" });
        y += 60;

        const prov = datos.razon_social || "";
        const telf = datos.telefono || "";
        const email = datos.email || "";
        const fecha = datos.fecha || new Date().toLocaleDateString("es-BO");
        const nit = datos.nit || datos.nits?.[0] || "";
        const cheque = datos.cheque_girado || datos.representante_legal || prov;
        let items = (datos.items || []).map(normalizarItem).filter(itemTieneMonto);
        items = corregirItemsDronTechhome(items);

        drawCell(doc, startX, y, formW, 18, "DATOS PROVEEDOR", { fill: blue, bold: true, align: "center" });
        y += 18;
        drawCell(doc, startX, y, 91, 12, "EMPRESA", { bold: true });
        drawCell(doc, startX + 91, y, 154, 12, prov);
        drawCell(doc, startX + 245, y, 50, 12, "TELEFONO", { bold: true });
        drawCell(doc, startX + 295, y, 209, 12, telf);
        y += 12;
        drawCell(doc, startX, y, 91, 12, "REPRESENTANTE LEGAL", { bold: true, size: 6 });
        drawCell(doc, startX + 91, y, 154, 12, cheque);
        drawCell(doc, startX + 245, y, 50, 12, "E-MAIL", { bold: true });
        drawCell(doc, startX + 295, y, 209, 12, email);
        y += 12;
        drawCell(doc, startX, y, 91, 12, "NIT", { bold: true });
        drawCell(doc, startX + 91, y, 154, 12, nit);
        drawCell(doc, startX + 245, y, 50, 12, "FECHA", { bold: true });
        drawCell(doc, startX + 295, y, 209, 12, fecha);
        y += 12;
        drawCell(doc, startX, y, formW, 22, "");
        doc.font("Helvetica-Bold").fontSize(6.4).text("TIPO DE COMPRA", startX + 5, y + 8);
        doc.font("Helvetica").fontSize(6.4).text("MATERIALES O\nINSUMOS", startX + 96, y + 4);
        checkbox(doc, startX + 165, y + 6, true);
        doc.text("SERVICIOS", startX + 230, y + 8);
        checkbox(doc, startX + 322, y + 6, false);
        doc.text("ACTIVO FIJO", startX + 375, y + 8);
        checkbox(doc, startX + 465, y + 6, false);
        y += 22;

        const condiciones = [
            nit ? `NIT: ${nit}` : "",
            datos.banco ? `Banco: ${datos.banco}` : "",
            datos.cuenta_bancaria ? `Cuenta: ${datos.cuenta_bancaria}` : ""
        ].filter(Boolean).join(" | ");
        drawCell(doc, startX, y, formW, 11, "CONDICIONES DE PAGO", { fill: blue, bold: true, align: "center" });
        y += 11;
        drawCell(doc, startX, y, formW, 20, condiciones);
        y += 20;
        drawCell(doc, startX, y, formW, 25, "");
        doc.font("Helvetica-Bold").fontSize(6.4).text("Factura:", startX + 8, y + 9);
        doc.font("Helvetica").text("Si", startX + 55, y + 9);
        checkbox(doc, startX + 95, y + 8, Boolean(nit));
        doc.text("No", startX + 125, y + 9);
        checkbox(doc, startX + 160, y + 8, !nit);
        doc.text("OBS.: SI NO FACTURA, LA ORDEN DEBE APLICAR LA RESPECTIVA RETENCION.", startX + 205, y + 9);
        y += 25;
        drawCell(doc, startX, y, 404, 10, "");
        drawCell(doc, startX + 404, y, 50, 10, "T.C.", { bold: true, align: "right" });
        drawCell(doc, startX + 454, y, 50, 10, fmtMoney(tipoCambio), { align: "center" });
        y += 10;

        const col = [46, 157, 46, 46, 48, 79, 82];
        const xs = col.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [startX]);
        y = drawItemsHeader(doc, xs, col, y, blue);

        let totalBs = 0;
        let totalSus = 0;
        const numRows = Math.max(8, items.length);
        for (let i = 0; i < numRows; i++) {
            const it = items[i];
            const h = it && it.desc.length > 82 ? 18 : it && it.desc.length > 48 ? 13 : 9;
            if (it && y + h + 160 > 760) {
                doc.addPage();
                y = 54;
                drawCell(doc, startX, y, formW, 16, "ORDEN DE COMPRA - CONTINUACION DE ITEMS", { bold: true, align: "center" });
                y += 16;
                y = drawItemsHeader(doc, xs, col, y, blue);
            }
            if (it) {
                const totBs = Number(it.total || it.qty * it.price || 0);
                const totSus = totBs / tipoCambio;
                totalBs += totBs;
                totalSus += totSus;
                drawCell(doc, xs[0], y, col[0], h, i + 1, { align: "center" });
                drawCell(doc, xs[1], y, col[1], h, it.desc, { size: items.length > 18 ? 5.2 : 5.7, valignTop: true });
                drawCell(doc, xs[2], y, col[2], h, it.unit || "UN", { align: "center" });
                drawCell(doc, xs[3], y, col[3], h, fmtQty(it.qty), { align: "center" });
                drawCell(doc, xs[4], y, col[4], h, fmtMoney(it.price), { align: "right" });
                drawCell(doc, xs[5], y, col[5], h, fmtMoney(totSus), { align: "right" });
                drawCell(doc, xs[6], y, col[6], h, fmtMoney(totBs), { align: "right" });
            } else {
                col.forEach((w, ci) => drawCell(doc, xs[ci], y, w, h, ci === 2 ? "UN" : ci >= 5 ? "0.00" : "", { align: ci >= 2 ? "center" : "left" }));
            }
            y += h;
        }

        const sumaCant = items.reduce((s, it) => s + Number(it.qty || 0), 0);
        if (y + 155 > 760) {
            doc.addPage();
            y = 54;
            drawCell(doc, startX, y, formW, 16, "ORDEN DE COMPRA - TOTALES Y FIRMAS", { bold: true, align: "center" });
            y += 16;
        }
        drawCell(doc, startX, y, col[0] + col[1] + col[2], 13, "SUB TOTALES", { bold: true });
        drawCell(doc, xs[3], y, col[3], 13, fmtQty(sumaCant), { bold: true, align: "center" });
        drawCell(doc, xs[4], y, col[4], 13, "");
        drawCell(doc, xs[5], y, col[5], 13, fmtMoney(totalSus), { bold: true, align: "right" });
        drawCell(doc, xs[6], y, col[6], 13, fmtMoney(totalBs), { bold: true, align: "right" });
        y += 13;
        drawCell(doc, startX, y, formW - col[6], 13, "TOTALES BOLIVIANOS", { bold: true });
        drawCell(doc, xs[6], y, col[6], 13, fmtMoney(totalBs), { bold: true, align: "right" });
        y += 13;
        const ret = nit ? 0 : totalBs * 0.16;
        drawCell(doc, startX, y, formW - col[6], 11, "RETENCIONES 16%", { bold: true, align: "right" });
        drawCell(doc, xs[6], y, col[6], 11, ret ? fmtMoney(ret) : "", { bold: true, align: "right" });
        y += 11;
        drawCell(doc, startX, y, formW - col[6], 11, "TOTALES BOLIVIANOS C/ RETENCION", { bold: true });
        drawCell(doc, xs[6], y, col[6], 11, ret ? fmtMoney(totalBs - ret) : "", { bold: true, align: "right" });
        y += 11;

        drawCell(doc, startX, y, 39, 11, "SON:", { bold: true });
        drawCell(doc, startX + 39, y, formW - 39, 11, `${numeroALetras(totalBs)} BOLIVIANOS`, { bold: true });
        y += 11;

        const sigH = 82;
        drawCell(doc, startX, y, 168, sigH, "ELABORADO POR", { bold: true, valignTop: false, pad: 8 });
        drawCell(doc, startX + 168, y, 168, sigH, "REVISADOR POR", { bold: true, pad: 8 });
        drawCell(doc, startX + 336, y, 168, sigH, "AUTORIZADO POR", { bold: true, pad: 8 });
        y += sigH;
        drawCell(doc, startX, y, 168, 42, "Registro Contable POA:\n65200002 - Material e Insumos de laboratorio", { bold: true, valignTop: true, size: 6.2 });
        drawCell(doc, startX + 168, y, 168, 42, "Centro de costo POA:\n1160030201 - ING DE SISTE P", { bold: true, valignTop: true, size: 6.2 });
        drawCell(doc, startX + 336, y, 168, 42, "Nro Actividad POA: 2,026,000,487 Materiales e implementos para pruebas experimentales", { bold: true, valignTop: true, size: 6.2 });
    });

    doc.end();
    return done;
}

module.exports = { generarReportePdf };
