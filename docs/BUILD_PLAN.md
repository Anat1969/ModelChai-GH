# BUILD_PLAN.md — שלבי הבנייה

כל שלב נסגר רק כשכל מבחני הקבלה שלו עוברים. Claude Code מפסיק בסוף כל שלב ומדווח: מה נבנה, תוצאות הבדיקות, ומה נשאר פתוח. לכל שלב יש פרומפט מוכן להעתקה.

## שלב 0 — הקמה וחוזה
**משימות**
- הקמת פרויקט Vite + React + TypeScript, עם `vitest`.
- הרצת `uipro init --ai claude`.
- `src/recipe/schema.ts`: zod שתואם ל-`docs/schema/recipe.schema.json`.
- `src/recipe/rules.ts`: הכללים הסמנטיים מ-`RECIPE_SCHEMA.md`, כל אחד עם מספר, סוג והודעה.
- שלוש הדוגמאות מ-`docs/fixtures` כ-fixtures לבדיקות.

**מבחני קבלה**
- שלוש הדוגמאות עוברות את zod ואת JSON Schema.
- מתכון פגום (בלי `shell` במצב קליפה, היפוציקלואידה בלי `cusps`) נכשל עם הודעה ברורה.
- מתכון הטורוס הטבורי מחזיר אזהרה 8 ואף שגיאה.
- דלתואיד עם `turns_per_lap = 0.25` מחזיר שגיאה 1.

**פרומפט**
```
Read CLAUDE.md, then docs/PRODUCT.md, docs/RECIPE_SCHEMA.md and docs/schema/recipe.schema.json.
Run first: uipro init --ai claude
Do Stage 0 from docs/BUILD_PLAN.md only:
set up Vite + React + TypeScript + vitest, write src/recipe/schema.ts (zod matching the JSON Schema),
src/recipe/rules.ts (all semantic rules with number, severity and Hebrew message), and tests using docs/fixtures.
Stop when every Stage 0 acceptance test passes and report the results.
```

## שלב 1 — מנוע הסוויפ
**משימות**
- `src/engine/`: חתכים (היפוציקלואידה כולל דלתואיד, עיגול, מצולע, סופר-אליפסה, aspect), מסלולים (מעגל, אליפסה, סליל עם מסגרת ממזערת סיבוב, קו), סיבוב, קנה מידה גאומטרי.
- רשת עם חודים חדים, סגירת טבעת, קליפה, פתחים, מיתר רצפה, עקומת קצה.
- `metrics.ts` לפי `GENERATORS.md` סעיף 2.
- Worker עם comlink, וביטול בקשות מתנגשות.

**מבחני קבלה**
- כל ששת מבחני החובה ב-`GENERATORS.md` סעיף 3.

**פרומפט**
```
Read docs/GENERATORS.md fully before coding.
Do Stage 1 from docs/BUILD_PLAN.md only: implement the sweep generator in src/engine as pure functions
running in a Web Worker (comlink), returning typed arrays, curves, metrics and rule issues.
Write the six mandatory tests from GENERATORS.md section 3. Do not build UI yet.
Stop when all tests pass and report the numbers each test measured.
```

## שלב 2 — סטודיו ומודל ערום
**משימות**
- מסך סטודיו: מודל מרובע 1:1, פאנל פרמטרים בלשונית "ערום", פאנל מדדים.
- כל מחוון עם ערך, יחידה ומשפט הסבר (`LEVELS.md` 1.2).
- הדגשת הקצה, מעקב אחרי הקצה, חתך נע.
- מצלמות: גובה עיניים, מבט על, בפנים, מהחצר.
- ייצוא OBJ, STL, glTF, JSON ו-PNG ‏1:1.
- טעינת מתכון מקובץ JSON, כדי לבדוק בלי שלב 3.

**מבחני קבלה**
- טעינת מתכון הטורוס הטבורי מציגה את אותם מדדים כמו מודל הייחוס "הטבעת המשולשת".
- תגובה ראשונית לשינוי מחוון תוך 100 אלפיות שנייה. המודל הקודם נשאר עד שהחדש מוכן.
- ממשק RTL מלא, בלי אייקונים, ותקין ברוחב 400 פיקסלים.
- הקובץ המיוצא נפתח ב-Blender בלי שגיאות.

**פרומפט**
```
Read docs/LEVELS.md section 1 and docs/PRODUCT.md "מסכים" and "עקרונות ממשק".
Do Stage 2 from docs/BUILD_PLAN.md only: the Studio screen with the bare level, parameter panel, metrics panel,
edge highlight and tracer, moving section plane, four camera presets, and exports.
Load recipes from JSON files for now. Hebrew, full RTL, no icons, 1:1 viewport.
Stop when the Stage 2 acceptance tests pass. Include a screenshot of the Umbilic Torus fixture at eye level.
```

## שלב 3 — ממושג למתכון
**משימות**
- Supabase: פרויקט, Auth, טבלאות ומדיניות מ-`ARCHITECTURE.md` סעיף 4.
- Edge Function `concept-to-recipe` לפי `AI_PROMPT.md`, כולל לולאת תיקון.
- מסך "מושג חדש" עם שלד ומצבי מערכת.

**מבחני קבלה**
- מבחני `AI_PROMPT.md` סעיף 6.
- מושג חדש מגיע למודל ערום תוך פחות מ-60 שניות.

**פרומפט**
```
Read docs/AI_PROMPT.md and docs/ARCHITECTURE.md sections 4 and 5.
Do Stage 3 from docs/BUILD_PLAN.md only: Supabase schema and RLS migration, the concept-to-recipe Edge Function
with tool-use structured output, validation and up to two repair rounds, and the New Concept screen with all system states.
Never expose ANTHROPIC_API_KEY to the client. Stop when the Stage 3 acceptance tests pass.
```

## שלב 4 — מודל ריאליסטי
**משימות**
- לשונית "ריאליסטי": תאריך, שעה, מיקום, כפתורי עונה מהירים, מזג אוויר.
- `sun.ts` עם suncalc, `seasons.ts` מטבלת `LEVELS.md` 2.1.
- ספריית חומרים, ארבעה הקשרים, דמויות.
- פרומפט להמחשה מהמצב (`LEVELS.md` 2.6).

**מבחני קבלה**
- אותו מודל ב-21 בדצמבר וב-21 ביוני בשעה 12:00 באשדוד: זווית גובה השמש תואמת ל-suncalc ברמת מעלה אחת, והצל נראה שונה.
- מעבר בין הרמות לא בונה רשת מחדש (נבדק במונה בנייה).
- כל פרט בפרומפט נגזר משדה במתכון.

**פרומפט**
```
Read docs/LEVELS.md section 2.
Do Stage 4 from docs/BUILD_PLAN.md only: the Realistic tab with sun from suncalc, seasons data file, weather presets,
the six MVP materials with procedural textures, four context presets, people, and the visual prompt generator.
Switching levels must never rebuild the mesh. Stop when the Stage 4 acceptance tests pass.
```

## שלב 5 — שמירה, גרסאות והשוואה
**משימות**
- מסך פרויקטים, שמירת גרסה, צילום, השוואה של שתי גרסאות.
- טיוטה מקומית וסנכרון.

**מבחני קבלה**
- פרויקט נפתח מחדש בדיוק במצב שבו נשמר, כולל מצלמה.
- השוואה מציגה שתי גרסאות עם אותה מצלמה, והמדדים שהשתנו מודגשים.

**פרומפט**
```
Do Stage 5 from docs/BUILD_PLAN.md only: Projects screen, immutable versions with parent_id, snapshots to Storage,
side-by-side comparison with a shared camera and highlighted metric differences, and offline drafts.
Stop when the Stage 5 acceptance tests pass, then deploy to Vercel and report the URL.
```

## שלב 6 — הרחבות
- משקופים בשפות הפתחים, קליפה בהיסט נורמלי.
- מחוללים: משטח פרמטרי, שדה מרחק, ריצוף וחזרה, כל אחד עם שלוש דוגמאות ב-`docs/fixtures`.
- מבחן לכל מחולל: שלושה מושגים מגיעים למודל ריאליסטי בלי תיקון ידני.

## שלב 7 — מהמסך אל התערוכה
המטרה: לתעד כל מושג כקולקציה, מהמושג המופשט ועד המודל המודפס, ולהפיק ממנה תערוכה.

**7א — הקפאת מבט וקולקציה (הושלם)**
- כפתור "הקפאת מבט" בחלון המודל: תמונה של 3600 על 2400, שנשמרת בשלב שלה בקולקציה עם הגרסה והמצלמה.
- מסך קולקציה עם שישה שלבים: מושג, מתכון, ערום, ריאליסטי, הדמיה, הדפסה.
- מבחני קבלה: התמונה בגודל 3600 על 2400. מבט של מודל שמור לא יוצר גרסה, ומבט של מודל שהשתנה שומר גרסה קודם. מבט נפתח מחדש עם אותה מצלמה עד המילימטר. הכפתור מגיב תוך 100 אלפיות שנייה. בטלפון (400 פיקסלים) אין גלילה לרוחב.

**7ב — סרטון של 4 שניות (הושלם, ראו החלטה 88)**
- 120 מסגרות ב-30fps, 1200 על 800. המצלמה מסתובבת 90 מעלות, והמודל עובר בהדרגה מערום לריאליסטי.
- קידוד ב-WebCodecs ו-MP4, מסגרת אחרי מסגרת: H.264, או VP9 כשאין H.264.
- מבחני קבלה: קובץ של 4.0 שניות ו-120 מסגרות. המונה של הבנייה לא עולה. התקדמות באחוזים וכפתור ביטול.

**7ג — רינדור הדמיה (הושלם בלי מעקב קרניים, ראו החלטה 91)**
- רינדור של המבט ב-3600 על 2400 עם tone mapping, סביבת HDRI מקומית, צל ברזולוציה גבוהה וחסימת אור. אחר כך מעקב קרניים, אם הספרייה תואמת את three 0.186.
- מבחן קבלה: הצורה זהה למודל, והתמונה נשמרת בשלב "הדמיה".

**7ד — הדפסה, FDM ו-PLA (הושלם בלי פתחים, ראו החלטה 87)**
- גודל במ"מ, בדיקת אטימות, עובי דופן מינימלי של 2 מ"מ ועיבוי שלו, מידות מול השולחן. 3MF ו-STL במילימטרים.
- נשאר: פתחים בקובץ ההדפסה, אחרי המשקופים של שלב 6, וכיוון הדפסה מומלץ.

**7ה — דף תערוכה**
- דף A3 לכל מושג: המושג, המתכון במילים, ערום, ריאליסטי, הדמיה, וקוד QR לסרטון.
