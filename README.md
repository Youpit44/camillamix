CamillaMixer (Web)
===================

Interface web pour piloter CamillaDSP (prototype Numark-like).

Caractéristiques principales
- Mixer 8 canaux (fader, mute/solo, VU) + bloc Master
- EQ 3 bandes par canal (HI/MID/LO) + potard GAIN
- Presets JSON (save/load/import/export) et import YAML CamillaDSP
- WebSocket temps réel, envoi local différé optionnel pendant le drag
- Autosave configurable, debug overlay, options réunies dans un modal
- LED de statut CamillaDSP (WS/TCP) et WebSocket client

Dépendances minimales
- Python 3.10+
- packages: aiohttp, pyyaml, (optionnel) pycamilladsp pour le mode TCP

Démarrage rapide
```bash
python -m venv .venv
source .venv/bin/activate   # ou .venv\Scripts\activate sur Windows
pip install -r requirements.txt
python backend/server.py
# Ouvrir http://localhost:8080
```

Configuration CamillaDSP
- WebSocket CamillaGUI: définir CAMILLA_WS_URL (ex: ws://127.0.0.1:1234)
- TCP pyCamillaDSP: CAMILLA_HOST (defaut 127.0.0.1), CAMILLA_PORT (defaut 1234)
- Les deux modes peuvent coexister; le statut est visible via la LED dans le modal Options.

YAML CamillaDSP (import)
- Endpoint HTTP: POST /api/import_yaml avec un fichier .yml/.yaml
- Exemple:
```bash
curl -X POST -F "file=@dac8x.yml" http://localhost:8080/api/import_yaml
```
- Le mapping niveaux/canaux importé se reflète dans l’UI et peut être sauvegardé en preset.

Options côté UI (modal)
- Autosave: activer/désactiver et intervalle (sec)
- Mode local pendant drag: envoie seulement la valeur finale
- Debug overlay: journalise les événements et positions de fader
- Config CamillaDSP: host/port TCP, URL WS, plus LED de statut verte/rouge

Notes d’utilisation
- Le bloc master affiche un VU, un fader et un potard LEVEL.
- Les VU sont mis à jour périodiquement via WebSocket (intervalle 200 ms).

Documentation supplémentaire
- Voir docs/INSTALL.md pour une installation détaillée et les commandes Windows/Linux.
