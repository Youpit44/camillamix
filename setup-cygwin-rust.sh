#!/usr/bin/env bash
# setup-cygwin-rust.sh
# Script d'installation/compilation de Rust (rustc, cargo) pour le target x86_64-pc-cygwin
# à exécuter dans un terminal Cygwin 64-bit.
#
# Utilisation :
#   bash setup-cygwin-rust.sh
#
# Variables personnalisables (exporter avant d'exécuter le script) :
#   MIRROR="https://www.cygwin.com"               # Miroir Cygwin (sera complété avec /pub/cygwin)
#   INSTALL_PREFIX="/usr/local"                   # Préfixe d'installation de rust (x.py install)
#   RUST_BRANCH="stable"                          # Branche/tag git (ex: stable, beta, nightly, 1.84.0)
#   JOBS=8                                         # Parallélisme build (défaut: nproc)
#   WORKDIR="$HOME/src"                           # Dossier de travail pour cloner les sources
#   PACKAGES_ADDITIONAL=""                        # Paquets Cygwin additionnels (séparés par virgules)
#   SEED_TOOLCHAIN="stable"                       # Toolchain rustup pour le bootstrap (ex: stable, nightly)
#
# ATTENTION :
#  - Le target x86_64-pc-cygwin est expérimental ; il n'existe pas de binaire officiel.
#  - Ce script télécharge setup-x86_64.exe et tente d'installer les paquets requis en mode silencieux.
#  - Vous pouvez rencontrer des échecs sur cargo/libgit2 suivant l'état du port; voir README final.

set -euo pipefail
IFS=$'\n\t'

############# Journalisation #############
log() { printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[ERR ]\033[0m %s\n" "$*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Commande requise manquante: $1"; return 1
  fi
}

############# Paramètres #############
MIRROR_DEFAULT="https://www.cygwin.com"
MIRROR="${MIRROR:-$MIRROR_DEFAULT}"
INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local}"
RUST_BRANCH="${RUST_BRANCH:-stable}"
WORKDIR="${WORKDIR:-$HOME/src}"
PACKAGES_ADDITIONAL="${PACKAGES_ADDITIONAL:-}"
SEED_TOOLCHAIN="${SEED_TOOLCHAIN:-stable}"

if command -v nproc >/dev/null 2>&1; then
  JOBS_DEFAULT=$(nproc)
else
  JOBS_DEFAULT=1
fi
JOBS="${JOBS:-$JOBS_DEFAULT}"

CYGSETUP_URL="https://www.cygwin.com/setup-x86_64.exe"
CYGSETUP_EXE="$WORKDIR/setup-x86_64.exe"
RUST_REPO_URL="https://github.com/rust-lang/rust.git"
RUST_SRC_DIR="$WORKDIR/rust"

# Paquets requis (virgules, format attendu par -P de setup-x86_64.exe)
PACKAGES_BASE="git,curl,wget,ca-certificates,make,cmake,pkg-config,gcc-core,gcc-g++,python3,python3-devel,libssl-devel,zlib-devel,openssh,tar,xz,unzip"
# PACKAGES_BASE="git,curl,wget,ca-certificates,make,pkg-config,gcc-core,gcc-g++,python3,python3-devel,libssl-devel,zlib-devel,openssh,tar,xz,unzip"
# libgit2-devel est idéal pour cargo; sinon cargo peut builder sa version (avec risques)
PACKAGES_LIBGIT2="libgit2-devel"
PACKAGES_ALL="$PACKAGES_BASE,$PACKAGES_LIBGIT2"
if [[ -n "$PACKAGES_ADDITIONAL" ]]; then
  PACKAGES_ALL="$PACKAGES_ALL,$PACKAGES_ADDITIONAL"
fi

############# Vérifications #############
log "Vérification de l'environnement Cygwin..."
uname_s=$(uname -s || true)
if ! echo "$uname_s" | grep -qi "cygwin"; then
  warn "Ce script est conçu pour Cygwin. Environnement détecté: $uname_s"
  warn "Il peut fonctionner partiellement, mais l'installation de paquets Cygwin exigera Cygwin."
fi

log "Création du répertoire de travail: $WORKDIR"
mkdir -p "$WORKDIR"

############# Télécharger setup-x86_64.exe #############
log "Téléchargement de setup-x86_64.exe..."
if [[ ! -f "$CYGSETUP_EXE" ]]; then
  if command -v curl >/dev/null 2>&1; then
    curl -L "$CYGSETUP_URL" -o "$CYGSETUP_EXE"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$CYGSETUP_EXE" "$CYGSETUP_URL"
  else
    err "Ni curl ni wget n'est disponible pour télécharger $CYGSETUP_URL"; exit 1
  fi
else
  log "setup-x86_64.exe déjà présent: $CYGSETUP_EXE"
fi

############# Installer les paquets requis #############
log "Installation des paquets Cygwin requis..."
# Le miroir attendu par setup est un répertoire de distribution (souvent MIRROR/pub/cygwin)
# On laisse setup décider; si besoin, l'utilisateur peut spécifier MIRROR complet via variable.
"$CYGSETUP_EXE" -q -n -s "$MIRROR" -P "$PACKAGES_ALL" || {
  warn "L'installation silencieuse via setup-x86_64.exe a échoué ou certains paquets sont déjà installés."
}

############# Vérifier quelques commandes clés #############
for c in git gcc g++ python3 make cmake pkg-config; do
  require_cmd "$c" || {
    err "Veuillez installer le paquet manquant pour $c puis relancer."; exit 1
  }
done

############# Bootstrap rustc/cargo (host Windows), si absent #############
log "Recherche d'un rustc/cargo de bootstrap dans PATH..."
if ! command -v rustc >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
  warn "Aucun rustc/cargo dans PATH. Tentative d'installation via rustup-init.exe (Windows)."
  RUSTUP_INIT_EXE="$WORKDIR/rustup-init.exe"
  RUSTUP_URL="https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
  # Télécharge rustup-init
  if command -v curl >/dev/null 2>&1; then
    curl -L "$RUSTUP_URL" -o "$RUSTUP_INIT_EXE"
  else
    wget -O "$RUSTUP_INIT_EXE" "$RUSTUP_URL"
  fi
  chmod +x "$RUSTUP_INIT_EXE"
  # Installe stable par défaut côté Windows (MSVC); c'est suffisant pour booter la build
  "$RUSTUP_INIT_EXE" -y --default-toolchain "$SEED_TOOLCHAIN" || warn "rustup-init a retourné une erreur; si rustup est déjà installé, c'est acceptable."
  # Ajoute le .cargo/bin Windows au PATH Cygwin pour la session
  USER_WIN=$(cmd.exe /c "echo %USERNAME%" | tr -d '\r' || echo "$USER")
  CARGO_WIN="/cygdrive/c/Users/${USER_WIN}/.cargo/bin"
  export PATH="$CARGO_WIN:$PATH"
  log "Ajout au PATH: $CARGO_WIN"
fi

# ...existing code...
log "Versions seed :"
if command -v rustc >/dev/null 2>&1; then rustc --version || true; fi
if command -v cargo >/dev/null 2>&1; then cargo --version || true; fi

# --- Détection robuste de cargo (ajouté) ---
if command -v cargo >/dev/null 2>&1; then
  CARGO_CMD="$(command -v cargo)"
else
  USER_WIN=$(cmd.exe /c "echo %USERNAME%" | tr -d '\r' || echo "$USER")
  CARGO_WIN="/cygdrive/c/Users/${USER_WIN}/.cargo/bin/cargo"
  # supporte cargo et cargo.exe
  if [[ -x "$CARGO_WIN" ]]; then
    CARGO_CMD="$CARGO_WIN"
  elif [[ -x "${CARGO_WIN}.exe" ]]; then
    CARGO_CMD="${CARGO_WIN}.exe"
  else
    CARGO_CMD="cargo"  # fallback, laisser x.py échouer plus tard avec message clair
    warn "cargo introuvable dans PATH ; tentative d'utiliser $CARGO_WIN si installé."
  fi
fi
log "Utilisation de cargo pour bootstrap: $CARGO_CMD"
# ...existing code...

############# Cloner les sources de Rust #############
log "Clonage de $RUST_REPO_URL dans $RUST_SRC_DIR..."
if [[ ! -d "$RUST_SRC_DIR/.git" ]]; then
  git clone "$RUST_REPO_URL" "$RUST_SRC_DIR"
else
  log "Sources déjà présentes. Pull..."
  (cd "$RUST_SRC_DIR" && git fetch --all --tags && git pull --rebase) || warn "Impossible de mettre à jour les sources (continuation)."
fi

cd "$RUST_SRC_DIR"
if [[ "$RUST_BRANCH" != "" && "$RUST_BRANCH" != "stable" ]]; then
  log "Checkout de la branche/tag: $RUST_BRANCH"
  git checkout "$RUST_BRANCH" || warn "Checkout $RUST_BRANCH impossible; on reste sur la branche courante."
fi

############# Écrire config.toml #############
log "Écriture de config.toml..."
cat > config.toml <<EOF
[build]
targets = ["x86_64-pc-cygwin"]
rustc = "rustc"
cargo = "$CARGO_CMD"
extended = true
jobs = $JOBS

[install]
prefix = "$INSTALL_PREFIX"

[target.x86_64-pc-cygwin]
# Utiliser le linker cygwin; fallback vers gcc s'il n'existe pas sous ce nom
linker = "$(command -v x86_64-pc-cygwin-gcc >/dev/null 2>&1 && echo x86_64-pc-cygwin-gcc || echo gcc)"
EOF

############# Build stage 1 #############
log "Compilation de Rust (stage 1)... Cela peut prendre longtemps."
python3 x.py build --stage 1

############# Build cargo (extended) #############
log "Compilation de cargo (tools extended)..."
python3 x.py build --stage 1 src/tools/cargo || warn "La construction de cargo a échoué; consultez la section Dépannage."

############# Installation #############
log "Installation (stage 1) dans $INSTALL_PREFIX..."
python3 x.py install --stage 1

############# Tests rapides #############
export PATH="$INSTALL_PREFIX/bin:$PATH"
log "Test rustc/cargo installés..."
if command -v rustc >/dev/null 2>&1; then rustc --version; else err "rustc non trouvé dans $INSTALL_PREFIX/bin"; fi
if command -v cargo >/dev/null 2>&1; then cargo --version || warn "cargo indisponible ou non construit."; fi

############# Préparer un projet exemple #############
log "Création d'un projet de test ciblant x86_64-pc-cygwin..."
TEST_DIR="$WORKDIR/demo-cyg"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"
cat > hello.rs <<'RS'
fn main() {
    println!("Hello from Cygwin Rust!");
}
RS

# Test rustc direct
rustc --target x86_64-pc-cygwin hello.rs -o hello
./hello || warn "Exécution du binaire de test a échoué (vérifiez les dépendances Cygwin)."

# Test cargo si disponible
if command -v cargo >/dev/null 2>&1; then
  cargo init --bin --name demo-cyg --vcs none
  mkdir -p .cargo
  cat > .cargo/config.toml <<'CFG'
[build]
target = "x86_64-pc-cygwin"

[target.x86_64-pc-cygwin]
linker = "x86_64-pc-cygwin-gcc"
CFG
  cargo build || warn "cargo build a échoué; consultez la section Dépannage."
fi

############# Fin #############
log "\nInstallation et tests terminés."
cat <<'README'
--------------------------------------
NOTES IMPORTANTES & DÉPANNAGE
--------------------------------------
• Le target x86_64-pc-cygwin est de niveau Tier 3 et ne dispose pas de binaires officiels.
  Reportez-vous à la documentation de support plateforme :
    - https://doc.rust-lang.org/stable/rustc/platform-support/x86_64-pc-cygwin.html

• Le suivi "Experimental cygwin host support" liste des patches requis (compiler-builtins, libc, std, cargo/libgit2) :
    - https://github.com/rust-lang/rust/issues/137819

• Si cargo échoue (libgit2 manquant/ancien), essayez :
    - Installer/MàJ libgit2-devel via setup-x86_64.exe
    - Rebuilder avec des versions de crates compatibles (voir issues/PRs liés à Cygwin)

• Si vous voulez éviter ces complications, alternatives :
    - MSYS2/MinGW : pacman -S mingw-w64-x86_64-rust
    - rustup Windows (MSVC/MinGW) et usage depuis Cygwin via PATH

• Pour pérenniser PATH, ajoutez dans ~/.bashrc :
    export PATH="$INSTALL_PREFIX/bin:$PATH"

Bon courage et bonne compilation !
README
