"""Documents — the documents of a project's company (logo, business card, brochures...), in one place.

Each project may list its documents in ``documents/documents.json`` (paths relative to the project):

    {"entreprise": "...", "documents": [{"id", "titre", "categorie", "format", "usage",
                                         "fichiers": {"fr": path, "en": path} or {"": path},
                                         "variantes": [{"label", "chemin"}], "sources": [...], "modifier": "how"}],
     "a_creer": [{"titre", "pourquoi", "demande"}]}

The page shows them (preview, download, print) and « Modifier » hands a request to the agent, with
where the sources are and how to rebuild the file."""
import hashlib
import json
import mimetypes
import subprocess
from pathlib import Path

import projects as P

MANIFEST = "documents/documents.json"
THUMBS = "documents/.apercus"
KINDS = {".pdf": "pdf", ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".svg": "image",
         ".html": "html", ".docx": "word", ".pptx": "slides", ".xlsx": "tableur"}


class DocError(Exception):
    pass


def _project(pid):
    p = next((x for x in P.all_projects() if x["id"] == pid), None)
    if not p or not p.get("path"):
        raise DocError("Projet introuvable")
    return p


def _manifest(root):
    f = Path(root) / MANIFEST
    if not f.is_file():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {"erreur": f"documents.json illisible : {e}", "documents": []}


def _pages(f):
    try:
        out = subprocess.run(["pdfinfo", str(f)], capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            if line.startswith("Pages:"):
                return int(line.split()[1])
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return None


def _file(root, rel, label=""):
    f = Path(root) / rel
    info = {"chemin": rel, "nom": f.name, "label": label, "type": KINDS.get(f.suffix.lower(), "fichier"),
            "existe": f.is_file()}
    if info["existe"]:
        st = f.stat()
        info.update(taille=st.st_size, modifie=int(st.st_mtime))
        if info["type"] == "pdf":
            info["pages"] = _pages(f)
    return info


def catalog(pid):
    """The documents of one project, each file checked on disk."""
    p = _project(pid)
    m = _manifest(p["path"])
    if m is None:
        return {"projet": p["name"], "projet_id": pid, "documents": [], "a_creer": [], "liste": False}
    docs = []
    for d in m.get("documents", []):
        files = {lang: _file(p["path"], rel) for lang, rel in (d.get("fichiers") or {}).items()}
        docs.append({**{k: d.get(k, "") for k in ("id", "titre", "categorie", "format", "usage", "modifier")},
                     "fichiers": files, "langues": [l for l in files if l],
                     "variantes": [_file(p["path"], v["chemin"], v.get("label", "")) for v in d.get("variantes", [])],
                     "sources": d.get("sources", [])})
    return {"projet": p["name"], "projet_id": pid, "entreprise": m.get("entreprise") or p["name"],
            "documents": docs, "a_creer": m.get("a_creer", []), "liste": True, "erreur": m.get("erreur")}


def overview():
    """Every project that has a documents list (for the page's project picker)."""
    out = []
    for p in P.all_projects():
        m = _manifest(p["path"]) if p.get("path") else None
        if m is not None:
            out.append({"id": p["id"], "projet": p["name"], "entreprise": m.get("entreprise") or p["name"],
                        "nb": len(m.get("documents", [])), "a_creer": len(m.get("a_creer", []))})
    return out


def _listed(pid, rel):
    """A file may be served only when the project's list names it (never any path of the disk)."""
    p = _project(pid)
    m = _manifest(p["path"]) or {}
    allowed = set()
    for d in m.get("documents", []):
        allowed.update((d.get("fichiers") or {}).values())
        allowed.update(v["chemin"] for v in d.get("variantes", []))
    if rel not in allowed:
        raise DocError("Ce fichier n'est pas dans la liste des documents")
    root = Path(p["path"]).resolve()
    f = (root / rel).resolve()
    if root not in f.parents or not f.is_file():
        raise DocError("Fichier introuvable")
    return p, f


def path(pid, rel):
    return _listed(pid, rel)[1]


def thumbnail(pid, rel, width=520):
    """A small JPEG of the first page / the image, cached next to the documents."""
    p, f = _listed(pid, rel)
    st = f.stat()
    key = hashlib.sha1(f"{rel}|{st.st_mtime}|{st.st_size}|{width}".encode()).hexdigest()[:16]
    cache = Path(p["path"]) / THUMBS
    out = cache / f"{key}.jpg"
    if out.is_file():
        return out
    cache.mkdir(parents=True, exist_ok=True)
    kind = KINDS.get(f.suffix.lower())
    if kind == "pdf":
        base = cache / key
        subprocess.run(["pdftoppm", "-jpeg", "-f", "1", "-l", "1", "-singlefile", "-scale-to", str(width), str(f), str(base)],
                       capture_output=True, timeout=30)
        if not out.is_file():
            raise DocError("Apercu impossible")
        return out
    if kind == "image" and f.suffix.lower() != ".svg":
        from PIL import Image
        with Image.open(f) as im:
            im = im.convert("RGBA")
            bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            bg.alpha_composite(im)
            bg = bg.convert("RGB")
            bg.thumbnail((width, width))
            bg.save(out, "JPEG", quality=82)
        return out
    raise DocError("Pas d'apercu pour ce type de fichier")


def mime(f):
    return mimetypes.guess_type(str(f))[0] or "application/octet-stream"


EDIT = ("Modifie le document « {titre} » de {entreprise} (page Documents de DevAgent).\n"
        "Fichier(s) actuel(s) : {fichiers}\n"
        "Sources : {sources}\n"
        "Comment il se fabrique : {modifier}\n\n"
        "Ce que je veux changer :\n{demande}\n\n"
        "Fais la modification dans les sources, regenere le ou les fichiers (toutes les langues concernees), "
        "verifie le resultat (apercu, nombre de pages, rien qui deborde), et mets a jour documents/documents.json si un "
        "fichier change de nom. Dis-moi en deux phrases ce qui a change.")

GENERAL = ("Demande sur les documents de {entreprise} (page Documents de DevAgent) :\n{demande}\n\n"
           "Les documents existants (details, sources et facon de les regenerer : documents_lister, ou documents/documents.json) :\n"
           "{liste}\n\nQuand tu modifies ou crees un document, regenere-le, verifie le resultat et tiens documents/documents.json a jour.")

CREATE = ("Nouveau document pour {entreprise} (page Documents de DevAgent) : « {titre} ».\n{demande}\n\n"
          "La liste des documents est dans documents/documents.json (relis-la pour le style et les chemins) : "
          "ajoute le nouveau document dans « documents » et retire-le de « a_creer ». Verifie le resultat avant de finir.")


def ask_agent(pid, demande, doc_id=None, create=None):
    """« Modifier » / « Creer » : a new conversation on the project, the agent gets everything it needs."""
    from . import chat
    demande = (demande or "").strip()
    cat = catalog(pid)
    if create is None and not doc_id:                     # the prompt at the top of the page: about any document
        if not demande:
            raise DocError("Ecris ta demande")
        lines = "\n".join(f"- {d['titre']} ({d['id']}) : " + ", ".join(f['chemin'] for f in d['fichiers'].values())
                          for d in cat["documents"])
        msg = GENERAL.format(entreprise=cat["entreprise"], liste=lines or "(aucun)", demande=demande)
        shown = demande
    elif create is not None:
        todo = next((a for a in cat["a_creer"] if a.get("titre") == create), None)
        if not todo:
            raise DocError("Document a creer introuvable")
        msg = CREATE.format(entreprise=cat["entreprise"], titre=todo["titre"],
                            demande=todo.get("demande", "") + (f"\n\nPrecisions : {demande}" if demande else ""))
        shown = f"Creer « {todo['titre']} »" + (f" : {demande}" if demande else "")
    else:
        doc = next((d for d in cat["documents"] if d["id"] == doc_id), None)
        if not doc:
            raise DocError("Document introuvable")
        if not demande:
            raise DocError("Ecris ce que tu veux changer")
        files = ", ".join(f"{l or 'fichier'} : {f['chemin']}" for l, f in doc["fichiers"].items())
        msg = EDIT.format(titre=doc["titre"], entreprise=cat["entreprise"], fichiers=files,
                          sources=", ".join(doc["sources"]) or "(aucune)", modifier=doc["modifier"] or "(non precise)",
                          demande=demande)
        shown = f"Modifier « {doc['titre']} » : {demande}"
    cid = chat.start(pid)["id"]
    out = chat.send(cid, msg, shown=shown)
    if not out.get("ok"):
        raise DocError(out.get("message") or "L'agent n'a pas pu recevoir la demande")
    return {"chat": cid}
