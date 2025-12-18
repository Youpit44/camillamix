## RAPPORT DE REVUE DE CODE - CamillaMixer

**Date**: 18 décembre 2025
**Scope**: Backend (server.py, presets.py, camilla_adapter.py) + Frontend (app.js)
**Sévérité**: Critique (🔴) | Élevée (🟠) | Modérée (🟡) | Basse (🟢)

---

## 1. FAILLES LOGIQUES & CAS LIMITES

### 1.1 🔴 CRITIQUE: Path Traversal via Preset Name
**Fichier**: `backend/presets.py` (lignes 14-17, 21-24)
**Problème**: La fonction `save_preset()` utilise directement le nom sans validation:
```python
filename = f"{name}.json"
path = os.path.join(self.presets_dir, filename)
```
**Risque**: Un utilisateur peut passer `name="../../etc/passwd"` et écrire en dehors du répertoire presets.

**Recommandation**:
```python
import pathlib
safe_name = pathlib.Path(name).name  # Extrait uniquement le nom de fichier
if not safe_name or safe_name.startswith('.'):
    raise ValueError("Invalid preset name")
filename = f"{safe_name}.json"
```

---

### 1.2 🔴 CRITIQUE: Integer Overflow sur Channel Index
**Fichier**: `backend/server.py` (lignes 74, 83, 90, 114)
**Problème**: Pas de validation de la borne supérieure après conversion `int()`:
```python
ch = int(payload.get('channel', 0))
if 0 <= ch < len(app['mixer'].channels):  # ✓ Bon
    # Mais pas de validation avant int() si très grand
```
**Risque**: Si client envoie `channel: 999999999`, risque d'attaque DoS ou crash.

**Recommandation**:
```python
try:
    ch = int(payload.get('channel', 0))
    if not (0 <= ch < len(app['mixer'].channels)):
        raise ValueError(f"Channel {ch} out of range")
except (ValueError, TypeError) as e:
    await ws.send_json({'type': 'error', 'payload': f'Invalid channel: {e}'})
    continue
```

---

### 1.3 🟠 ÉLEVÉ: JSON Parsing Exception Non Gérée
**Fichier**: `backend/presets.py` (lignes 21-24)
**Problème**: `load_preset()` appelle `json.load()` sans try/except:
```python
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)  # ← Peut lever JSONDecodeError
return data.get('state')
```
**Risque**: Fichier corrompu = crash de la fonction, réponse en erreur non amicale.

**Recommandation**:
```python
try:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('state') if isinstance(data, dict) else None
except (json.JSONDecodeError, IOError) as e:
    logger.error(f"Failed to load preset {name}: {e}")
    return None
```

---

### 1.4 🟠 ÉLEVÉ: Float Conversion Débordement
**Fichier**: `backend/server.py` (lignes 75, 116, 128)
**Problème**: `float()` peut recevoir `inf`, `nan`, ou très grandes valeurs:
```python
lvl = float(payload.get('level_db', 0.0))
# Aucune validation qu'il soit dans [-60, 12]
```
**Risque**: Comportement imprévisible si `lvl = float('inf')` ou `float('nan')`.

**Recommandation**:
```python
def parse_db_value(val, min_db=-60, max_db=12):
    try:
        f = float(val)
        if not (-180 < f < 180) or math.isnan(f) or math.isinf(f):
            raise ValueError(f"Invalid dB: {f}")
        return max(min_db, min(max_db, f))
    except (ValueError, TypeError):
        raise ValueError(f"Cannot parse dB value: {val}")
```

---

### 1.5 🟡 MODÉRÉ: Autosave peut écraser sans warning
**Fichier**: `backend/server.py` (lignes 500-509 dans on_startup)
**Problème**: L'autosave utilise toujours le nom `'autosave'`, donc en cas d'appel manuel et autosave, risque de conflit.

**Recommandation**: Ajouter un suffixe timestamp ou versioning.

---

## 2. GOULOTS D'ÉTRANGLEMENT PERFORMANCE

### 2.1 🔴 CRITIQUE: Broadcast Brute Force à Chaque Mise à Jour
**Fichier**: `backend/server.py` (lignes 215-230, 239-250)
**Problème**: `levels_broadcaster()` envoie les niveaux à TOUS les clients même si aucun n'a changé:
```python
for ws in list(app['sockets']):
    await ws.send_json(payload)  # À chaque 200ms
```
**Impact**: 8 clients = 8 envois par 200ms = 40 msg/sec. Peut surcharger le réseau/CPU.

**Recommandation**:
- Comparer `levels` avec `last_levels` avant d'envoyer (delta encoding).
- Client-side: throttler les rendus VU même si plusieurs messages arrivent.

---

### 2.2 🟠 ÉLEVÉ: O(n²) lors du broadcast d'état
**Fichier**: `backend/server.py` (lignes 209-214)
**Problème**: À chaque état_needs_broadcast, on boucle sur tous les clients:
```python
websockets = list(app['sockets'])  # Copie
for ws in websockets:
    await ws.send_json(payload)
```
**Impact**: Avec 100 canaux × 50 clients = 5000 opérations potentielles.

**Recommandation**:
- Utiliser `asyncio.gather()` avec `return_exceptions=True` pour paralléliser:
```python
await asyncio.gather(
    *[ws.send_json(payload) for ws in websockets],
    return_exceptions=True
)
```

---

### 2.3 🟡 MODÉRÉ: Copie Complète d'État à Chaque Save
**Fichier**: `backend/server.py` (ligne 101)
**Problème**: `save_preset(name, app['mixer'].to_dict())` crée une copie complète:
```python
app['mixer'].to_dict()  # Copie tout
```
**Impact**: Avec 16 canaux × 5 champs = 80 items copiés, sérialisés en JSON.

**Recommandation**: Implémenter une copie shallow ou un snapshot diff.

---

### 2.4 🟡 MODÉRÉ: Multipart Parser Inefficace
**Fichier**: `backend/server.py` (lignes 380-389)
**Problème**: Le parsing multipart boucle jusqu'à trouver `field.name == 'file'`:
```python
field = await reader.next()
while field is not None:
    if field.name == 'file':
        raw_yaml = await field.text()
        break
```
**Impact**: Si le fichier n'est pas le premier champ, on lit tous les précédents.

**Recommandation**: Utiliser `reader['file']` directement si possible.

---

## 3. VULNÉRABILITÉS SÉCURITÉ

### 3.1 🔴 CRITIQUE: No Input Validation sur Preset Name
**Fichier**: `backend/presets.py`, `backend/server.py` (lignes 99-107)
**Problème**: Aucune longueur max, aucun charset whitelist:
```python
name = payload.get('name', 'preset')
# → Could be 1MB of UTF-8 garbage
```
**Risque**: DoS via création de noms géants, bypass via caractères spéciaux.

**Recommandation**:
```python
MAX_PRESET_NAME = 64
if not name or len(name) > MAX_PRESET_NAME:
    raise ValueError(f"Preset name too long (max {MAX_PRESET_NAME})")
if not re.match(r'^[a-zA-Z0-9_-]+$', name):
    raise ValueError("Invalid characters in preset name")
```

---

### 3.2 🔴 CRITIQUE: YAML Arbitrary Code Execution Risk
**Fichier**: `backend/server.py` (ligne 394)
**Problème**: `yaml.safe_load()` est utilisé (✓ bon), mais pas de limite taille:
```python
yobj = yaml.safe_load(raw_yaml)  # raw_yaml peut être > 100MB
```
**Risque**: Attaque bomb (explosion exponentielle en parsing).

**Recommandation**:
```python
MAX_YAML_SIZE = 5 * 1024 * 1024  # 5 MB
if len(raw_yaml) > MAX_YAML_SIZE:
    raise web.HTTPBadRequest(text='YAML too large')

# Ajouter timeout
try:
    with timeout(5):  # 5 secondes
        yobj = yaml.safe_load(raw_yaml)
except asyncio.TimeoutError:
    raise web.HTTPBadRequest(text='YAML parsing timeout')
```

---

### 3.3 🟠 ÉLEVÉ: No Rate Limiting sur WS Commands
**Fichier**: `backend/server.py` (lignes 62-142)
**Problème**: Un client peut envoyer 10000 `set_channel_level` en 1 seconde sans limite.

**Risque**: Spam/DoS du serveur, saturation BD autosave.

**Recommandation**:
```python
# Dans websocket_handler:
msg_count = 0
reset_time = time.time()

# À chaque message:
msg_count += 1
if time.time() - reset_time > 1.0:
    msg_count = 0
    reset_time = time.time()
elif msg_count > 100:  # Max 100 msg/sec par client
    await ws.send_json({'type': 'error', 'payload': 'Rate limited'})
    continue
```

---

### 3.4 🟠 ÉLEVÉ: innerHTML Usage en Frontend (XSS Risk)
**Fichier**: `frontend/app.js` (lignes 266, 311, 439, 480, 487, 499)
**Problème**: Utilisation de `innerHTML` avec du contenu SVG:
```javascript
header.innerHTML = '<span class="ch-icon">' +
    '<svg ...>...</svg></span> CH ' + (i+1);
```
**Risque**: Si `i+1` provient d'une source non sûre, XSS possible.

**Recommandation** (bien que peu probable ici):
```javascript
const span = document.createElement('span');
span.className = 'ch-icon';
span.appendChild(svg);
header.appendChild(span);

const text = document.createTextNode(` CH ${i+1}`);
header.appendChild(text);
```

---

### 3.5 🟡 MODÉRÉ: No CORS Headers
**Fichier**: `backend/server.py`
**Problème**: Pas de réponse CORS, donc par défaut la même origin uniquement.

**Risque**: Si un frontend distant tente d'accéder = rejeté. Non dangereux, mais restrictif.

**Recommandation**: Ajouter middleware CORS si besoin d'accès cross-origin:
```python
from aiohttp_cors import setup, ResourceOptions

cors = setup(app, defaults={
    "*": ResourceOptions(allow_credentials=True, expose_headers="*")
})
```

---

### 3.6 🟡 MODÉRÉ: Preset Name Disclosure
**Fichier**: `backend/server.py` (lignes 329-331)
**Problème**: `list_presets()` expose tous les noms de preset sauvegardés:
```python
presets = app['presets'].list_presets()
return web.json_response({'presets': presets})
```
**Risque**: Faible, mais révèle la structure interne (ex: "autosave", "admin_mix").

---

## 4. PROBLÈMES DE MAINTENABILITÉ

### 4.1 🔴 CRITIQUE: Code Duplication Massive
**Lieux Multiples**:
- Validation channel: répétée 4 fois (lignes 74, 83, 90, 114)
- Parsing dB: répétée 3+ fois (lignes 75, 116, 168+)
- Exception handling: patterns différents partout

**Impact**: Bug fix dans 1 lieu = oubli dans 3 autres.

**Recommandation**: Extraire en fonctions réutilisables:
```python
def validate_channel(ch, mixer):
    if not isinstance(ch, int) or not (0 <= ch < len(mixer.channels)):
        raise ValueError(f"Invalid channel: {ch}")
    return ch

def parse_db(val, min_=-60, max_=12):
    f = float(val)
    if math.isnan(f) or math.isinf(f):
        raise ValueError("Invalid dB")
    return max(min_, min(max_, f))
```

---

### 4.2 🟠 ÉLEVÉ: Pas de Type Hints
**Fichier**: Tout (sauf annotations sporadiques)
**Problème**: `def save_preset(self, name, state):` - Quels types? Dict, List, None?

**Impact**: IDE autocomplete inefficace, bugs détectés tard.

**Recommandation**:
```python
from typing import Dict, List, Optional, Any

async def save_preset(self, name: str, state: Dict[str, Any]) -> str:
    ...

def validate_channel(ch: int, mixer: 'MixerState') -> int:
    ...
```

---

### 4.3 🟠 ÉLEVÉ: Magic Numbers Partout
**Fichier**: `backend/server.py`
- Ligne 48: `max(-60.0, min(12.0, ...))` ← -60 et 12 réutilisés 10+ fois
- Ligne 250: `0.2` (200ms interval)
- Ligne 246: `% 10` (status broadcast every 10 iterations)

**Impact**: Changer la plage dB = chercher 10+ locations.

**Recommandation**:
```python
class Config:
    MIN_LEVEL_DB = -60.0
    MAX_LEVEL_DB = 12.0
    LEVELS_BROADCAST_INTERVAL_SEC = 0.2
    CAMILLA_STATUS_BROADCAST_ITER = 10  # Every 10 * 0.2s = 2s
```

---

### 4.4 🟡 MODÉRÉ: Logging Incomplet
**Fichier**: Partout
**Problème**: Beaucoup de `pass` dans les `except`:
```python
except Exception:
    pass  # ← Silencieux!
```

**Impact**: Bugs impossibles à diagnostiquer.

**Recommandation**:
```python
except Exception as e:
    logger.warning(f"Failed to send to WebSocket: {e}", exc_info=True)
```

---

### 4.5 🟡 MODÉRÉ: Pas de Configuration Centralisée
**Fichier**: `backend/server.py`
**Problème**: Config spread dans le code:
- `DEFAULT_CHANNELS = 8`
- `host='0.0.0.0', port=8080`
- Pas de fichier `.env` ou `config.py`

**Recommandation**: Fichier `backend/config.py`:
```python
import os
from dataclasses import dataclass

@dataclass
class Config:
    CHANNELS: int = int(os.getenv('CHANNELS', 8))
    HOST: str = os.getenv('HOST', '0.0.0.0')
    PORT: int = int(os.getenv('PORT', 8080))
    LOG_LEVEL: str = os.getenv('LOG_LEVEL', 'INFO')
```

---

### 4.6 🟡 MODÉRÉ: Tests Fragmentés
**Fichier**: `tests/`
**Problème**: Tests existants sont basiques, pas de coverage `pytest --cov`.

**Recommandation**: Ajouter `.coveragerc`:
```ini
[run]
source = backend
omit = */__pycache__/*

[report]
exclude_lines =
    pragma: no cover
    def __repr__
    raise AssertionError
    raise NotImplementedError
```

---

## 5. RÉSUMÉ & PRIORITÉS

| Sévérité | Problème | Effort | Priorité |
|----------|---------|--------|----------|
| 🔴 | Path Traversal (preset names) | 30min | P0 |
| 🔴 | Integer/Float Validation | 1h | P0 |
| 🔴 | YAML Bomb DoS | 45min | P0 |
| 🔴 | Code Duplication (validation) | 2h | P1 |
| 🟠 | Rate Limiting WS | 1.5h | P1 |
| 🟠 | JSON Parse Error Handling | 30min | P1 |
| 🟠 | Type Hints | 3h | P2 |
| 🟠 | Broadcast O(n) optimization | 2h | P2 |
| 🟡 | Magic Numbers config | 1h | P2 |
| 🟡 | Logging | 1h | P2 |

---

## 6. QUICK WINS (< 30 minutes)

1. **Ajouter pathlib validation preset names** → ~15min
2. **Entourer json.load() dans try/except** → ~10min
3. **Ajouter MAX_YAML_SIZE check** → ~10min

---

**Fin du rapport**
