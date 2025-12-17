CamillaMixer (Web)
===================

Interface web minimale pour piloter CamillaDSP (prototype).

Caractéristiques:
- Backend Python (aiohttp) servant une interface web statique
- WebSocket pour commandes en temps réel (faders, mute/solo)
- Presets JSON (save/load)
- UI en français, 8 canaux par défaut

Installation rapide:

```bash
python -m venv .venv
source .venv/bin/activate   # ou .venv\\Scripts\\activate sur Windows
pip install -r requirements.txt
python backend/server.py
# Ouvrir http://localhost:8080
```

Voir `docs/INSTALL.md` pour plus de détails.
