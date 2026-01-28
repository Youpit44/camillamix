#!/bin/bash

# Vérifier si un dossier a été fourni en argument, sinon utiliser le dossier courant
SEARCH_DIR="${1:-.}"

# Vérifier si eyeD3 est installé
if ! command -v eyeD3 &> /dev/null; then
    echo "Erreur : eyeD3 n'est pas installé. Veuillez l'installer avant d'utiliser ce script (ex: pip install eyeD3)."
    exit 1
fi

echo "Recherche des fichiers MP3 avec le tag 'UserTextFrame: [Description: ALBUM ARTIST]' dans le dossier : $SEARCH_DIR"
echo "--------------------------------------------------------------------------------"

# Utiliser find pour chercher les fichiers mp3 récursivement
# -print0 et IFS= read ... permettent de gérer correctement les fichiers avec des espaces
find "$SEARCH_DIR" -type f -name "*.mp3" -print0 | while IFS= read -r -d '' file; do
    # Exécuter eyeD3 sur le fichier
    # --no-color désactive la coloration pour faciliter la recherche de texte (grep)
    # 2>&1 redirige la sortie d'erreur vers la sortie standard (eyeD3 écrit parfois des infos sur stderr)
    if eyeD3 --no-color "$file" 2>&1 | grep -Fq "UserTextFrame: [Description: ALBUM ARTIST]"; then
        desc=$(eyeD3 --no-color "$file" 2>/dev/null | grep -A 1 "UserTextFrame: \[Description: ALBUM ARTIST]" | tail -n 1)
        echo "$file"
        echo "  desc: $desc"
        eyeD3 --no-color --user-text-frame='Description:' --user-text-frame='ALBUM ARTIST:' "$file"
    fi
#    if eyeD3 --no-color "$file" 2>&1 | grep -Fq "UserTextFrame: [Description: ALBUM ARTIST]"; then
#        desc=$(eyeD3 --no-color "$file" | grep -A 1 "UserTextFrame: \[Description: ALBUM ARTIST]" | tail -n 1)
#        echo "$file"
#        echo "  desc: $desc"
#    fi

done
