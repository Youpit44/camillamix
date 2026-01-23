# Architecture Technique - CamillaMixer

Ce document décrit l'architecture technique de l'application CamillaMixer, une interface web de mixage pour CamillaDSP.

## Vue d'ensemble

CamillaMixer est une application client-serveur conçue pour fournir une interface de mixage temps réel (style table de mixage DJ) pour le moteur de traitement audio CamillaDSP.

L'application se compose de :
1.  **Backend Python** : Serveur web (aiohttp) qui gère l'API REST, les WebSockets, et la communication avec CamillaDSP.
2.  **Frontend JavaScript** : Interface utilisateur réactive (Vanilla JS modulaire) qui communique avec le backend via WebSockets pour le temps réel et API REST pour la configuration.

## Architecture Backend

Le backend est écrit en Python 3.13+ et utilise `aiohttp` pour sa nature asynchrone, essentielle pour gérer les WebSockets et les connexions persistantes avec CamillaDSP.

### Structure des fichiers (`backend/`)

*   **`server.py`** : Point d'entrée principal.
    *   Initialise le serveur web `aiohttp`.
    *   Gère les routes HTTP (`/api/*`) et le endpoint WebSocket (`/ws`).
    *   Maintient l'état global du mixeur (`app['mixer']`).
    *   Gère la persistance de la configuration serveur (`server_config.json`).
    *   Orchestre la boucle d'événements principale.
*   **`camilla_adapter.py`** : Couche d'abstraction pour CamillaDSP.
    *   Gère la connexion TCP/WebSocket vers l'instance CamillaDSP.
    *   Traduit les commandes de mixage (volume, mute) en commandes CamillaDSP.
    *   Surveille l'état de CamillaDSP (RMS, Peak).
*   **`presets.py`** : Gestionnaire de presets.
    *   Charge et sauvegarde les configurations de mixage (niveaux, EQ, mutes) au format JSON.
    *   Gère la validation des noms de fichiers pour la sécurité.
*   **`logger.py`** : Configuration du logging (si présent/utilisé).

### Flux de Données

1.  **État du Mixeur** : L'état (volumes, mutes, EQ) est stocké en mémoire dans le backend.
2.  **Synchronisation** :
    *   Le frontend envoie des commandes (ex: `set_channel_level`) via WebSocket.
    *   Le backend met à jour son état interne.
    *   Le backend transmet la commande à CamillaDSP via `camilla_adapter`.
    *   Le backend diffuse le nouvel état à tous les clients connectés.
3.  **Vumètres (RMS/Peak)** :
    *   CamillaDSP envoie les niveaux via WebSocket/TCP au backend.
    *   Le backend agrège ces données.
    *   Le backend diffuse les niveaux aux clients frontend à intervalle régulier (broadcaster).

## Architecture Frontend

Le frontend est une Single Page Application (SPA) écrite en JavaScript moderne (ES6 Modules), sans framework lourd, pour garantir légèreté et performance.

### Structure des fichiers (`frontend/`)

*   **`app.js`** : Point d'entrée. Initialise les modules et la connexion WebSocket.
*   **`ui.js`** : Gestion du DOM et des interactions utilisateur.
    *   Génération dynamique des tranches de console (Channel Strips).
    *   Gestion des événements (drag & drop des faders, clics boutons).
    *   Mise à jour visuelle (LEDs, positions faders).
*   **`socket.js`** : Gestion de la communication réseau.
    *   Maintient la connexion WebSocket.
    *   Gère la reconnexion automatique.
    *   Dispatche les messages reçus vers l'UI.
*   **`visualizer.js`** : Gestion de l'analyseur de spectre.
    *   Utilise l'API Canvas pour dessiner le spectre audio.
    *   Reçoit les données FFT (si disponibles) ou simule pour l'instant.
*   **`utils.js`** : Fonctions utilitaires (Debounce, formatage, Logging conditionnel).

### Composants UI Clés

*   **Channel Strip** : Chaque canal audio (1-8) possède :
    *   Gain (Potentiomètre rotatif).
    *   EQ 3 bandes (High, Mid, Low).
    *   Mute / Solo.
    *   Fader linéaire (Volume).
    *   Vumètre (Canvas).
*   **Master Section** : Contrôle global du volume et vumètres de sortie.
*   **Settings Modal** : Configuration de l'application (IP CamillaDSP, Logs, Autosave).

## Sécurité

*   **Validation des Entrées** : Les noms de presets sont validés par Regex (`^[a-zA-Z0-9_-]+$`) pour empêcher les attaques par traversée de chemin (Path Traversal).
*   **Isolation** : Le serveur tourne idéalement dans un environnement virtuel Python (`venv`).

## Persistance

*   **Presets** : Stockés dans `backend/presets/*.json`.
*   **Configuration Serveur** : Préférences globales (ex: logs activés) stockées dans `backend/server_config.json`.
*   **Autosave** : Fonctionnalité de sauvegarde automatique de l'état du mixeur.
