# CamillaMixer

**CamillaMixer** est une interface web moderne et réactive pour contrôler [CamillaDSP](https://github.com/HEnquist/camilladsp). Elle offre une expérience utilisateur similaire à une table de mixage physique, idéale pour les configurations audio multicanales.

## Fonctionnalités

*   🎚️ **Mixeur 8 Canaux** : Contrôle de volume, Mute, Solo, et Gain par canal.
*   🎛️ **Égaliseur Paramétrique** : EQ 3 bandes (Low, Mid, High) sur chaque tranche.
*   📊 **Vumètres Temps Réel** : Visualisation précise des niveaux d'entrée et de sortie (RMS/Peak).
*   💾 **Gestion de Presets** : Sauvegardez et rappelez instantanément vos configurations de mixage.
*   🔄 **Synchronisation Bidirectionnelle** : L'interface reste toujours synchronisée avec l'état réel de CamillaDSP.
*   📱 **Responsive** : Fonctionne sur ordinateur, tablette et mobile.

## Documentation

La documentation complète est disponible dans le dossier `docs/` :

*   [**Guide d'Installation**](docs/INSTALL.md) : Comment installer et lancer le serveur.
*   [**Guide d'Utilisation**](docs/USAGE.md) : Comment utiliser l'interface de mixage.
*   [**Architecture Technique**](docs/ARCHITECTURE.md) : Détails sur le fonctionnement interne (pour les développeurs).

## Démarrage Rapide

Si vous êtes pressé :

```bash
# 1. Créer l'environnement virtuel
python3 -m venv .venv
source .venv/bin/activate

# 2. Installer les dépendances
pip install -r requirements.txt

# 3. Lancer le serveur
python backend/server.py
```

Ouvrez ensuite **http://localhost:8080** dans votre navigateur.

## Licence

Ce projet est sous licence MIT.
