#!/bin/bash

# Vérifier si un dossier a été fourni en argument, sinon utiliser le dossier courant
SEARCH_DIR="${1:-.}"

# Vérifier si ffprobe est installé
if ! command -v ffprobe &> /dev/null; then
    echo "Erreur : Ce script nécessite 'ffprobe' (inclus dans ffmpeg)."
    echo "Veuillez l'installer pour continuer (ex: brew install ffmpeg)."
    exit 1
fi

echo "Recherche des fichiers MP3 (ID3v2.4) avec le tag TDOR = 0000 via ffprobe et le supprime..."
echo "--------------------------------------------------------------------------------"

find "$SEARCH_DIR" -type f -name "*.mp3" -print0 | while IFS= read -r -d '' file; do
    # Utilisation de ffprobe pour lire les métadonnées en format JSON
    TAGS=$(ffprobe -v quiet -show_entries format_tags -of json "$file")

    # 1. Vérifier la présence du tag TDOR (ou tdor) avec la valeur "0000"
    if echo "$TAGS" | grep -Eiq '"tag:TDOR":\s*"0000"' || echo "$TAGS" | grep -Eiq '"TDOR":\s*"0000"'; then
        
        # 2. Vérifier si c'est bien du ID3v2.4 avec la commande 'file'
        # La commande 'file' indique généralement la version : "Audio file with ID3 version 2.4.0"
        if file "$file" | grep -Fq "ID3 version 2.4"; then
            echo "$file"
            # eyeD3 --remove-frame TDOR "$file" > /dev/null
        fi
    fi
done
