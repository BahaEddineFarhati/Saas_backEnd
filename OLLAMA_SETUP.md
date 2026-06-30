# Configuration Ollama - Guide d'installation et de lancement

## 1. Installation d'Ollama

### Téléchargement
- **Windows/Mac/Linux**: https://ollama.ai
- Téléchargez et installez l'application

### Vérification de l'installation
```bash
ollama --version
```

---

## 2. Modèles Ollama disponibles pour le parsing CV

### Option 1 : llama3.2 (Recommandé pour local)

#### Variantes de tailles :

| Modèle | Paramètres | Taille disque | RAM nécessaire | Vitesse | Qualité |
|--------|-----------|---------------|----------------|---------|---------|
| `llama3.2:1b` | 1 milliard | ~640 MB | 2-4 GB | ⚡ Très rapide | ⭐ Basique |
| `llama3.2:3b` | 3.2 milliards | ~2 GB | 4-8 GB | ⚡ Rapide | ⭐⭐ Bonne | 
| `llama3.2:8b` | 8 milliards | ~4.7 GB | 8-16 GB | ⚡ Moyen | ⭐⭐⭐ Très bonne |
| `llama3.2:70b` | 70 milliards | ~40 GB | 32+ GB | 🐢 Lent | ⭐⭐⭐⭐⭐ Excellente |

**Pour local dev: recommandé `llama3.2:3b` ou `llama3.2:8b`**

---

### Option 2 : Autres modèles disponibles

```bash
# Mistral (plus rapide que llama)
ollama pull mistral:7b

# Neural Chat (spécialisé pour dialogue)
ollama pull neural-chat:7b

# Orca2 (bon pour tasks structurées)
ollama pull orca2:13b

# Phi (très léger, rapide)
ollama pull phi:2.7b
```

---

## 3. Téléchargement du modèle

### Étape 1 : Choisir une variante
```bash
# Pour CV parsing, recommandé :
ollama pull llama3.2:3b
```

### Étape 2 : Vérifier le téléchargement
```bash
# Lister tous les modèles téléchargés
ollama list
```

Résultat attendu :
```
NAME            ID              SIZE      MODIFIED
llama3.2:3b     a80c4f17acd5    2.0 GB    2 minutes ago
```

---

## 4. Lancer Ollama

### Option A : En ligne de commande (recommandé pour dev)
```bash
ollama serve
```

**Sortie attendue :**
```
2026/06/23 15:52:04 routes.go:1109: listening on 127.0.0.1:11434
```

Le serveur écoute sur : **http://localhost:11434**

### Option B : Application Windows
- Lancez l'app Ollama depuis le menu Démarrer
- Elle tourne en arrière-plan
- L'icône apparaît dans la barre de tâche

---

## 5. Vérifier que tout fonctionne

### Test 1 : Ping du serveur
```bash
curl http://localhost:11434/api/tags
```

Résultat attendu :
```json
{
  "models": [
    {
      "name": "llama3.2:3b",
      "model": "llama3.2:3b",
      ...
    }
  ]
}
```

### Test 2 : Faire une requête au modèle
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "Bonjour, qui es-tu?"
}'
```

---

## 6. Configuration dans l'application

### Fichier : `.env`

```env
# LLM Configuration
LLM_PROVIDER=local

# Local Ollama
LLM_LOCAL_URL=http://localhost:11434
LLM_LOCAL_MODEL=llama3.2:3b    # Changez selon le modèle choisi
```

---

## 7. Dépannage

### Erreur : "Port 11434 already in use"
**Solution** : Ollama est déjà en cours d'exécution. C'est bon signe!

### Erreur : "Connection refused to localhost:11434"
**Solution** : Lancez `ollama serve` ou l'application Ollama

### Erreur : "Model not found"
**Solution** : Téléchargez le modèle avec `ollama pull llama3.2:3b`

### Le modèle est trop lent
**Solution** : Utilisez une version plus petite (`1b` ou `3b`)

### Le modèle consomme trop de RAM
**Solution** : Utilisez `llama3.2:1b` ou réduisez autres applications

---

## 8. Recommandations finales

| Cas d'usage | Modèle recommandé | Raison |
|-------------|-------------------|--------|
| **Laptop faible** | `llama3.2:1b` | Consomme ~2-4 GB RAM |
| **Laptop standard** | `llama3.2:3b` | Équilibre vitesse/qualité |
| **PC puissant** | `llama3.2:8b` | Meilleure qualité |
| **Serveur** | `llama3.2:8b` ou `70b` | Production |

**Pour ce projet (parsing CV) : `llama3.2:3b` est optimal** ✅

