# WhatsApp Server

Esta carpeta contiene todo lo necesario para ejecutar el bot:

- `server.js`: webhook de WhatsApp.
- `processor.js`, `extractor.js`, `consolidator.js`, `pdf_generator.js`: procesamiento y generacion de la orden en JavaScript.
- `img/`: logo usado en el PDF.
- `package.json`: librerias Node.

No subas `.env`, `.venv`, `node_modules`, `temp`, `build` ni `dist`.

## Variables de entorno

Configura estas variables en el panel del servidor:

```text
OPENAI_API_KEY=tu_api_key_de_openai
WHATSAPP_TOKEN=token_de_meta_whatsapp
PHONE_NUMBER_ID=1224186667440867
VERIFY_TOKEN=un_texto_secreto_igual_al_de_meta
DEFAULT_RECIPIENTS=Compras:69523101
DEFAULT_ACTIVE_RECIPIENT=69523101
OPENAI_VENDOR_ANALYSIS=true
OPENAI_VENDOR_MODEL=gpt-4o-mini
PROCESS_TIMEOUT_MS=240000
```

## Netlify

Sube solo esta carpeta `whatsapp_server`.

Build settings:

```text
Base directory: whatsapp_server
Build command: npm install
Publish directory: public
Functions directory: .
```

Variables de entorno en Netlify:

```text
OPENAI_API_KEY=tu_api_key_de_openai
WHATSAPP_TOKEN=token_de_meta_whatsapp
PHONE_NUMBER_ID=1224186667440867
VERIFY_TOKEN=un_texto_secreto_igual_al_de_meta
DEFAULT_RECIPIENTS=Compras:69523101
DEFAULT_ACTIVE_RECIPIENT=69523101
OPENAI_VENDOR_ANALYSIS=true
OPENAI_VENDOR_MODEL=gpt-4o-mini
PROCESS_TIMEOUT_MS=240000
```

En Netlify, los numeros agregados desde `/config` pueden ser temporales porque las funciones no tienen disco permanente. Para numeros fijos usa `DEFAULT_RECIPIENTS` y `DEFAULT_ACTIVE_RECIPIENT`.

Webhook en Meta:

```text
https://TU_SITIO_NETLIFY.netlify.app/webhook
```

Nota: Netlify Functions tiene limites de tiempo y almacenamiento temporal. Para lotes grandes de PDFs, Render sigue siendo mas estable.

## Render

Si usas Render, usa `whatsapp_server` como carpeta raiz del servicio.

Build command:

```text
npm install
```

Start command:

```text
node server.js
```

Webhook en Meta:

```text
https://TU_URL_DE_RENDER/webhook
```
