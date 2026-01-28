#!/bin/bash

# Vérifier si un dossier a été fourni en argument, sinon utiliser le dossier courant
SEARCH_DIR="${1:-.}"

# Vérifier si eyeD3 est installé
if ! command -v eyeD3 &> /dev/null; then
    echo "Erreur : eyeD3 n'est pas installé. Veuillez l'installer avant d'utiliser ce script."
    exit 1
fi

echo "Recherche des fichiers MP3 contenant à la fois ID3v2.4 et ID3v1 dans : $SEARCH_DIR"
echo "Les tags ID3v1 seront supprimés pour ces fichiers."
echo "--------------------------------------------------------------------------------"

# Utiliser find pour chercher les fichiers mp3 récursivement
find "$SEARCH_DIR" -type f -name "*.mp3" -print0 | while IFS= read -r -d '' file; do
    # Récupérer les infos du fichier
    INFO=$(eyeD3 --no-color "$file" 2>&1)
    
    # Vérifier la présence de "ID3 v2.4" (v2.4.0) ET "ID3 v1" (v1.0 ou v1.1)
    if echo "$INFO" | grep -Fq "ID3 v2.4" && echo "$INFO" | grep -Fq "ID3 v1"; then
        echo "Suppression ID3v1 sur : $file"
        # Suppression des tags v1
        # eyeD3 --remove-v1 "$file" > /dev/null
    fi
done
