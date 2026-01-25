# Code Review - CamillaMix

## 1. Failles Logiques et Cas Limites (Logic & Edge Cases)

*   **Condition de concurrence (Race Condition) sur la configuration :**
    *   **Problème :** Dans `camilla_adapter.py` (fonctions `_update_mixer_gain`, `set_filter_gain`, `set_mutes`), le code lit la configuration active (`config.active()`), la modifie en mémoire, puis la réapplique (`config.set_active()`).
    *   **Risque :** Si deux utilisateurs (ou deux processus) bougent des potards différents simultanément, le deuxième peut écraser les modifications du premier car il a lu une version de la config qui est devenue obsolète entre le moment de la lecture et de l'écriture.
    *   **Solution :** Utiliser un mécanisme de verrouillage (Lock) autour des opérations de lecture-modification-écriture de la config, ou mieux, utiliser les API de modification de paramètres en temps réel de CamillaDSP si disponibles (pour éviter de renvoyer toute la config).

*   **Logique "Solo" Destructive :**
    *   **Problème :** La logique Solo (`update_dsp_mutes` dans `server.py`) modifie l'état `mute` réel des canaux dans le DSP.
    *   **Risque :** Si le serveur Python plante ou est tué alors qu'un mode "Solo" est actif, les autres canaux resteront mutés dans CamillaDSP. L'état "Solo" n'est pas natif au DSP, c'est une émulation logicielle.
    *   **Solution :** Difficile à résoudre sans changer l'architecture, mais il faudrait idéalement un gestionnaire de contexte ou un hook d'arrêt (`atexit`) qui rétablit les mutes à leur état d'origine en cas d'arrêt du serveur.

*   **Désynchronisation de l'état :**
    *   **Problème :** Le frontend suppose que l'état envoyé est appliqué. Si CamillaDSP rejette une commande (ex: valeur hors limites, erreur de communication), l'UI affichera une valeur fausse jusqu'au prochain rafraîchissement complet.

## 2. Goulots d'étranglement de la performance (Performance Bottlenecks)

*   **Rechargement complet de la config pour l'EQ et le Gain Mixer :**
    *   **Problème critique :** Pour changer le gain d'un filtre (EQ) ou d'un mixer, `camilla_adapter.py` utilise `self._py_client.config.set_active(config)`. Cela envoie **toute** la configuration YAML au DSP.
    *   **Impact :** Sur des configurations lourdes, cela peut provoquer des micro-coupures audio (glitches) ou une latence élevée lors de la rotation rapide des potards. CamillaDSP doit re-parser et potentiellement ré-allouer des ressources.
    *   **Solution :** Vérifier si `pycamilladsp` permet de mettre à jour uniquement les coefficients d'un filtre sans recharger toute la config (via l'API de paramètres temps réel).

*   **[CORRIGÉ] Manipulation du DOM excessive (Frontend) :**
    *   **Problème :** Dans `app.js`, la fonction `updateLevels` fait des `document.querySelector('#ch-' + l.channel ...)` à chaque frame (ou à chaque message WebSocket).
    *   **Solution :** Implémentation d'un cache DOM (`domCache`) dans `ui.js`. Les références aux éléments sont stockées lors de la première recherche.

*   **[CORRIGÉ] Animation du Spectre :**
    *   **Problème :** Le calcul des sinus et du bruit dans la boucle `tick()` est fait en JavaScript pur.
    *   **Solution :** Le visualiseur utilise maintenant un élément HTML5 `<canvas>` (voir `visualizer.js`) pour un rendu performant.

## 3. Vulnérabilités de Sécurité (Security)

*   **Absence d'Authentification :**
    *   **Problème :** Il n'y a aucune protection sur le WebSocket ou l'interface Web.
    *   **Risque :** N'importe qui sur le réseau local peut prendre le contrôle du son, monter le volume à fond (risque de dégâts matériels) ou charger une configuration corrompue.

*   **[CORRIGÉ] Traversée de répertoire (Path Traversal) :**
    *   **Problème :** Dans `server.py`, `save_preset` utilise le nom fourni par l'utilisateur.
    *   **Solution :** Ajout de la fonction `validate_preset_name` dans `server.py` qui applique une regex stricte (`^[a-zA-Z0-9_-]+$`) sur les noms de fichiers.

*   **Injection YAML (DoS) :**
    *   **Problème :** L'import YAML permet d'envoyer des fichiers. Bien que `MAX_YAML_SIZE` soit vérifié, le parsing YAML peut être coûteux (Billion laughs attack).
    *   **Solution :** `yaml.safe_load` est utilisé, ce qui est bien, mais limiter la complexité/profondeur du fichier serait un plus.

## 4. Maintenabilité (Maintainability)

*   **Valeurs codées en dur (Hardcoding) :**
    *   **Problème :** Les noms des filtres `Bass_X`, `Mid_X`, `Treble_X` sont codés en dur dans `server.py` et `camilla_adapter.py`.
    *   **Impact :** Si vous décidez de renommer vos filtres dans le fichier YAML (par exemple "LowShelf_0" au lieu de "Bass_0"), l'interface EQ cessera de fonctionner sans erreur explicite.
    *   **Solution :** Rendre ces noms configurables (via un fichier de config ou des variables d'environnement) ou introspecter la config pour trouver les filtres par type plutôt que par nom.

*   **[CORRIGÉ] Fichier `app.js` monolithique :**
    *   **Problème :** Le fichier fait plus de 1300 lignes.
    *   **Solution :** Refactoring complet en modules ES6 : `app.js` (Main), `ui.js` (Interface), `socket.js` (Réseau), `visualizer.js` (Canvas), `utils.js` (Outils).

*   **Gestion des erreurs silencieuse :**
    *   **Problème :** Beaucoup de blocs `try...except` dans le backend finissent par `logger.exception(...)` mais continuent l'exécution ou retournent `None`.
    *   **Impact :** Le système peut se retrouver dans un état instable sans que l'utilisateur ne sache pourquoi une action a échoué.
