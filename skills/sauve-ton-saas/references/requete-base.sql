-- Sauve Ton SaaS : la requête de lecture de la base.
-- Elle ne modifie rien. Elle lit la description de ta base, jamais les données de tes clients.
-- Colle-la dans l'éditeur SQL (Supabase : SQL Editor. Lovable : More, Cloud, puis SQL editor) et lance-la.
-- Si l'éditeur limite le nombre de lignes affichées, choisis « sans limite » avant de lancer.
-- Copie ensuite tout le tableau de résultat et donne-le à ton IA.
with
roles_api as (
  select
    (select oid from pg_roles where rolname = 'anon') as anon,
    (select oid from pg_roles where rolname = 'authenticated') as connecte
),

objets as (
  select
    c.oid,
    format('%I.%I', n.nspname, c.relname) as nom,
    c.relname as nom_court,
    c.relkind,
    case c.relkind
      when 'r' then 'table' when 'p' then 'table' when 'f' then 'table_etrangere'
      when 'v' then 'vue' when 'm' then 'vue_materialisee'
    end as type,
    c.relrowsecurity as rls,
    coalesce((
      select lower(o.option_value) in ('true', 'on', '1', 'yes')
      from pg_options_to_table(c.reloptions) o
      where o.option_name = 'security_invoker'
    ), false) as invoker,
    array_to_string(array(
      select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
      where has_table_privilege(r.anon, c.oid, p)
    ), ',') as droits_visiteurs,
    array_to_string(array(
      select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
      where has_table_privilege(r.connecte, c.oid, p)
    ), ',') as droits_connectes,
    exists (
      select 1 from pg_policy pol where pol.polrelid = c.oid
    ) as a_des_regles
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join roles_api r
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'f', 'v', 'm')
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
),

vues_contournement as (
  select
    'protect.vue-contourne-regles'::text as controle,
    nom as objet,
    format('type=%s; lecture=%s', type,
      concat_ws('+',
        case when droits_visiteurs like '%SELECT%' then 'visiteurs' end,
        case when droits_connectes like '%SELECT%' then 'connectes' end)) as detail
  from objets
  where type in ('vue', 'vue_materialisee')
    and not invoker
    and (droits_visiteurs like '%SELECT%' or droits_connectes like '%SELECT%')
),

droits_visiteurs as (
  select
    'protect.droits-visiteurs'::text,
    nom,
    format('type=%s; droits=%s; rls=%s; security_invoker=%s',
      type, droits_visiteurs,
      case when type in ('table', 'table_etrangere') then case when rls then 'oui' else 'non' end else 'sans_objet' end,
      case when type = 'vue' then case when invoker then 'oui' else 'non' end else 'sans_objet' end)
  from objets
  where droits_visiteurs <> ''
    and (
      (type in ('table', 'table_etrangere') and not rls)
      or (type = 'vue' and not invoker)
      or type = 'vue_materialisee'
    )
),

defauts as (
  select
    d.defaclrole,
    pg_get_userbyid(d.defaclrole) as accordeur,
    case d.defaclobjtype when 'r' then 'tables' when 'f' then 'fonctions' end as sur,
    string_agg(distinct a.privilege_type, ',' order by a.privilege_type) as droits
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  cross join roles_api r
  where a.grantee = r.anon
    and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE')
    and d.defaclobjtype in ('r', 'f')
    and (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
  group by d.defaclrole, d.defaclobjtype
),

droits_par_defaut as (
  select
    'protect.droits-par-defaut'::text,
    format('%s/%s', accordeur, sur),
    format('accorde_par=%s; sur=%s; droits=%s; modifiable=%s; objets_crees_par_ce_role=%s',
      accordeur, sur, droits,
      case when accordeur = 'supabase_admin' then 'non' else 'oui' end,
      case sur
        when 'tables' then (
          select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relowner = defauts.defaclrole
            and c.relkind in ('r', 'p', 'f', 'v', 'm'))
        else (
          select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proowner = defauts.defaclrole)
      end)
  from defauts
),

tables_sans_regles as (
  select
    'protect.table-sans-regles'::text,
    nom,
    case
      when not rls then format('rls=non; visiteurs=%s; connectes=%s',
        coalesce(nullif(droits_visiteurs, ''), 'aucun'), coalesce(nullif(droits_connectes, ''), 'aucun'))
      else 'rls=oui; regles_ecrites=aucune'
    end
  from objets
  where type = 'table'
    and (not rls or not a_des_regles)
),

regles_ouvertes as (
  select
    'protect.regle-ouverte-a-tous'::text,
    format('%I.%I', p.schemaname, p.tablename) || ' / ' || p.policyname,
    format('commande=%s; roles=%s; using=%s; with_check=%s',
      p.cmd, array_to_string(p.roles, ','),
      case when p.qual is null then 'absent' when p.qual = 'true' then 'true' else 'filtre' end,
      case when p.with_check is null then 'absent' when p.with_check = 'true' then 'true' else 'filtre' end)
  from pg_policies p
  where p.schemaname = 'public'
    and (p.qual = 'true' or p.with_check = 'true')
    and not (p.roles <@ array['service_role']::name[])
),

-- Une règle dont la seule condition est la connexion (auth.uid() is not null, ou auth.role()
-- égal à authenticated) laisse chaque compte tout lire ou tout modifier.
-- Postgres ajoute des parenthèses à la condition, et écrit uid() au lieu de auth.uid() quand le
-- schéma auth fait partie du chemin de recherche de celui qui lit : le motif accepte tout cela.
motif_connexion as (
  select
    '^[([:space:]]*(select[[:space:]]+)?(auth[.])?('
    || 'uid[(][)][[:space:]]*(as[[:space:]]+[a-z0-9_]+)?[)[:space:]]*is[[:space:]]+not[[:space:]]+null'
    || '|role[(][)][[:space:]]*(as[[:space:]]+[a-z0-9_]+)?[)[:space:]]*=[[:space:]]*''authenticated''(::text)?'
    || ')[)[:space:]]*$' as motif
),

regles_connexion_seule as (
  select
    'protect.regle-connexion-seule'::text,
    format('%I.%I', p.schemaname, p.tablename) || ' / ' || p.policyname,
    format('commande=%s; roles=%s; using=%s; with_check=%s',
      p.cmd, array_to_string(p.roles, ','),
      case when p.qual is null then 'absent' when p.qual = 'true' then 'true' when t.using_connexion then 'connexion_seule' else 'filtre' end,
      case when p.with_check is null then 'absent' when p.with_check = 'true' then 'true' when t.check_connexion then 'connexion_seule' else 'filtre' end)
  from pg_policies p
  cross join motif_connexion m
  cross join lateral (
    select
      coalesce(p.qual ~* m.motif, false) as using_connexion,
      coalesce(p.with_check ~* m.motif, false) as check_connexion
  ) t
  where p.schemaname = 'public'
    and (t.using_connexion or t.check_connexion)
),

-- Une règle des fichiers dont la condition ne cite ni auth.uid() ni owner ni owner_id ne relie
-- pas le fichier à son propriétaire : tout compte visé par la règle atteint tous les fichiers du dossier.
-- Selon le chemin de recherche de celui qui lit, Postgres écrit auth.uid() ou uid() : les deux comptent.
regles_fichiers_larges as (
  select
    'protect.regle-fichiers-large'::text,
    format('%I.%I', p.schemaname, p.tablename) || ' / ' || p.policyname,
    format('commande=%s; roles=%s; condition=%s',
      p.cmd, array_to_string(p.roles, ','),
      case when coalesce(nullif(p.qual, 'true'), nullif(p.with_check, 'true')) is null then 'aucune' else 'dossier seulement' end)
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and concat_ws(' ', p.qual, p.with_check) !~* '[[:<:]]uid[(]|owner'
),

fonctions_privilegiees as (
  select
    'protect.fonction-privilegiee'::text,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    format('executable_par=%s; search_path_fixe=%s',
      concat_ws('+',
        case when has_function_privilege(r.anon, p.oid, 'EXECUTE') then 'visiteurs' end,
        case when has_function_privilege(r.connecte, p.oid, 'EXECUTE') then 'connectes' end),
      case when exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%'
      ) then 'oui' else 'non' end)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join roles_api r
  where n.nspname = 'public'
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and (has_function_privilege(r.anon, p.oid, 'EXECUTE') or has_function_privilege(r.connecte, p.oid, 'EXECUTE'))
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
),

buckets_xml as (
  select case
    when to_regnamespace('storage') is null then null
    when not has_schema_privilege(to_regnamespace('storage'), 'USAGE') then null
    when to_regclass('storage.buckets') is null then null
    when row_security_active(to_regclass('storage.buckets')) then null
    when has_table_privilege(to_regclass('storage.buckets'), 'SELECT') then query_to_xml(
      'select id, coalesce(file_size_limit::text, ''aucune'') as taille_max, '
      || 'coalesce(array_to_string(allowed_mime_types, '',''), ''tous'') as types '
      || 'from storage.buckets where public order by id',
      false, false, '')
  end as x,
  case
    when to_regnamespace('storage') is null then 'absent'
    when not has_schema_privilege(to_regnamespace('storage'), 'USAGE') then 'illisible'
    when to_regclass('storage.buckets') is null then 'absent'
    when row_security_active(to_regclass('storage.buckets')) then 'filtre'
    when has_table_privilege(to_regclass('storage.buckets'), 'SELECT') then 'lisible'
    else 'illisible'
  end as etat
),

buckets_publics as (
  select
    'protect.bucket-public'::text,
    (xpath('/row/id/text()', ligne))[1]::text,
    format('public=oui; taille_max=%s; types=%s',
      (xpath('/row/taille_max/text()', ligne))[1]::text,
      (xpath('/row/types/text()', ligne))[1]::text)
  from buckets_xml
  cross join lateral unnest(xpath('/table/row', buckets_xml.x)) as ligne
  union all
  select 'protect.bucket-public', '', format('stockage=%s', etat)
  from buckets_xml
  where etat <> 'lisible'
),

migrations_xml as (
  select case
    when to_regnamespace('supabase_migrations') is null then null
    when not has_schema_privilege(to_regnamespace('supabase_migrations'), 'USAGE') then null
    when to_regclass('supabase_migrations.schema_migrations') is null then null
    when row_security_active(to_regclass('supabase_migrations.schema_migrations')) then null
    when has_table_privilege(to_regclass('supabase_migrations.schema_migrations'), 'SELECT') then query_to_xml(
      'select version from supabase_migrations.schema_migrations order by version',
      false, false, '')
  end as x,
  case
    when to_regnamespace('supabase_migrations') is null then 'absente'
    when not has_schema_privilege(to_regnamespace('supabase_migrations'), 'USAGE') then 'illisible'
    when to_regclass('supabase_migrations.schema_migrations') is null then 'absente'
    when row_security_active(to_regclass('supabase_migrations.schema_migrations')) then 'filtre'
    when has_table_privilege(to_regclass('supabase_migrations.schema_migrations'), 'SELECT') then 'lisible'
    else 'illisible'
  end as etat
),

versions as (
  select (xpath('/row/version/text()', ligne))[1]::text as version
  from migrations_xml
  cross join lateral unnest(xpath('/table/row', migrations_xml.x)) as ligne
),

migrations as (
  select 'migration'::text, 'etat'::text, etat from migrations_xml
  union all
  select 'migration', 'versions', coalesce((select string_agg(version, ',' order by version) from versions), '')
  from migrations_xml
  where etat = 'lisible'
  union all
  select 'preserve.base-egale-projet', '',
    case when etat = 'lisible' then format('table_migrations=lisible; appliquees=%s', (select count(*) from versions))
         else format('table_migrations=%s', etat) end
  from migrations_xml
),

inventaire as (
  select 'inventaire'::text, 'tables'::text,
    coalesce(string_agg(quote_ident(nom_court), ',' order by nom_court)
      filter (where type in ('table', 'table_etrangere')), '')
  from objets
  union all
  select 'inventaire', 'vues',
    coalesce(string_agg(quote_ident(nom_court), ',' order by nom_court)
      filter (where type in ('vue', 'vue_materialisee')), '')
  from objets
),

constats (controle, objet, detail) as (
  select * from vues_contournement
  union all select * from droits_visiteurs
  union all select * from droits_par_defaut
  union all select * from tables_sans_regles
  union all select * from regles_ouvertes
  union all select * from regles_connexion_seule
  union all select * from regles_fichiers_larges
  union all select * from fonctions_privilegiees
  union all select * from buckets_publics
),

attendus (controle) as (
  values
    ('protect.vue-contourne-regles'), ('protect.droits-visiteurs'), ('protect.droits-par-defaut'),
    ('protect.table-sans-regles'), ('protect.regle-ouverte-a-tous'), ('protect.fonction-privilegiee'),
    ('protect.bucket-public'), ('protect.regle-connexion-seule'), ('protect.regle-fichiers-large')
),

lignes (controle, objet, detail) as (
  select * from constats
  union all
  select a.controle, '', 'aucun' from attendus a
  where not exists (select 1 from constats c where c.controle = a.controle)
  union all select * from migrations
  union all select * from inventaire
)

select controle, objet, detail
from (
  select 0 as ordre, 'meta' as controle, 'version' as objet, '2' as detail
  union all
  select 1, controle, objet, detail from lignes
  union all
  select 2, 'meta', 'fin', ((select count(*) from lignes) + 2)::text
) resultat
order by ordre, controle, objet, detail;
