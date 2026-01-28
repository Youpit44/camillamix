#!/bin/bash

# Vérifier si un dossier a été fourni en argument, sinon utiliser le dossier courant
SEARCH_DIR="${1:-.}"

# Vérifier si ffprobe est installé
if ! command -v ffprobe &> /dev/null; then
    echo "Erreur : Ce script nécessite 'ffprobe' (inclus dans ffmpeg)."
    exit 1
fi

echo "Recherche des fichiers M4A avec 'ORIGINAL YEAR' ou 'ORIGINALDATE' à '0000' dans : $SEARCH_DIR"
echo "--------------------------------------------------------------------------------"

find "$SEARCH_DIR" -type f -name "*.m4a" -print0 | while IFS= read -r -d '' file; do
    # Utilisation de ffprobe pour lire les métadonnées en format JSON
    # On capture tout le bloc tags
    TAGS=$(ffprobe -v quiet -show_entries format_tags -of json "$file")

    # On cherche les clés spécifiques correspondant aux métadonnées iTunes
    # La structure ffprobe pour ces tags ressemble souvent à "com.apple.iTunes:ORIGINAL YEAR": "0000"
    
    # Vérification 1: com.apple.iTunes:ORIGINAL YEAR = 0000
    if echo "$TAGS" | grep -Fq "com.apple.iTunes:ORIGINAL YEAR" && echo "$TAGS" | grep -Eiq '"com.apple.iTunes:ORIGINAL YEAR":\s*"0000"'; then
        echo "$file"
        continue
    fi

    # Vérification 2: com.apple.iTunes:ORIGINALDATE = 0000
    if echo "$TAGS" | grep -Fq "com.apple.iTunes:ORIGINALDATE" && echo "$TAGS" | grep -Eiq '"com.apple.iTunes:ORIGINALDATE":\s*"0000"'; then
        echo "$file"
        continue
    fi
done
