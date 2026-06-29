#!/bin/bash
# Doble clic para abrir el sistema de ubicaciones.
cd "$(dirname "$0")"
echo "Actualizando catalogo desde la web…"
node scripts/sync.mjs || echo "(No se pudo sincronizar, abro con el ultimo catalogo guardado)"
echo "Abriendo el sistema…"
node app/server.mjs &
SERVER_PID=$!
sleep 1
open "http://localhost:4321"
echo ""
echo "Sistema abierto en http://localhost:4321"
echo "Para cerrarlo: cerra esta ventana."
wait $SERVER_PID
