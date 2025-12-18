# Installation

## Prérequis
- Python 3.10+
- pip

## Création de l’environnement
```bash
python -m venv .venv
source .venv/bin/activate            # Linux/macOS
.venv\Scripts\activate               # Windows PowerShell/CMD
pip install -r requirements.txt
```

## Lancement du serveur
```bash
python backend/server.py
```

Puis ouvrir http://localhost:8080

## Configuration CamillaDSP
- WebSocket CamillaGUI: définir CAMILLA_WS_URL (ex: ws://127.0.0.1:1234)
- TCP pyCamillaDSP (optionnel): CAMILLA_HOST (127.0.0.1 par défaut), CAMILLA_PORT (1234 par défaut)

## Import YAML CamillaDSP
```bash
curl -X POST -F "file=@dac8x.yml" http://localhost:8080/api/import_yaml
```
Le mapping importé alimente l’UI et peut être sauvegardé comme preset.

## Options UI utiles
- Autosave: activer/désactiver + intervalle (sec)
- Mode local pendant drag: envoie uniquement la valeur finale
- Debug overlay: pour diagnostiquer les sliders
- LED de statut CamillaDSP dans le modal Options
