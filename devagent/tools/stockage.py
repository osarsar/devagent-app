"""Tools — file storage (Cloudflare R2) and the project's backups."""
import mimetypes

import cloud_sync
import cloudflare_r2
import db

from .. import RISK_IRREVERSIBLE, RISK_WRITE
from ..registry import PROJET, ToolError, tool
from ._common import checked, inside, resolve_project


def _client():
    c = cloud_sync._get_r2_client()
    if not c:
        raise ToolError("Le stockage R2 n'est pas configure (Reglages → Cloudflare R2). C'est toi qui saisis les cles.")
    return c


@tool("stockage_buckets", "Les buckets du compte Cloudflare R2.")
def stockage_buckets(ctx):
    return cloudflare_r2.r2_list_buckets(_client())


@tool("stockage_objets", "Les fichiers d'un bucket (avec un prefixe facultatif).",
      params={"bucket": {"type": "string"}, "prefixe": {"type": "string"},
              "max": {"type": "integer", "minimum": 1, "maximum": 1000}}, required=("bucket",))
def stockage_objets(ctx, bucket, prefixe="", max=200):
    return cloudflare_r2.r2_list_objects(_client(), bucket, prefix=prefixe or "", max_keys=max)


@tool("stockage_creer_bucket", "Cree un bucket R2. Avec 'projet', il devient le bucket de stockage du projet.",
      risk=RISK_WRITE, params={"nom": {"type": "string", "description": "minuscules, chiffres, tirets"},
                               "projet": PROJET}, required=("nom",))
def stockage_creer_bucket(ctx, nom, projet=None):
    target = resolve_project(ctx, projet) if projet else None
    out = {"bucket": checked(cloudflare_r2.r2_create_bucket(_client(), nom))}
    if target:
        import connections
        connections.save(target["id"], "storage", {"provider": "r2", "bucket": nom})
        out["projet"] = target["name"]
    return out


@tool("stockage_envoyer", "Envoie un fichier du projet vers un bucket.", risk=RISK_WRITE,
      params={"projet": PROJET, "fichier": {"type": "string", "description": "Chemin dans le projet"},
              "bucket": {"type": "string"}, "cle": {"type": "string", "description": "Nom dans le bucket"}},
      required=("fichier", "bucket"))
def stockage_envoyer(ctx, fichier, bucket, projet=None, cle=None):
    p = inside(resolve_project(ctx, projet), fichier)
    if not p.is_file():
        raise ToolError(f"Fichier introuvable : {fichier}")
    ctype = mimetypes.guess_type(p.name)[0] or ""
    return checked(cloudflare_r2.r2_upload_file(_client(), bucket, str(p), cle or p.name, content_type=ctype))


@tool("stockage_lien_temporaire", "Un lien de telechargement temporaire pour un fichier d'un bucket. "
      "Toute personne qui a le lien peut lire le fichier jusqu'a son expiration.", risk=RISK_WRITE,
      params={"bucket": {"type": "string"}, "cle": {"type": "string"},
              "duree_secondes": {"type": "integer", "minimum": 60, "maximum": 604800}},
      required=("bucket", "cle"))
def stockage_lien_temporaire(ctx, bucket, cle, duree_secondes=3600):
    return checked(cloudflare_r2.r2_get_presigned_url(_client(), bucket, cle, expires=duree_secondes))


@tool("stockage_supprimer_objet", "Supprime un fichier d'un bucket. Definitif.", risk=RISK_IRREVERSIBLE,
      params={"bucket": {"type": "string"}, "cle": {"type": "string"}}, required=("bucket", "cle"))
def stockage_supprimer_objet(ctx, bucket, cle):
    return checked(cloudflare_r2.r2_delete_object(_client(), bucket, cle))


# ── Backups ─────────────────────────────────────────────────────────────────

@tool("sauvegarde_etat", "Etat des sauvegardes d'un projet : dernier envoi vers GitHub et vers R2, bucket utilise.",
      params={"projet": PROJET})
def sauvegarde_etat(ctx, projet=None):
    pid = resolve_project(ctx, projet)["id"]
    return {"etat": checked(cloud_sync.get_sync_status(pid)), "bucket": cloud_sync.project_bucket(pid)}


@tool("sauvegarde_historique", "Les dernieres sauvegardes et restaurations d'un projet.",
      params={"projet": PROJET, "limite": {"type": "integer", "minimum": 1, "maximum": 200}})
def sauvegarde_historique(ctx, projet=None, limite=20):
    return db.get_sync_history(resolve_project(ctx, projet)["id"], limit=limite)


@tool("sauvegarde_lancer", "Sauvegarde maintenant les fichiers du projet vers son bucket R2 (selon ses regles).",
      risk=RISK_WRITE, params={"projet": PROJET})
def sauvegarde_lancer(ctx, projet=None):
    return checked(cloud_sync.sync_project_to_r2(resolve_project(ctx, projet)["id"]))


@tool("sauvegarde_restaurer", "Recopie dans le dossier du projet les fichiers sauvegardes sur R2. Les fichiers "
      "locaux du meme nom sont ecrases.", risk=RISK_IRREVERSIBLE, params={"projet": PROJET},
      required=("projet",))
def sauvegarde_restaurer(ctx, projet):
    return checked(cloud_sync.restore_from_r2(resolve_project(ctx, projet)["id"]))
