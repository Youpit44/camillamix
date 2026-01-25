# Guide d'Utilisation - CamillaMixer

Ce guide explique comment utiliser l'interface web CamillaMixer pour contrôler votre système audio.

## Interface Principale

L'interface ressemble à une table de mixage analogique traditionnelle. Elle est divisée en tranches (channels) et une section Master.

### Tranche de Console (Channel Strip)

Chaque canal (1 à 8) contrôle une entrée ou un groupe de canaux de CamillaDSP.

1.  **Gain (Haut)** : Ajuste le niveau d'entrée avant le fader.
2.  **Égaliseur (EQ)** : Trois potentiomètres pour sculpter le son :
    *   **HI** : Aigus.
    *   **MID** : Médiums.
    *   **LO** : Graves.
    *   *Double-cliquez sur un potentiomètre pour le remettre à zéro.*
3.  **Boutons d'État** :
    *   **MUTE** (Rouge) : Coupe le son du canal.
    *   **SOLO** (Jaune) : Isole ce canal (coupe tous les autres non-solo).
4.  **Fader** : Contrôle le volume principal du canal.
5.  **Vumètre** : Affiche le niveau du signal en temps réel (Vert/Jaune/Rouge).

### Section Master

Située à droite, elle contrôle le volume global de sortie.
*   Comporte ses propres boutons Mute et Solo (Clear Solo).
*   Affiche les niveaux de sortie globaux.

## Gestion des Presets

Le panneau de droite (sur grand écran) ou le menu permet de gérer les configurations.

*   **Sauvegarder** : Enregistre l'état actuel (volumes, EQ, mutes) dans un nouveau fichier.
*   **Charger** : Rappelle une configuration précédemment sauvegardée.
*   **Autosave** : Si activé dans les options, l'état est sauvegardé automatiquement à intervalle régulier.

## Options et Configuration

Cliquez sur le bouton "Settings" (icône engrenage) pour ouvrir le panneau de configuration.

### Connexion CamillaDSP
*   **Camilla GUI WS URL** : Adresse WebSocket de l'interface native CamillaDSP (ex: `ws://localhost:1234`).
*   **Camilla Host/Port** : Adresse IP et port TCP pour le contrôle direct (backend).
*   **Status LED** : Indique si la connexion avec CamillaDSP est active (Vert) ou perdue (Rouge).

### Préférences
*   **Logs Serveur (Bash)** : Active ou désactive les logs dans la console du serveur (utile pour réduire le bruit sur les systèmes embarqués). Cette option est sauvegardée.
*   **Debug Overlay** : Affiche des informations techniques en surimpression pour le débogage.
*   **Local Drag Mode** : Si activé, les changements de fader ne sont envoyés qu'au relâchement de la souris (économise la bande passante réseau).

## Raccourcis et Astuces
*   **Double-clic** sur un fader ou un potentiomètre : Réinitialise à la valeur par défaut (0dB).
*   L'interface est responsive et fonctionne sur tablette et mobile.
