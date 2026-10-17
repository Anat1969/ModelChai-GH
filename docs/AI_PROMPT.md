# AI_PROMPT.md — ממושג למתכון

Claude מתרגם מושג מתמטי למתכון שעומד בסכמה. הקריאה מתבצעת רק מפונקציית שרת (`supabase/functions/concept-to-recipe`), כי מפתח ה-API לא יושב בדפדפן.

## 1. הקריאה
| נושא | החלטה |
|---|---|
| מודל | משתנה סביבה `CLAUDE_MODEL`. ברירת מחדל: `claude-sonnet-5-5`, מהיר ומספיק למשימה מובנית. לבדוק שמות מודלים עדכניים ב-docs.claude.com לפני פריסה |
| פלט מובנה | Structured outputs (`output_config.format`) עם גרסה של `recipe.schema.json` שהמהדר של ה-API מקבל: בלי מגבלות טווח ואורך ובלי if/then, והמחולל מצומצם למחוללים הזמינים. `params` הוא הסוויפ או המשטח הפרמטרי (`anyOf`). במשטח כל המידות נדרשות ויכולות להיות `null`, כך שלא נוסף אף שדה אופציונלי (17 מתוך 24 המותרים), והשרת מוחק את ה-`null` לפני הבדיקה (`DECISIONS.md` 142). הבדיקה המלאה מול הסכמה והכללים רצה אחרי כל תשובה. בגלל ש-Sonnet 5.5 דוחה `tool_choice` מכריח, אין כלי `submit_recipe` (`DECISIONS.md` 32) |
| מחוללים זמינים | נשלחים בהודעת המשתמש לפי הגדרת האפליקציה. מאז שלב 6: `["sweep", "parametric_surface"]` |
| דוגמאות | שלושת הקבצים ב-`docs/fixtures/`, ואחריהם `docs/examples/hypar-canopy.recipe.json` כדוגמה למשטח, מצורפים להנחיית המערכת בזמן ריצה, כך שאין שכפול בין המסמך לקוד |
| טמפרטורה | לא נשלחת. ב-Sonnet 5.5 ערך שאינו ברירת המחדל מחזיר שגיאה. במקומה `effort: medium` (`DECISIONS.md` 33) |
| מטמון | הנחיית המערכת והדוגמאות מסומנות ל-prompt caching, כי הן זהות בכל קריאה |
| סירוב | `fallbacks: "default"` עם הכותרת `server-side-fallback-2026-07-01`: סירוב בקטגוריות שמכוסות עובר למודל חלופי באותה קריאה |

## 2. הנחיית המערכת
טקסט ההנחיה נשמר בקובץ `supabase/functions/concept-to-recipe/system.md`, באנגלית, כי הוא מיועד למודל. השדות שמוצגים למשתמשת נכתבים בעברית.

```
You translate a mathematical concept into a buildable architectural recipe for a parametric 3D engine.

Output: one JSON object that matches the given schema. No prose outside it.

How to think, in order:
1. Distill the concept's structural essence: the one geometric property that makes it itself (e.g. umbilic torus: a single edge that circles three times).
2. Choose the available generator that expresses that property best. Only use generators listed in the user message.
3. Size it for the requested use at human scale. A person is 1.75 m. Enterable spaces need at least 2.4 m clear height.
4. Write the narrative in Hebrew: name_he (2-4 words), insight (one or two plain sentences about what the form does in space, not what it looks like), maxim (one short line).
5. Be honest about fit: if the generator cannot fully express the concept, set narrative.fit_note to one Hebrew sentence saying what was lost. If the fit is complete, set it to null.

The parametric_surface generator (when it is available): a named surface from a fixed library, built as a shell of even thickness by offsetting the surface along its normal. Choose it when the concept IS one of these surfaces; choose the sweep when the concept is a section moving along a path.
- hyperboloid: waist_radius, end_radius (> waist_radius), height. hyperbolic_paraboloid: span, span2, rise. catenoid: waist_radius, height (at most 4 * waist_radius). helicoid: radius, pitch, turns. klein_bottle: radius, tube (radius > 1.25 * tube + thickness). monkey_saddle: span, rise.
Write null for every dimension field the family does not use. Surfaces need bare.mode "shell". bare.section_center_height is the height of the shell's lowest point. Openings and floors are not built on surfaces.
(The full text is in system.md.)

Hard rules (the engine rejects recipes that break them):
- Closed paths: twist.turns_per_lap times the section's symmetry order must be an integer. Deltoid: 3. Hypocycloid: cusps. Polygon: sides. Circle: any. If aspect is not 1, symmetry is at most 2 (1 for odd counts).
- Circular paths: path.R must exceed the section's outer radius (deltoid: 3a; hypocycloid: cusps * a; polygon and circle: a).
- Shell: thickness must be smaller than the face radius (deltoid: a).
- Passages must not overlap: count * width < 0.8 * 2 * pi * R.

Soft rules (allowed, but prefer to satisfy):
- Continuous floor in enterable shells: section_center_height - floor.level < 1.5 * (a - thickness) for a deltoid.
- Cusp burial depth (outer radius - section_center_height) at most 3 m.

Defaults when the user gives no detail:
- realistic.site: Ashdod, lat 31.8, lon 34.65.
- realistic.datetime: today at 17:00 local time.
- realistic.camera: eye_level_oblique, height 1.6, fov 42, aspect "3:2".
- realistic.context.preset: choose the one closest to the user's context hint; otherwise coastal_dunes.
- realistic.weather: clear, unless the concept or the context calls for haze, overcast, rain, fog or snow.
- realistic.orientation_deg: 0. realistic.wind: from_deg 270, speed_ms 5 (the afternoon sea breeze), unless the context implies another wind.
- meta.source: "claude". meta.created_at: the timestamp given in the user message.

Style for Hebrew fields: natural, precise, professional Hebrew. Not flowery. No emoji.

Examples of correct recipes follow.
{{FIXTURES}}
```

## 3. הודעת המשתמש
```
Concept: {concept}
Use: {use | "not specified"}
Context hint: {context | "not specified"}
Available generators: {["sweep", "parametric_surface"]}
Timestamp: {ISO datetime, Asia/Jerusalem}
```

## 4. תיקון אוטומטי
אם המתכון נכשל בבדיקה מול הסכמה או בכלל סמנטי קשיח, נשלחת הודעה חוזרת באותה שיחה, עד פעמיים:

```
The recipe failed validation. Fix only these problems and answer again with the full recipe:
- {path}: {error message}
- {rule number}: {rule message} (current value {x}, required {condition})
Keep every other field unchanged.
```

אחרי שני כישלונות, המתכון האחרון נפתח לעריכה ידנית בממשק, עם השדות הבעייתיים מסומנים.

## 5. שלוש הדוגמאות
| קובץ | מושג | מה הוא מלמד את המודל |
|---|---|---|
| `umbilic-torus.recipe.json` | טורוס טבורי | התאמה מלאה. קליפה שנכנסים אליה, פתחים ורצפה רציפה |
| `mobius-strip.recipe.json` | רצועת מביוס | שימוש ב-`aspect` לרצועה שטוחה, וחצי סיבוב. `fit_note` מסביר את הפער בין משטח בלי עובי לרצועה עבה |
| `golden-ratio.recipe.json` | יחס הזהב | התאמה חלקית: מסלול סליל וקנה מידה גאומטרי, עם `fit_note` שמסביר מה יתאפשר רק במחולל עתידי |
| `docs/examples/hypar-canopy.recipe.json` | פרבולואיד היפרבולי | המשטח הפרמטרי: משפחה ומידותיה בלבד, קליפה בעובי 12 ס"מ, בסיס על הקרקע, `fit_note` ריק |

## 6. בדיקות
1. כל שלוש הדוגמאות עוברות את הסכמה ואת הכללים הקשיחים (בדיקת יחידה, בלי קריאה למודל).
2. בדיקת אינטגרציה, שמסומנת ורצה ידנית: חמישה מושגים (טורוס טבורי, רצועת מביוס, ספירלה, היפרבולואיד, משולש פסקל). לפחות ארבעה מחזירים מתכון תקין בניסיון הראשון, וההיפרבולואיד ומשולש פסקל מחזירים `fit_note` שאינו ריק.
3. מפתח ה-API לא מופיע באף קובץ בצד הלקוח ולא בתגובת הפונקציה.

## מצב ברירת המחדל: המושג במצבו האידיאלי
המתכון ש-Claude מחזיר הוא המצב שאליו "איפוס" מחזיר, ולכן הוא צריך להיות המאוזן ביותר:
- **פרופורציות מהמספר של המושג:** סדר הסימטריה, היחס או המנייה שלו. רדיוס הטבעת בין 4 ל-8 פעמים הרדיוס החיצוני של החתך, והסיבוב הפשוט ביותר שסוגר את הצורה.
- **קנה מידה אנושי:** בקליפה נכנסת, רצפה רציפה ברוחב 1.2 מ' לפחות וגובה חופשי של 2.4 מ' לפחות. מעברים ברוחב 3.2 מ' ובגובה 2.6 מ' מעל הרצפה.
- **פוזיטיב ונגטיב:** מה שהצורה סוגרת (חצר, חלל, צל) מתוכנן בדיוק כמו מה שהיא בונה, והתובנה אומרת זאת.

**סבב ליטוש:** מתכון שנבנה אבל מפר כלל של קנה מידה אנושי (4, 5 או 6, ובמשטח 13 או 14) נשלח לסבב אחד נוסף. אם הסבב לא משפר, נשאר המתכון הראשון. כלל 8 (קבורת החוד) הוא בחירה עיצובית, ולא מלטשים אותו (`DECISIONS.md` 83).
