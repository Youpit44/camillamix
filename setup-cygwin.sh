#!/usr/bin/env bash
# Script minimal pour config Python sans Rust
set -euo pipefail
PYVENV=".venv"
log(){ printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }

log "Création venv: $PYVENV"
python3 -m venv "$PYVENV"
# activer venv pour la session actuelle
# sous Cygwin/Git-Bash:
source "$PYVENV/bin/activate"
log "Mise à jour pip et installation des dépendances"
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt
log "Installation terminée. Pour démarrer le serveur:"
printf "\n  source %s/bin/activate\n  python -m uvicorn src.camillamix.api_server:app --reload --host 0.0.0.0 --port 8000\n\n" "$PYVENV"
