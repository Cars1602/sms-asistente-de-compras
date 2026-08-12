const { extraerBanco, extraerCuenta } = require("./extractor");

function esRazonSocialGenerica(valor) {
    const texto = String(valor || "").trim().toUpperCase();
    if (!texto) return true;
    return [
        "UNIVERSIDAD PRIVADA DOMINGO SAVIO",
        "DOMINGO SAVIO",
        "CLIENTE",
        "PROVEEDOR",
        "SIN DATOS"
    ].some(x => texto === x || texto.includes(x));
}

function unicos(lista) {
    return [...new Set(lista.filter(Boolean))];
}

function consolidarResultados(resultados) {
    const conItems = resultados.filter(r => Array.isArray(r.items) && r.items.length && !r.error);
    const sinItems = resultados.filter(r => (!Array.isArray(r.items) || !r.items.length) && !r.error);
    if (!conItems.length) return resultados;

    const globalNits = unicos(sinItems.flatMap(r => r.nits || []));
    const globalCuentas = unicos(sinItems.map(r => extraerCuenta(r.cuenta_bancaria) || r.cuenta_bancaria));
    const globalBancos = unicos(sinItems.map(r => r.banco || extraerBanco(r.cuenta_bancaria)));
    const globalEmails = unicos(sinItems.map(r => r.email));
    const razonesConCuenta = sinItems
        .filter(r => r.razon_social && r.cuenta_bancaria && !esRazonSocialGenerica(r.razon_social))
        .map(r => r.razon_social);
    const razonesSinCuenta = sinItems
        .filter(r => r.razon_social && !r.cuenta_bancaria && !esRazonSocialGenerica(r.razon_social))
        .map(r => r.razon_social);
    const globalRazones = unicos([...razonesConCuenta, ...razonesSinCuenta]);

    return resultados.map(r => {
        if (!Array.isArray(r.items) || !r.items.length || r.error) return r;
        const rc = { ...r };
        if ((!rc.razon_social || esRazonSocialGenerica(rc.razon_social)) && globalRazones.length) {
            rc.razon_social = globalRazones[0];
        }
        if ((!rc.nits || !rc.nits.length) && globalNits.length) rc.nits = globalNits;
        if (!rc.nit && rc.nits?.length) rc.nit = rc.nits[0];
        if (!rc.cuenta_bancaria && globalCuentas.length) {
            rc.cuenta_bancaria = globalCuentas[0];
            rc.banco = globalBancos[0] || rc.banco || "";
        }
        if (!rc.banco) rc.banco = extraerBanco(rc.cuenta_bancaria) || globalBancos[0] || "";
        if (!rc.email && globalEmails.length) rc.email = globalEmails[0];
        if (!rc.cheque_girado) rc.cheque_girado = rc.representante_legal || rc.razon_social || "";
        if (!rc.representante_legal) rc.representante_legal = rc.cheque_girado || "";
        return rc;
    });
}

module.exports = { consolidarResultados };
