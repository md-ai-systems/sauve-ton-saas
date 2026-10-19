#!/usr/bin/env node
// La recherche des clés du skill Sauve Ton SaaS.
//
//   node chercher-cles.mjs [dossier du projet]      (par défaut : le dossier courant)
//
// Lit les fichiers du projet, ses fichiers .env et tout son historique git (toutes branches), et
// n'affiche de chaque clé que son service, ses quatre premiers caractères et où elle se trouve.
// Lecture seule : aucun fichier écrit, aucune commande git qui modifie, aucun accès à internet.
// Code de sortie : 0 quand la recherche a lu au moins un fichier, 2 sinon (une recherche qui n'a
// rien lu ne doit pas passer pour une recherche qui n'a rien trouvé).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// Le dossier du skill lui-même (installé dans le projet) n'est pas lu : ses exemples ne sont pas des clés.
const DOSSIER_SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const DOSSIERS_IGNORES = new Set(["node_modules", ".git", "dist", "build", ".next", ".vercel", ".turbo", "coverage", ".svelte-kit", ".output", "vendor"]);
const FICHIERS_IGNORES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|deno\.lock)$/;
const TAILLE_MAX = 2 * 1024 * 1024;
const PREFIXES_NAVIGATEUR = /^(VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_|GATSBY_)/;
const NOM_SECRET = /(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|API_KEY|APIKEY|TOKEN|WEBHOOK)/i;
const FACTICE = /(x{4,}|your|votre|exemple|example|changeme|placeholder|dummy|fake|faux|<|>|\.\.\.|…|\$\{|\*{3,})/i;

// Les formes de clés, de la plus précise à la plus générale : une valeur déjà reconnue n'est pas
// reprise par une forme plus large (sk-ant- avant sk-).
const FORMES = [
  { re: /sb_secret_[A-Za-z0-9_-]{20,}/g, service: "clé secrète Supabase", secret: true },
  { re: /sb_publishable_[A-Za-z0-9_-]{20,}/g, service: "clé publique Supabase", secret: false },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, jeton: true },
  { re: /sk_live_[A-Za-z0-9]{16,}/g, service: "clé secrète Stripe (paiements réels)", secret: true },
  { re: /sk_test_[A-Za-z0-9]{16,}/g, service: "clé secrète Stripe (mode test)", secret: true },
  { re: /rk_(?:live|test)_[A-Za-z0-9]{16,}/g, service: "clé restreinte Stripe", secret: true },
  { re: /whsec_[A-Za-z0-9]{16,}/g, service: "secret des notifications Stripe", secret: true },
  { re: /pk_(?:live|test)_[A-Za-z0-9]{16,}/g, service: "clé publique Stripe", secret: false },
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/g, service: "clé Anthropic", secret: true },
  { re: /sk-or-v1-[A-Za-z0-9]{20,}/g, service: "clé OpenRouter", secret: true },
  { re: /sk-proj-[A-Za-z0-9_-]{20,}/g, service: "clé OpenAI", secret: true },
  { re: /sk-[A-Za-z0-9]{32,}/g, service: "clé OpenAI", secret: true },
  { re: /gsk_[A-Za-z0-9]{30,}/g, service: "clé Groq", secret: true },
  { re: /r8_[A-Za-z0-9]{30,}/g, service: "clé Replicate", secret: true },
  { re: /AIza[0-9A-Za-z_-]{35}/g, service: "clé Google (publique pour Firebase, secrète pour Gemini ou Maps côté serveur)", secret: null },
  { re: /re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g, service: "clé Resend (e-mails)", secret: true },
  { re: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, service: "clé SendGrid (e-mails)", secret: true },
  { re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, service: "jeton GitHub", secret: true },
  { re: /github_pat_[A-Za-z0-9_]{30,}/g, service: "jeton GitHub", secret: true },
  { re: /AKIA[0-9A-Z]{16}/g, service: "clé AWS", secret: true },
  { re: /xox[abprs]-[A-Za-z0-9-]{10,}/g, service: "jeton Slack", secret: true },
  { re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, service: "clé privée", secret: true, entete: true },
  { re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@'"`]+:[^@\s'"`]{3,}@[^\s'"`/]+/g, service: "mot de passe de base écrit dans une adresse", secret: true, adresse: true },
];

function lireJeton(valeur) {
  try {
    const charge = JSON.parse(Buffer.from(valeur.split(".")[1], "base64url").toString("utf8"));
    if (charge.role === "service_role") return { service: "ancienne clé secrète Supabase (service_role)", secret: true };
    if (charge.role === "anon") return { service: "ancienne clé publique Supabase (anon)", secret: false };
    if (charge.role) return { service: `jeton (rôle ${charge.role})`, secret: null };
    return { service: "jeton", secret: null };
  } catch {
    return { service: "jeton", secret: null };
  }
}

// Ce qui est affiché d'une valeur : ses quatre premiers caractères, rien de plus.
function debut(valeur, forme) {
  if (forme.entete) return "-----";
  if (forme.adresse) return valeur.slice(0, valeur.indexOf("://") + 3) + "…";
  return `${valeur.slice(0, 4)}…`;
}

function estLocale(valeur) {
  return /@(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)[:/]/.test(valeur);
}

const trouvees = new Map(); // valeur -> { service, secret, debut, factice, local, fichiers:Set, historique:Set }
const fichiersEnv = [];

function noter(valeur, forme, ou, dansHistorique) {
  let info = trouvees.get(valeur);
  if (!info) {
    const detail = forme.jeton ? lireJeton(valeur) : { service: forme.service, secret: forme.secret };
    info = { ...detail, debut: debut(valeur, forme), factice: FACTICE.test(valeur), local: forme.adresse && estLocale(valeur), fichiers: new Set(), historique: new Set() };
    trouvees.set(valeur, info);
  }
  (dansHistorique ? info.historique : info.fichiers).add(ou);
}

function chercher(texte, ou, dansHistorique, ligneDepart = 1) {
  const lignes = texte.split("\n");
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    if (ligne.length > 20000) continue; // fichier minifié : une ligne géante, pas du code écrit
    const prises = [];
    for (const forme of FORMES) {
      for (const m of ligne.matchAll(forme.re)) {
        const fin = m.index + m[0].length;
        if (prises.some(([a, b]) => m.index < b && fin > a)) continue;
        prises.push([m.index, fin]);
        noter(m[0], forme, dansHistorique ? ou : `${ou}:${ligneDepart + i}`, dansHistorique);
      }
    }
  }
}

function git(racine, args) {
  const r = spawnSync("git", ["-C", racine, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

function parcourir(racine, dossier = racine, sortie = []) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!DOSSIERS_IGNORES.has(e.name)) parcourir(racine, path.join(dossier, e.name), sortie);
    } else if (e.isFile()) {
      sortie.push(path.relative(racine, path.join(dossier, e.name)).split(path.sep).join("/"));
    }
  }
  return sortie;
}

function lireTexte(chemin) {
  const stat = fs.statSync(chemin);
  if (stat.size > TAILLE_MAX) return null;
  const tampon = fs.readFileSync(chemin);
  if (tampon.subarray(0, 8000).includes(0)) return null;
  return tampon.toString("utf8");
}

// Les variables d'un fichier .env : leur nom, ce que contient la valeur, jamais la valeur.
function lireEnv(texte) {
  const variables = [];
  for (const ligne of texte.split("\n")) {
    const m = ligne.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const nom = m[1];
    const valeur = m[2].trim().replace(/^["']|["']$/g, "");
    if (!valeur) {
      variables.push({ nom, contenu: "vide" });
      continue;
    }
    let contenu = "autre valeur";
    let secret = null;
    for (const forme of FORMES) {
      forme.re.lastIndex = 0;
      const prise = valeur.match(forme.re);
      if (prise) {
        const d = forme.jeton ? lireJeton(prise[0]) : forme;
        contenu = d.service;
        secret = d.secret;
        break;
      }
    }
    if (contenu === "autre valeur") {
      if (/^https?:\/\//.test(valeur)) contenu = "adresse";
      else if (NOM_SECRET.test(nom)) {
        contenu = `valeur secrète probable (${valeur.slice(0, 4)}…)`;
        secret = true;
      }
    }
    if (FACTICE.test(valeur)) contenu += ", probablement factice";
    const navigateur = PREFIXES_NAVIGATEUR.test(nom);
    variables.push({ nom, contenu, navigateur, alerte: navigateur && secret === true });
  }
  return variables;
}

async function lireHistorique(racine) {
  return new Promise((resolve) => {
    const enfant = spawn("git", ["-C", racine, "log", "--all", "-p", "-U0", "--no-color", "--no-ext-diff", "--format=%x00%h %cs"], { windowsHide: true });
    const lecteur = readline.createInterface({ input: enfant.stdout, crlfDelay: Infinity });
    let commit = "";
    let fichier = "";
    let nombre = 0;
    lecteur.on("line", (ligne) => {
      if (ligne.startsWith("\u0000")) {
        commit = ligne.slice(1);
        nombre++;
      } else if (ligne.startsWith("+++ ")) {
        fichier = ligne.slice(4).replace(/^b\//, "");
      } else if (ligne.startsWith("+") && !FICHIERS_IGNORES.test(fichier)) {
        chercher(ligne.slice(1), `${commit} ${fichier}`, true);
      }
    });
    enfant.on("error", () => resolve(null));
    enfant.on("close", (code) => resolve(code === 0 ? nombre : null));
  });
}

async function principal() {
  const racine = path.resolve(process.argv[2] || ".");
  if (!fs.existsSync(racine) || !fs.statSync(racine).isDirectory()) {
    console.error(`Dossier introuvable : ${racine}`);
    process.exit(2);
  }
  const avecGit = git(racine, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";

  // Les fichiers du projet : ceux que git suit ou ne cache pas, et tous les .env, même ignorés,
  // parce qu'une variable VITE_ d'un .env ignoré part quand même chez les visiteurs à la construction.
  let fichiers = avecGit ? git(racine, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean) : parcourir(racine);
  const suivis = avecGit ? new Set(git(racine, ["ls-files", "-z"]).split("\0").filter(Boolean)) : new Set();
  const envs = parcourir(racine).filter((f) => /(^|\/)\.env(\.|$)/.test(f));
  const horsSkill = (f) => !path.join(racine, f).startsWith(DOSSIER_SKILL + path.sep);
  fichiers = [...new Set([...fichiers, ...envs])].filter((f) => !FICHIERS_IGNORES.test(f) && horsSkill(f) && fs.existsSync(path.join(racine, f)));

  let lus = 0;
  for (const f of fichiers) {
    const texte = lireTexte(path.join(racine, f));
    if (texte === null) continue;
    lus++;
    chercher(texte, f, false);
    if (/(^|\/)\.env(\.|$)/.test(f)) {
      const ignore = avecGit && spawnSync("git", ["-C", racine, "check-ignore", "-q", f]).status === 0;
      fichiersEnv.push({ chemin: f, enregistre: suivis.has(f), ignore, variables: lireEnv(texte) });
    }
  }
  const commits = avecGit ? await lireHistorique(racine) : null;

  const sortie = [];
  const historique = !avecGit ? "pas d'historique git" : commits === null ? "historique illisible" : `${commits} enregistrements de l'historique lus`;
  sortie.push(`RECHERCHE DES CLÉS · ${lus} fichiers lus · ${historique}`);
  sortie.push("Chaque clé n'est montrée que par ses quatre premiers caractères.", "");

  sortie.push("CLÉS TROUVÉES");
  const liste = [...trouvees.values()].sort((a, b) => (b.secret === true) - (a.secret === true));
  if (!liste.length) sortie.push("Aucune.");
  for (const c of liste) {
    const genre = c.secret === true ? "SECRÈTE" : c.secret === false ? "publique" : "à regarder";
    const notes = [c.factice && "probablement factice", c.local && "base locale"].filter(Boolean);
    sortie.push(`- ${genre} · ${c.service} · ${c.debut}${notes.length ? ` · ${notes.join(", ")}` : ""}`);
    if (c.fichiers.size) sortie.push(`  dans les fichiers : ${[...c.fichiers].slice(0, 8).join(", ")}${c.fichiers.size > 8 ? ` et ${c.fichiers.size - 8} autres` : ""}`);
    else sortie.push("  dans les fichiers : plus nulle part, mais encore lisible dans l'historique");
    if (c.historique.size) sortie.push(`  dans l'historique : ${[...c.historique].slice(0, 6).join(", ")}${c.historique.size > 6 ? ` et ${c.historique.size - 6} autres` : ""}`);
  }

  sortie.push("", "FICHIERS .env");
  if (!fichiersEnv.length) sortie.push("Aucun.");
  for (const e of fichiersEnv) {
    const etat = e.enregistre ? "ENREGISTRÉ dans le projet (chaque copie le contient)" : e.ignore ? "ignoré par git" : "ni enregistré ni ignoré";
    sortie.push(`- ${e.chemin} · ${etat}`);
    for (const v of e.variables) {
      const navigateur = v.navigateur ? (v.alerte ? " · ENVOYÉE AU NAVIGATEUR" : " · envoyée au navigateur") : "";
      sortie.push(`  ${v.nom} : ${v.contenu}${navigateur}`);
    }
  }

  if (avecGit) {
    sortie.push("", "DÉPÔTS DISTANTS");
    const distants = [...new Set((git(racine, ["remote", "-v"]) || "").split("\n").filter(Boolean).map((l) => {
      const [nom, adresse] = l.split(/\s+/);
      return `${nom} : ${adresse.replace(/\/\/[^@/]+@/, "//")}`;
    }))];
    sortie.push(...(distants.length ? distants.map((d) => `- ${d}`) : ["Aucun : le projet n'a pas de copie déclarée ailleurs."]));
  }

  console.log(sortie.join("\n"));
  process.exit(lus > 0 ? 0 : 2);
}

await principal();
