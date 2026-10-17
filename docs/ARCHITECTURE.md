# ARCHITECTURE.md — מבנה המערכת

## 1. סטאק
| שכבה | בחירה | למה |
|---|---|---|
| אפליקציה | React + TypeScript + Vite | מהיר לפיתוח, בנייה סטטית שנפרסת ב-Vercel |
| תלת-ממד | three.js דרך `@react-three/fiber` ו-`@react-three/drei` | סצנה הצהרתית, מצלמות ובקרות מוכנות |
| מצב | `zustand` | מצב יחיד וקל, בלי טקסים |
| סכמה | `zod`, נגזר מ-`recipe.schema.json` | מקור אמת אחד לטיפוסים ולבדיקה |
| גאומטריה | Web Worker דרך `comlink` | הממשק לא נתקע בזמן בנייה |
| שמש | `suncalc` | מיקום שמש לפי תאריך ומיקום |
| נתונים | Supabase: Postgres, Auth, Storage, Edge Functions | פרויקטים, גרסאות, צילומים, וקריאה ל-Claude |
| AI | Claude API מתוך Edge Function | המפתח נשאר בשרת |
| בדיקות | `vitest` לגאומטריה ולכללים, Playwright לזרימה הראשית | |
| פריסה | Vercel לאפליקציה, Supabase לפונקציות | |

גרסאות: כל ספרייה מוצמדת לגרסה מדויקת ב-`package.json` (בלי `^`), כדי שבנייה תהיה ניתנת לשחזור.

## 2. מבנה תיקיות
```
/
├─ CLAUDE.md
├─ docs/                      מסמכי האפיון, הסכמה והדוגמאות
├─ src/
│  ├─ recipe/                 schema.ts (zod), rules.ts (כללים סמנטיים), migrate.ts
│  ├─ engine/                 worker.ts, sweep/, surface/, sections/, paths/, metrics.ts, export/
│  ├─ scene/                  BareScene.tsx, RealisticScene.tsx, materials/, contexts/, sun.ts, seasons.ts
│  ├─ ui/                     screens/, panels/, controls/, theme/
│  ├─ data/                   supabase.ts, projects.ts, versions.ts
│  └─ prompt/                 visualPrompt.ts (פרומפט להמחשה מהמצב)
├─ supabase/
│  ├─ migrations/
│  └─ functions/concept-to-recipe/   index.ts, system.md
└─ tests/
```

## 3. זרימת נתונים
```
מושג ──> Edge Function ──> Claude ──> מתכון
                                       │
                         בדיקה: סכמה + כללים ──(כישלון)──> תיקון אוטומטי / עריכה ידנית
                                       │
                                  store (zustand)
                       ┌───────────────┴───────────────┐
             שינוי ב-generator / bare           שינוי ב-realistic
                       │                                │
              Worker: build(recipe)            חומר, שמש, סביבה בלבד
                       │                                │
              רשת + מדדים + בעיות  ──────────>  סצנה ערומה / סצנה ריאליסטית
                                       │
                         שמירת גרסה, צילום 3:2, פרומפט, ייצוא
```

**כלל:** רק שינוי ב-`generator` או ב-`bare` שולח עבודה ל-Worker. בקשות מתנגשות מבוטלות, ורק האחרונה נבנית.

## 4. מסד נתונים
```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  concept text not null,
  title_he text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references recipe_versions(id),
  recipe jsonb not null,
  schema_version text not null,
  note text,
  created_at timestamptz not null default now()
);

create table snapshots (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references recipe_versions(id) on delete cascade,
  image_path text not null,        -- Supabase Storage, bucket "snapshots"
  visual_prompt text,
  level text not null check (level in ('bare','realistic')),
  created_at timestamptz not null default now()
);

alter table projects enable row level security;
alter table recipe_versions enable row level security;
alter table snapshots enable row level security;

create policy own_projects on projects
  for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy own_versions on recipe_versions
  for all using (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid()));
create policy own_snapshots on snapshots
  for all using (exists (select 1 from recipe_versions v join projects p on p.id = v.project_id
                         where v.id = version_id and p.owner = auth.uid()))
  with check (exists (select 1 from recipe_versions v join projects p on p.id = v.project_id
                         where v.id = version_id and p.owner = auth.uid()));
```

- גרסה היא בלתי ניתנת לשינוי. עריכה יוצרת גרסה חדשה עם `parent_id`.
- טיוטה שלא נשמרה נשמרת ב-`localStorage` עם try/catch, ומסונכרנת כשהחיבור חוזר.

## 5. פונקציית השרת
`POST /functions/v1/concept-to-recipe`

| קלט | פלט |
|---|---|
| `{ concept, use?, context?, generators }` | `{ recipe, attempts, issues }` או `{ error, lastRecipe, issues }` |

- דורשת משתמשת מחוברת (JWT של Supabase).
- מגבלת קצב: 20 קריאות לשעה למשתמשת.
- משתני סביבה: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`. לעולם לא בצד הלקוח.
- הפונקציה מריצה בעצמה את בדיקת הסכמה והכללים הקשיחים, כולל לולאת התיקון (`AI_PROMPT.md` סעיף 4).

## 6. ייצוא
| פורמט | תוכן | שימוש |
|---|---|---|
| glTF בינארי (`.glb`) | רשתות עם חומרים | Blender, צפייה בדפדפן |
| OBJ | רשתות, ועקומת הקצה כקו נפרד | Rhino |
| STL | רשת חיצונית סגורה, Z למעלה | הדפסה תלת-ממדית |
| JSON | המתכון | שחזור, שיתוף |
| PNG ‏3:2 | צילום הסצנה | מצגות |

הייצוא נוצר ב-Worker, ונמסר להורדה דרך `Blob` וקישור הורדה רגיל.

## 7. ביצועים ואמינות
- רזולוציה אדפטיבית: אם זמן הבנייה עובר את התקציב ב-`LEVELS.md`, הרזולוציה יורדת בשלב אחד ומוצגת הודעה שקטה.
- המודל הקודם נשאר על המסך עד שהחדש מוכן. לעולם אין מסך ריק.
- כל שגיאה ב-Worker נתפסת, ומוצגת עם הכלל שנכשל ועם דרך חזרה למצב התקין האחרון.
