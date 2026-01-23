# Guide d'Installation - CamillaMixer

Ce guide détaille les étapes pour installer et configurer CamillaMixer sur un système Linux (Raspberry Pi, PC) ou Windows.

## Prérequis

*   **Python 3.10** ou supérieur.
*   **CamillaDSP** installé et fonctionnel.
*   Accès terminal (SSH ou local).

## Installation

### 1. Récupérer le code
Clonez le dépôt ou téléchargez les fichiers dans un dossier, par exemple `/opt/camillamix`.

```bash
cd /opt/camillamix
```

### 2. Créer un environnement virtuel (Recommandé)
Il est fortement conseillé d'utiliser un environnement virtuel Python pour isoler les dépendances.

**Linux / macOS :**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Windows :**
```bash
python -m venv .venv
.venv\Scripts\activate
```

### 3. Installer les dépendances
Installez les paquets Python nécessaires listés dans `requirements.txt`.

```bash
pip install -r requirements.txt
```

*Note : Les dépendances principales sont `aiohttp` (serveur web) et `pyyaml` (gestion config).*

## Configuration

### Variables d'environnement (Optionnel)
Vous pouvez configurer certains paramètres via des variables d'environnement avant de lancer le serveur, bien que la plupart soient configurables via l'interface web.

*   `CAMILLA_HOST` : Adresse IP de CamillaDSP (défaut: 127.0.0.1)
*   `CAMILLA_PORT` : Port TCP de CamillaDSP (défaut: 1234)

## Démarrage

### Lancement manuel
Pour lancer le serveur manuellement :

```bash
# Assurez-vous que l'environnement virtuel est activé
python backend/server.py
```

Le serveur démarrera par défaut sur le port **8080**.
Accédez à l'interface via : `http://votre-ip:8080`

### Lancement automatique (Systemd - Linux)
Pour lancer CamillaMixer automatiquement au démarrage (ex: sur un Raspberry Pi).

1.  Créez un fichier de service : `sudo nano /etc/systemd/system/camillamix.service`

2.  Collez le contenu suivant (adaptez les chemins et l'utilisateur) :

```ini
[Unit]
Description=CamillaMixer Web Interface
After=network.target camilladsp.service

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/camillamix
ExecStart=/opt/camillamix/.venv/bin/python /opt/camillamix/backend/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

3.  Activez et démarrez le service :

```bash
sudo systemctl daemon-reload
sudo systemctl enable camillamix
sudo systemctl start camillamix
```

## Mise à jour

Pour mettre à jour l'application :

```bash
cd /opt/camillamix
git pull
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart camillamix
```
