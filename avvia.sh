#!/bin/bash
echo ""
echo " ================================================"
echo "  SBR Designer -- Avvio in corso..."
echo " ================================================"
echo ""

# Verifica npm
if ! command -v npm &>/dev/null; then
    echo " ERRORE: npm non trovato."
    echo " Installa Node.js da https://nodejs.org"
    exit 1
fi

# Installa dipendenze se mancano
if [ ! -d "node_modules" ]; then
    echo " Prima installazione dipendenze..."
    npm install
fi

# Avvia Vite in background
npm run dev &
SERVER_PID=$!

# Attendi che il server sia pronto
echo " Attendo che il server sia pronto..."
for i in {1..15}; do
    sleep 1
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        break
    fi
done

# Apri browser
echo " Apertura browser..."
if command -v open &>/dev/null; then
    open http://localhost:5173          # macOS
elif command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:5173      # Linux
fi

echo ""
echo " App aperta su: http://localhost:5173"
echo " Premi Ctrl+C per fermare il server."
echo ""

wait $SERVER_PID
