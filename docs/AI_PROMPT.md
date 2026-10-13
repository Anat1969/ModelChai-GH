# AI_PROMPT.md — ממושג למתכון

Claude מתרגם מושג מתמטי למתכון שעומד בסכמה. הקריאה מתבצעת רק מפונקציית שרת (`supabase/functions/concept-to-recipe`), כי מפתח ה-API לא יושב בדפדפן.

## 1. הקריאה
| נושא | החלטה |
|---|---|
| מודל | משתנה סביבה `CLAUDE_MODEL`. ברירת מחדל: `claude-sonnet-5-5`, מהיר ומספיק למשימה מובנית. לבדוק שמות מודלים עדכניים ב-docs.claude.com לפני פריסה |
| פלט מובנה | Tool use עם כלי יחיד, `submit_recipe`, שה-`input_schema` שלו הוא `recipe.schema.json` בלי השדות `$schema` ו-`$id`. `tool_choice` מכריח את הכלי |
| מחוללים זמינים | נשלחים בהודעת המשתמש לפי הגדרת האפליקציה. במוצר המינימלי: `["sweep"]` |
| דוגמאות | שלושת הקבצים ב-`docs/fixtures/` מצורפים להנחיית המערכת בזמן ריצה, כך שאין שכפול בין המסמך לקוד |
| טמפרטורה | 0.4: מספיק גיוון בשם ובתובנה, בלי לפגוע במבנה |
| מטמון | הנחיית המערכת והדוגמאות מסומנות ל-prompt caching, כי הן זהות בכל קריאה |

## 2. הנחיית המערכת
טקסט ההנחיה נשמר בקובץ `supabase/functions/concept-to-recipe/system.md`, באנגלית, כי הוא מיועד למודל. השדות שמוצגים למשתמשת נכתבים בעברית.

```
You translate a mathematical concept into a buildable architectural recipe for a parametric 3D engine.

Output: call the tool submit_recipe exactly once. No prose outside the tool call.

How to think, in order:
1. Distill the concept's structural essence: the one geometric property that makes it itself (e.g. umbilic torus: a single edge that circles three times).
2. Choose the available generator that expresses that property best. Only use generators listed in the user message.
3. Size it for the requested use at human scale. A person is 1.75 m. Enterable spaces need at least 2.4 m clear height.
4. Write the narrative in Hebrew: name_he (2-4 words), insight (one or two plain sentences about what the form does in space, not what it looks like), maxim (one short line).
5. Be honest about fit: if the generator cannot fully express the concept, set narrative.fit_note to one Hebrew sentence saying what was lost. If the fit is complete, set it to null.

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
- realistic.camera: eye_level_oblique, height 1.6, fov 42, aspect "1:1".
- realistic.context.preset: choose the one closest to the user's context hint; otherwise coastal_dunes.
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
Available generators: {["sweep"]}
Timestamp: {ISO datetime, Asia/Jerusalem}
```

## 4. תיקון אוטומטי
אם המתכון נכשל בבדיקה מול הסכמה או בכלל סמנטי קשיח, נשלחת הודעה חוזרת באותה שיחה, עד פעמיים:

```
The recipe failed validation. Fix only these problems and call submit_recipe again:
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

## 6. בדיקות
1. כל שלוש הדוגמאות עוברות את הסכמה ואת הכללים הקשיחים (בדיקת יחידה, בלי קריאה למודל).
2. בדיקת אינטגרציה, שמסומנת ורצה ידנית: חמישה מושגים (טורוס טבורי, רצועת מביוס, ספירלה, היפרבולואיד, משולש פסקל). לפחות ארבעה מחזירים מתכון תקין בניסיון הראשון, וההיפרבולואיד ומשולש פסקל מחזירים `fit_note` שאינו ריק.
3. מפתח ה-API לא מופיע באף קובץ בצד הלקוח ולא בתגובת הפונקציה.
