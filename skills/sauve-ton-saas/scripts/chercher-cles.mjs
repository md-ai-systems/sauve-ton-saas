#!/usr/bin/env node
// La recherche des clés du skill Sauve Ton SaaS.
//
//   node chercher-cles.mjs [dossier du projet]      (par défaut : le dossier courant)
//
// Lit les fichiers du projet, ses fichiers .env et tout son historique git (toutes branches), et
// ne montre jamais une valeur en entier : de chaque clé reconnue, son service, le début de sa forme
// (son préfixe connu et deux caractères au plus) et où elle se trouve ; d'une valeur générique,
// seulement sa longueur.
// Lecture seule : aucun fichier écrit, aucune commande git qui modifie, aucun accès à internet, et
// git ne lance aucun programme du dépôt (le dépôt peut être piégé).
// Rien n'est sauté en silence : les fichiers lus en partie ou sautés sont comptés et nommés à la fin.
// Code de sortie : 0 quand la recherche a lu au moins un fichier, 2 sinon (une recherche qui n'a
// rien lu ne doit pas passer pour une recherche qui n'a rien trouvé), et 2 aussi quand le dossier
// n'a pas l'air d'être la racine d'un projet.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

// Le dossier du skill lui-même (installé dans le projet) n'est pas lu : ses exemples ne sont pas des clés.
const DOSSIER_SKILL = (() => {
  const dossier = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    return fs.realpathSync(dossier);
  } catch {
    return dossier;
  }
})();

const DOSSIERS_IGNORES = new Set(["node_modules", ".git", "dist", "build", ".next", ".vercel", ".turbo", "coverage", ".svelte-kit", ".output", "vendor"]);
const FICHIERS_IGNORES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|deno\.lock)$/;
const PREFIXES_NAVIGATEUR = /^(VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_|GATSBY_)/;
const NOM_SECRET = /(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|API_KEY|APIKEY|TOKEN|WEBHOOK)/i;
const FACTICE = /(x{4,}|your|votre|exemple|example|changeme|placeholder|dummy|fake|faux|<|>|\.\.\.|…|\$\{|\*{3,})/i;

// Un fichier plus gros que cette limite n'est lu que jusque-là, puis signalé à la fin.
const LIMITE_LECTURE = 8 * 1024 * 1024;
const LIMITE_LECTURE_TEXTE = "8 Mo";
// Une ligne plus longue que la fenêtre est cherchée par morceaux qui se chevauchent. Le
// chevauchement dépasse la plus longue forme de clé (moins de 3 400 caractères, voir FORMES) :
// une clé coupée par le bord d'un morceau est entière dans le suivant.
const FENETRE = 20000;
const RECOUVREMENT = 4096;
// Dans l'historique, une ligne qui n'en finit pas n'est pas gardée en mémoire : elle est passée
// par morceaux, avec le même chevauchement.
const PLAFOND_FLUX = 256 * 1024;
// Combien de noms au plus sont écrits pour chaque sorte de fichier sauté.
const NOMS_PAR_SORTE = 10;

// Les formes de clés, de la plus précise à la plus générale : une valeur déjà reconnue n'est pas
// reprise par une forme plus large (sk-ant- avant sk-). Tous les quantificateurs sont bornés pour
// qu'aucune ligne ne demande un temps qui explose ; `prefixe` est le début connu de la forme, le
// seul qui puisse être montré (avec deux caractères de plus).
const FORMES = [
  { re: /sb_secret_[A-Za-z0-9_-]{20,300}/g, prefixe: /^sb_secret_/, service: "clé secrète Supabase", secret: true },
  { re: /sb_publishable_[A-Za-z0-9_-]{20,300}/g, prefixe: /^sb_publishable_/, service: "clé publique Supabase", secret: false },
  { re: /eyJ[A-Za-z0-9_-]{10,300}\.eyJ[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,1000}/g, prefixe: /^eyJ/, jeton: true },
  { re: /sk_live_[A-Za-z0-9]{16,300}/g, prefixe: /^sk_live_/, service: "clé secrète Stripe (paiements réels)", secret: true },
  { re: /sk_test_[A-Za-z0-9]{16,300}/g, prefixe: /^sk_test_/, service: "clé secrète Stripe (mode test)", secret: true },
  { re: /rk_(?:live|test)_[A-Za-z0-9]{16,300}/g, prefixe: /^rk_(?:live|test)_/, service: "clé restreinte Stripe", secret: true },
  { re: /whsec_[A-Za-z0-9]{16,300}/g, prefixe: /^whsec_/, service: "secret des notifications Stripe", secret: true },
  { re: /pk_(?:live|test)_[A-Za-z0-9]{16,300}/g, prefixe: /^pk_(?:live|test)_/, service: "clé publique Stripe", secret: false },
  { re: /sk-ant-[A-Za-z0-9_-]{20,400}/g, prefixe: /^sk-ant-/, service: "clé Anthropic", secret: true },
  { re: /sk-or-v1-[A-Za-z0-9]{20,300}/g, prefixe: /^sk-or-v1-/, service: "clé OpenRouter", secret: true },
  { re: /sk-proj-[A-Za-z0-9_-]{20,500}/g, prefixe: /^sk-proj-/, service: "clé OpenAI", secret: true },
  { re: /sk-[A-Za-z0-9]{32,300}/g, prefixe: /^sk-/, service: "clé OpenAI", secret: true },
  { re: /gsk_[A-Za-z0-9]{30,300}/g, prefixe: /^gsk_/, service: "clé Groq", secret: true },
  { re: /r8_[A-Za-z0-9]{30,300}/g, prefixe: /^r8_/, service: "clé Replicate", secret: true },
  { re: /AIza[0-9A-Za-z_-]{35}/g, prefixe: /^AIza/, service: "clé Google (publique pour Firebase, secrète pour Gemini ou Maps côté serveur)", secret: null },
  { re: /re_[A-Za-z0-9]{8,100}_[A-Za-z0-9]{8,200}/g, prefixe: /^re_/, service: "clé Resend (e-mails)", secret: true },
  { re: /SG\.[A-Za-z0-9_-]{16,200}\.[A-Za-z0-9_-]{16,200}/g, prefixe: /^SG\./, service: "clé SendGrid (e-mails)", secret: true },
  { re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,300}/g, prefixe: /^gh[pousr]_/, service: "jeton GitHub", secret: true },
  { re: /github_pat_[A-Za-z0-9_]{30,300}/g, prefixe: /^github_pat_/, service: "jeton GitHub", secret: true },
  { re: /AKIA[0-9A-Z]{16}/g, prefixe: /^AKIA/, service: "clé AWS", secret: true },
  { re: /xox[abprs]-[A-Za-z0-9-]{10,200}/g, prefixe: /^xox[abprs]-/, service: "jeton Slack", secret: true },
  { re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, service: "clé privée", secret: true, entete: true },
  { re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@'"`]{1,128}:[^@\s'"`]{3,512}@[^\s'"`/]{1,255}/g, service: "mot de passe de base écrit dans une adresse", secret: true, adresse: true },
];

// Tout ce qui vient d'un projet inconnu (noms de fichiers, noms de dépôts, valeurs lues) est écrit
// échappé, entre guillemets : un nom ne peut ni envoyer un code au terminal ni fabriquer une
// fausse ligne du rapport. JSON.stringify échappe les codes de 0 à 31 ; le reste (suppression,
// codes de contrôle de 128 à 159, séparateurs de ligne et marques de sens d'écriture) l'est ici.
function echapper(texte) {
  return JSON.stringify(String(texte)).replace(/[\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
const sansGuillemets = (texte) => echapper(texte).slice(1, -1);

function lireJeton(valeur) {
  try {
    const charge = JSON.parse(Buffer.from(valeur.split(".")[1], "base64url").toString("utf8"));
    if (charge.role === "service_role") return { service: "ancienne clé secrète Supabase (service_role)", secret: true };
    if (charge.role === "anon") return { service: "ancienne clé publique Supabase (anon)", secret: false };
    if (charge.role) return { service: `jeton (rôle ${sansGuillemets(String(charge.role).slice(0, 40))})`, secret: null };
    return { service: "jeton", secret: null };
  } catch {
    return { service: "jeton", secret: null };
  }
}

// Ce qui est affiché d'une clé reconnue : son préfixe connu et deux caractères de plus, jamais davantage.
function debut(valeur, forme) {
  if (forme.entete) return "-----";
  if (forme.adresse) return valeur.slice(0, valeur.indexOf("://") + 3) + "…";
  const prefixe = valeur.match(forme.prefixe)?.[0] ?? "";
  return `${valeur.slice(0, prefixe.length + 2)}…`;
}

function estLocale(valeur) {
  return /@(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)[:/]/.test(valeur);
}

const trouvees = new Map(); // valeur -> { service, secret, debut, factice, local, fichiers:Set, historique:Set }
const fichiersEnv = [];

// Ce que la recherche n'a pas pu lire en entier : rien n'est sauté sans que ce soit écrit à la fin.
const bilan = {
  partiels: [], // fichiers dont seul le début a été lu
  sautes: new Map(), // sorte -> noms
  dossiers: [], // dossiers illisibles
  ignores: new Set(), // dossiers laissés de côté exprès quand git ne donne pas la liste
  verrous: 0,
  duSkill: 0,
};
function sauter(sorte, nom) {
  if (!bilan.sautes.has(sorte)) bilan.sautes.set(sorte, []);
  bilan.sautes.get(sorte).push(nom);
}

function noter(valeur, forme, ou, dansHistorique) {
  let info = trouvees.get(valeur);
  if (!info) {
    const detail = forme.jeton ? lireJeton(valeur) : { service: forme.service, secret: forme.secret };
    info = { ...detail, debut: debut(valeur, forme), factice: FACTICE.test(valeur), local: forme.adresse && estLocale(valeur), fichiers: new Set(), historique: new Set() };
    trouvees.set(valeur, info);
  }
  (dansHistorique ? info.historique : info.fichiers).add(ou);
}

// Cherche dans un morceau de texte d'une seule ligne. `suite` dit que la ligne continue après ce
// morceau : une valeur qui touche le bord peut être coupée, elle est reprise entière dans le morceau suivant.
function chercherMorceau(morceau, ou, dansHistorique, suite) {
  const prises = [];
  for (const forme of FORMES) {
    for (const m of morceau.matchAll(forme.re)) {
      const fin = m.index + m[0].length;
      if (suite && fin >= morceau.length) continue;
      if (prises.some(([a, b]) => m.index < b && fin > a)) continue;
      prises.push([m.index, fin]);
      noter(m[0], forme, ou, dansHistorique);
    }
  }
}

// Une ligne de n'importe quelle longueur : par morceaux qui se chevauchent quand elle dépasse la fenêtre.
function chercherLigne(ligne, ou, dansHistorique, suite = false) {
  if (ligne.length <= FENETRE) {
    chercherMorceau(ligne, ou, dansHistorique, suite);
    return;
  }
  for (let debutMorceau = 0; ; debutMorceau += FENETRE - RECOUVREMENT) {
    const fin = Math.min(debutMorceau + FENETRE, ligne.length);
    const dernier = fin >= ligne.length;
    chercherMorceau(ligne.slice(debutMorceau, fin), ou, dansHistorique, dernier ? suite : true);
    if (dernier) break;
  }
}

// Le texte d'un fichier, coupé sur \n seulement : un \r au milieu d'une ligne ne la sépare pas.
function chercherFichier(texte, chemin) {
  const nom = echapper(chemin);
  let numero = 0;
  for (let debutLigne = 0; debutLigne <= texte.length; ) {
    let fin = texte.indexOf("\n", debutLigne);
    if (fin === -1) fin = texte.length;
    numero++;
    chercherLigne(texte.slice(debutLigne, fin), `${nom}:${numero}`, false);
    debutLigne = fin + 1;
  }
}

// Git ne doit rien exécuter ni rien télécharger, même dans un dépôt piégé : pas de programme de
// surveillance des fichiers, pas de crochets, pas de pager, aucun protocole réseau, aucun
// téléchargement paresseux d'objets manquants (clone partiel), aucune question posée au terminal.
const OPTIONS_GIT = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat", "-c", "protocol.allow=never"];
const ENV_GIT = { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
const argsGit = (racine, args) => [...OPTIONS_GIT, "-C", racine, ...args];

// Le texte rendu par git, ou null quand l'appel échoue (index abîmé, git absent, dépôt refusé).
function git(racine, args) {
  const r = spawnSync("git", argsGit(racine, args), { encoding: "utf8", env: ENV_GIT, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return !r.error && r.status === 0 ? r.stdout : null;
}

// Les fichiers du dossier, sans suivre aucun lien. Un dossier illisible est sauté et compté.
function parcourir(racine) {
  const fichiers = [];
  const pile = [""];
  while (pile.length) {
    const dossier = pile.pop();
    let entrees;
    try {
      entrees = fs.readdirSync(path.join(racine, dossier), { withFileTypes: true });
    } catch {
      bilan.dossiers.push(dossier || ".");
      continue;
    }
    for (const e of entrees) {
      const relatif = dossier ? `${dossier}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (DOSSIERS_IGNORES.has(e.name)) bilan.ignores.add(e.name);
        else pile.push(relatif);
      } else if (e.isFile() || e.isSymbolicLink()) {
        fichiers.push(relatif);
      }
    }
  }
  return fichiers.sort();
}

const O_LECTURE = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

// Lit un fichier du projet. Rend { texte, partiel } ou { sorte } quand il n'est pas lu : un lien,
// un fichier chemin réel hors du projet (un dossier remplacé par un lien vers l'extérieur),
// un fichier spécial, un binaire ou un fichier illisible.
function lireFichier(racine, relatif) {
  const chemin = path.join(racine, relatif);
  let reel;
  try {
    reel = fs.realpathSync.native(chemin);
  } catch (e) {
    return { sorte: e.code === "ENOENT" || e.code === "ENOTDIR" ? "absents du disque (encore listés par git)" : "illisibles" };
  }
  if (reel !== racine && !reel.startsWith(racine + path.sep)) return { sorte: "chemin réel hors du projet" };
  let fd;
  try {
    if (fs.lstatSync(chemin).isSymbolicLink()) return { sorte: "liens symboliques" };
    fd = fs.openSync(reel, O_LECTURE);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return { sorte: "ni fichiers ni dossiers ordinaires" };
    const entete = Buffer.alloc(Math.min(stat.size, 8000));
    const luEntete = fs.readSync(fd, entete, 0, entete.length, 0);
    if (entete.subarray(0, luEntete).includes(0)) return { sorte: "binaires" };
    const taille = Math.min(stat.size, LIMITE_LECTURE);
    const tampon = Buffer.alloc(taille);
    let lu = 0;
    while (lu < taille) {
      const n = fs.readSync(fd, tampon, lu, taille - lu, lu);
      if (n === 0) break;
      lu += n;
    }
    return { texte: tampon.subarray(0, lu).toString("utf8"), partiel: stat.size > LIMITE_LECTURE };
  } catch {
    return { sorte: "illisibles" };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // rien à faire : le fichier est déjà fermé
      }
    }
  }
}

// Les variables d'un fichier .env : leur nom, ce que contient la valeur, jamais la valeur.
// Les lignes se coupent comme le fait dotenv : \n, \r\n ou \r seul.
function lireEnv(texte) {
  const variables = [];
  for (const ligne of texte.split(/\r\n?|\n/)) {
    const m = ligne.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\r\n]*)$/);
    if (!m) continue;
    const nom = m[1].length > 80 ? `${m[1].slice(0, 80)}…` : m[1];
    const valeur = m[2].trim().replace(/^["']|["']$/g, "");
    if (!valeur) {
      variables.push({ nom, contenu: "vide" });
      continue;
    }
    let contenu = "autre valeur";
    let secret = null;
    for (const forme of FORMES) {
      const prise = valeur.slice(0, FENETRE).match(forme.re);
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
        contenu = `valeur secrète probable (valeur de ${valeur.length} caractères)`;
        secret = true;
      }
    }
    if (FACTICE.test(valeur.slice(0, FENETRE))) contenu += ", probablement factice";
    const navigateur = PREFIXES_NAVIGATEUR.test(nom);
    variables.push({ nom, contenu, navigateur, alerte: navigateur && secret === true });
  }
  return variables;
}

// Un chemin tel que git l'écrit entre guillemets (\n, \t, \", \\ et \303\251 en octal) : le texte et sa fin.
function lireEntreGuillemets(s) {
  const octets = [];
  const simples = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, "\\": 92 };
  let i = 1;
  while (i < s.length && s[i] !== '"') {
    if (s[i] === "\\" && i + 1 < s.length) {
      const octal = s.slice(i + 1).match(/^[0-7]{1,3}/);
      if (octal) {
        octets.push(parseInt(octal[0], 8) & 255);
        i += 1 + octal[0].length;
      } else {
        octets.push(simples[s[i + 1]] ?? s.charCodeAt(i + 1));
        i += 2;
      }
    } else {
      const point = s.codePointAt(i);
      octets.push(...Buffer.from(String.fromCodePoint(point)));
      i += point > 0xffff ? 2 : 1;
    }
  }
  return { valeur: Buffer.from(octets).toString("utf8"), fin: i + 1 };
}

// Le nom du fichier d'une ligne « diff --git a/… b/… » (ce qui suit « diff --git »).
function nomDepuisEntete(reste) {
  const sansPrefixe = (nom) => nom.replace(/^b\//, "");
  if (reste.startsWith('"')) {
    const { fin } = lireEntreGuillemets(reste);
    const second = reste.slice(fin).replace(/^ /, "");
    return sansPrefixe(second.startsWith('"') ? lireEntreGuillemets(second).valeur : second);
  }
  const guillemets = reste.indexOf(' "b/');
  if (guillemets !== -1) return sansPrefixe(lireEntreGuillemets(reste.slice(guillemets + 1)).valeur);
  // Sans guillemets : « a/X b/X ». Quand le nom ne change pas, les deux moitiés sont égales.
  const milieu = (reste.length - 1) / 2;
  if (Number.isInteger(milieu) && reste.startsWith("a/") && reste.slice(milieu, milieu + 3) === " b/" && reste.slice(2, milieu) === reste.slice(milieu + 3)) {
    return reste.slice(2, milieu);
  }
  const i = reste.lastIndexOf(" b/");
  return i === -1 ? reste : reste.slice(i + 3);
}

// Le nom du fichier d'une ligne « +++ b/… » (ce qui suit « +++ »). null pour un fichier supprimé.
function nomDepuisPlus(reste) {
  if (reste === "/dev/null") return null;
  if (reste.startsWith('"')) return lireEntreGuillemets(reste).valeur.replace(/^b\//, "");
  return reste.replace(/\t.*$/s, "").replace(/^b\//, "");
}

// Passe un flux en lignes coupées sur \n seulement. Une ligne trop longue est passée par morceaux
// (avec un chevauchement) : surLigne(texte, debutDeLigne, laLigneContinue).
function lireLignes(flux, surLigne) {
  const decodeur = new StringDecoder("utf8");
  let reste = "";
  let ouverte = false; // un morceau de la ligne en cours est déjà passé
  flux.on("data", (donnees) => {
    reste += decodeur.write(donnees);
    let debutLigne = 0;
    for (let fin = reste.indexOf("\n"); fin !== -1; fin = reste.indexOf("\n", debutLigne)) {
      surLigne(reste.slice(debutLigne, fin), !ouverte, false);
      ouverte = false;
      debutLigne = fin + 1;
    }
    reste = reste.slice(debutLigne);
    if (reste.length > PLAFOND_FLUX) {
      surLigne(reste, !ouverte, true);
      ouverte = true;
      reste = reste.slice(-RECOUVREMENT);
    }
  });
  flux.on("end", () => {
    reste += decodeur.end();
    if (reste.length || ouverte) surLigne(reste, !ouverte, false);
  });
}

// Tout l'historique. Le fichier en cours ne vient que d'une ligne « diff --git » ou d'une ligne
// « +++ » placée entre cette ligne et le premier « @@ » : plus loin, une ligne qui commence par
// « +++ » est du contenu ajouté, pas un en-tête.
async function lireHistorique(racine) {
  return new Promise((resolve) => {
    let enfant;
    try {
      enfant = spawn(
        "git",
        argsGit(racine, ["log", "--all", "-p", "-U0", "--no-color", "--no-textconv", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--format=%x00%h %cs"]),
        { env: ENV_GIT, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      );
    } catch {
      resolve(null);
      return;
    }
    let commit = "";
    let fichier = "";
    let nombre = 0;
    let enTete = false; // entre « diff --git » et le premier « @@ »
    let ajout = false; // la ligne en cours est une ligne ajoutée
    let ou = "";
    lireLignes(enfant.stdout, (texte, debutDeLigne, suite) => {
      if (debutDeLigne) {
        ajout = false;
        if (texte.charCodeAt(0) === 0) {
          commit = texte.slice(1);
          nombre++;
          fichier = "";
          enTete = false;
          return;
        }
        if (texte.startsWith("diff --git ")) {
          fichier = nomDepuisEntete(texte.slice(11));
          enTete = true;
          return;
        }
        if (enTete && texte.startsWith("+++ ")) {
          const nom = nomDepuisPlus(texte.slice(4));
          if (nom !== null) fichier = nom;
          return;
        }
        if (texte.startsWith("@@")) {
          enTete = false;
          return;
        }
        if (enTete || texte[0] !== "+") return;
        ajout = true;
        ou = `${commit} ${echapper(fichier)}`;
        if (!FICHIERS_IGNORES.test(fichier)) chercherLigne(texte.slice(1), ou, true, suite);
      } else if (ajout && !FICHIERS_IGNORES.test(fichier)) {
        chercherLigne(texte, ou, true, suite);
      }
    });
    enfant.on("error", () => resolve(null));
    enfant.on("close", (code) => resolve(code === 0 ? nombre : null));
  });
}

// Une adresse de dépôt réduite à l'hôte et au chemin : ni identifiants (même avec un « / » ou un
// « @ » dans le mot de passe), ni paramètres, ni fragment.
function reduireAdresse(brut) {
  const adresse = brut.trim();
  const schema = adresse.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
  let reduite;
  if (schema) {
    let reste = adresse.slice(schema[0].length);
    reste = reste.slice(reste.lastIndexOf("@") + 1);
    reduite = `${schema[1]}://${reste.split(/[?#]/)[0]}`;
  } else if (/^[/.~]/.test(adresse)) {
    reduite = adresse.split(/[?#]/)[0];
  } else {
    // Forme scp : [utilisateur@]hôte:chemin
    const m = adresse.match(/^(?:[^@\s]*@)?([^@:/\s]+):(.*)$/s);
    reduite = m ? `${m[1]}:${m[2].split(/[?#]/)[0]}` : adresse.slice(adresse.lastIndexOf("@") + 1).split(/[?#]/)[0];
  }
  return sansGuillemets(reduite);
}

function listeDeNoms(noms) {
  const montres = noms.slice(0, NOMS_PAR_SORTE).map(echapper).join(", ");
  return noms.length > NOMS_PAR_SORTE ? `${montres} et ${noms.length - NOMS_PAR_SORTE} autres` : montres;
}
const fichiersEn = (n) => `${n} fichier${n > 1 ? "s" : ""}`;

// Le dossier doit ressembler à la racine d'un projet : un .git, un package.json, un dossier
// supabase ou un fichier .env. Sinon la recherche ne lit pas un dossier au hasard (le dossier
// personnel, par exemple).
function ressembleAUneRacine(entrees) {
  return entrees.some(
    (e) =>
      e.name === ".git" ||
      e.name === "package.json" ||
      (e.name === "supabase" && (e.isDirectory() || e.isSymbolicLink())) ||
      (/^\.env(\.|$)/.test(e.name) && (e.isFile() || e.isSymbolicLink())),
  );
}

async function principal() {
  const demande = path.resolve(process.argv[2] || ".");
  let racine;
  let entrees;
  try {
    racine = fs.realpathSync(demande);
    if (!fs.statSync(racine).isDirectory()) throw new Error("pas un dossier");
  } catch {
    console.error(`Dossier introuvable : ${echapper(demande)}`);
    process.exitCode = 2;
    return;
  }
  try {
    entrees = fs.readdirSync(racine, { withFileTypes: true });
  } catch {
    console.error(`Dossier illisible : ${echapper(racine)}`);
    process.exitCode = 2;
    return;
  }
  // Le dossier personnel et la racine du disque ne sont jamais un projet, même avec un package.json.
  const interdits = [os.homedir(), path.parse(racine).root].map((d) => { try { return fs.realpathSync(d); } catch { return d; } });
  if (interdits.includes(racine)) {
    console.error(`Ce dossier est ton dossier personnel ou la racine du disque : ${echapper(racine)}\nJe ne lis pas un dossier au hasard : lance-moi depuis la racine de ton projet.`);
    process.exitCode = 2;
    return;
  }
  if (!ressembleAUneRacine(entrees)) {
    console.error(`Ce dossier ne ressemble pas à la racine d'un projet (ni .git, ni package.json, ni dossier supabase, ni fichier .env) : ${echapper(racine)}\nJe ne lis pas un dossier au hasard : lance-moi depuis la racine de ton projet.`);
    process.exitCode = 2;
    return;
  }

  // L'état de git : "ok", "absent" (pas de dépôt) ou "illisible" (un dépôt, mais un appel git échoue).
  // Un git illisible se traite comme l'absence de git : on parcourt les dossiers, sans historique.
  const aUnDepot = entrees.some((e) => e.name === ".git");
  let etatGit = git(racine, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true" ? "ok" : aUnDepot ? "illisible" : "absent";
  let listeGit = null;
  let suivis = new Set();
  if (etatGit === "ok") {
    const presents = git(racine, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    const enregistres = git(racine, ["ls-files", "-z"]);
    if (presents === null || enregistres === null) {
      etatGit = "illisible";
    } else {
      listeGit = presents.split("\0").filter(Boolean);
      suivis = new Set(enregistres.split("\0").filter(Boolean));
    }
  }
  const avecGit = etatGit === "ok";

  // Les fichiers du projet : ceux que git suit ou ne cache pas, et tous les .env, même ignorés,
  // parce qu'une variable VITE_ d'un .env ignoré part quand même chez les visiteurs à la construction.
  const parcours = parcourir(racine);
  const envs = parcours.filter((f) => /(^|\/)\.env(\.|$)/.test(f));
  const tous = [...new Set([...(avecGit ? listeGit : parcours), ...envs])];
  const fichiers = [];
  for (const f of tous) {
    if (FICHIERS_IGNORES.test(f)) bilan.verrous++;
    else if (path.join(racine, f).startsWith(DOSSIER_SKILL + path.sep)) bilan.duSkill++;
    else fichiers.push(f);
  }

  let lus = 0;
  for (const f of fichiers) {
    const lecture = lireFichier(racine, f);
    if (lecture.sorte) {
      sauter(lecture.sorte, f);
      continue;
    }
    lus++;
    if (lecture.partiel) bilan.partiels.push(f);
    chercherFichier(lecture.texte, f);
    if (/(^|\/)\.env(\.|$)/.test(f)) {
      const ignore = avecGit && spawnSync("git", argsGit(racine, ["check-ignore", "-q", "--", f]), { env: ENV_GIT, windowsHide: true }).status === 0;
      fichiersEnv.push({ chemin: f, enregistre: suivis.has(f), ignore, variables: lireEnv(lecture.texte) });
    }
  }
  const commits = avecGit ? await lireHistorique(racine) : null;

  const nonLus = bilan.partiels.length + [...bilan.sautes.values()].reduce((n, noms) => n + noms.length, 0) + bilan.dossiers.length;
  const sortie = [];
  const historique = etatGit === "absent" ? "pas d'historique git" : etatGit === "illisible" ? "git illisible, historique non lu" : commits === null ? "historique illisible" : `${commits} enregistrements de l'historique lus`;
  sortie.push(`RECHERCHE DES CLÉS · ${lus} fichiers lus · ${historique}${nonLus ? ` · ${nonLus} lus en partie ou sautés (voir la fin)` : ""}`);
  sortie.push("Aucune valeur n'est montrée en entier : seulement le début reconnaissable d'une clé, ou la longueur d'une valeur.", "");

  sortie.push("CLÉS TROUVÉES");
  const classees = [...trouvees.values()].sort((a, b) => (b.secret === true) - (a.secret === true));
  if (!classees.length) sortie.push("Aucune.");
  for (const c of classees) {
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
    const etat = e.enregistre ? "ENREGISTRÉ dans le projet (chaque copie le contient)" : e.ignore ? "ignoré par git" : etatGit === "illisible" ? "état git inconnu" : "ni enregistré ni ignoré";
    sortie.push(`- ${echapper(e.chemin)} · ${etat}`);
    for (const v of e.variables) {
      const navigateur = v.navigateur ? (v.alerte ? " · ENVOYÉE AU NAVIGATEUR" : " · envoyée au navigateur") : "";
      sortie.push(`  ${v.nom} : ${v.contenu}${navigateur}`);
    }
  }

  if (avecGit) {
    sortie.push("", "DÉPÔTS DISTANTS");
    const brut = git(racine, ["remote", "-v"]);
    const distants = [
      ...new Set(
        (brut || "")
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const m = l.match(/^([^\t]*)\t(.*) \((?:fetch|push)\)$/s);
            return m ? `${sansGuillemets(m[1])} : ${reduireAdresse(m[2])}` : "adresse illisible";
          }),
      ),
    ];
    if (brut === null) sortie.push("Illisibles : git n'a pas pu les donner.");
    else sortie.push(...(distants.length ? distants.map((d) => `- ${d}`) : ["Aucun : le projet n'a pas de copie déclarée ailleurs."]));
  }

  sortie.push("", "FICHIERS LUS EN PARTIE OU SAUTÉS");
  const ecartes = [];
  if (bilan.verrous) ecartes.push(`${fichiersEn(bilan.verrous)} de verrouillage des dépendances`);
  if (bilan.duSkill) ecartes.push(`${fichiersEn(bilan.duSkill)} du skill lui-même`);
  if (bilan.ignores.size && !avecGit) ecartes.push(`les dossiers ${[...bilan.ignores].sort().join(", ")}`);
  if (!nonLus) sortie.push("Aucun.");
  if (bilan.partiels.length) sortie.push(`- lus en partie, début seulement (${LIMITE_LECTURE_TEXTE} au plus) : ${fichiersEn(bilan.partiels.length)} : ${listeDeNoms(bilan.partiels)}`);
  for (const [sorte, noms] of bilan.sautes) sortie.push(`- sautés, ${sorte} : ${fichiersEn(noms.length)} : ${listeDeNoms(noms)}`);
  if (bilan.dossiers.length) sortie.push(`- dossiers illisibles, sautés : ${bilan.dossiers.length} : ${listeDeNoms(bilan.dossiers)}`);
  if (nonLus) sortie.push("Ce qui s'y trouve n'a pas été cherché : à compter parmi les points non vérifiés.");
  if (ecartes.length) sortie.push(`Laissés de côté exprès : ${ecartes.join(", ")}.`);

  console.log(sortie.join("\n"));
  process.exitCode = lus > 0 ? 0 : 2;
}

try {
  await principal();
} catch (e) {
  // Jamais de trace d'erreur : elle pourrait citer un morceau de fichier. Le code suffit.
  console.error(`La recherche des clés a échoué (${sansGuillemets(e?.code || e?.name || "erreur")}).`);
  process.exitCode = 2;
}
