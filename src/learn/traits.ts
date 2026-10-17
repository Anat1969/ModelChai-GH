/**
 * The bridge between mathematics and architecture (DECISIONS.md 100). A trait is a property of a mathematical
 * model that has a spatial consequence. Uses are not attached to models by hand: each use says which traits
 * serve it and why, and a model's recommended uses follow from its traits. So every recommendation can be read
 * back as "because the model has this property, and this property does that in space" — and checked.
 */

export type TraitId =
  | 'single_edge'
  | 'closed_loop'
  | 'open_path'
  | 'twist'
  | 'cusps'
  | 'symmetry'
  | 'ascent'
  | 'growth'
  | 'ruled'
  | 'pure_compression'
  | 'one_sided'
  | 'constant_width'
  | 'rhythm'
  | 'two_lobes'
  | 'self_crossing'
  | 'discrete'
  | 'saddle'
  | 'tiling'
  | 'focal'
  | 'self_similar'
  | 'fastest_descent'

export interface Trait {
  id: TraitId
  label: string
  /** What the property is, mathematically, in one plain sentence. */
  math: string
  /** What it does in space: flow, movement, light, structure. */
  space: string
}

export const TRAITS: Record<TraitId, Trait> = {
  single_edge: { id: 'single_edge', label: 'קצה אחד רציף', math: 'לכל הצורה יש קו גבול אחד, שחוזר אל עצמו.', space: 'אין "קצה של המבנה": ההליכה לאורך הגבול לא נגמרת, והמבט נמשך הלאה.' },
  closed_loop: { id: 'closed_loop', label: 'לולאה סגורה', math: 'המסלול חוזר לנקודת ההתחלה.', space: 'מקיף חלל: נוצרת חצר, והתנועה היא הקפה ולא מעבר.' },
  open_path: { id: 'open_path', label: 'מסלול פתוח', math: 'למסלול יש התחלה וסוף.', space: 'מוביל ממקום למקום: כיוון ברור, רצף של לפני, בתוך ואחרי.' },
  twist: { id: 'twist', label: 'פיתול', math: 'החתך מסתובב לאורך המסלול.', space: 'הרצפה הופכת לקיר ולתקרה: האור, הצל והמבט משתנים בכל צעד.' },
  cusps: { id: 'cusps', label: 'חודים', math: 'נקודות שבהן העקומה משנה כיוון בחדות.', space: 'מסמנים כיוון ונקודות ציון. בין החודים נוצרים מפרצים מוגנים.' },
  symmetry: { id: 'symmetry', label: 'סימטריה סיבובית', math: 'הצורה חוזרת על עצמה אחרי סיבוב חלקי.', space: 'כמה כניסות שוות, בלי חזית אחורית. אותו יחס לכל כיוון בעיר.' },
  ascent: { id: 'ascent', label: 'עלייה רציפה', math: 'המסלול מטפס בקצב קבוע לאורך הסיבוב.', space: 'תנועה אנכית בלי מדרגות: רמפה, תצפית שנפתחת בהדרגה.' },
  growth: { id: 'growth', label: 'צמיחה ביחס קבוע', math: 'כל צעד גדל באותו יחס לקודמו.', space: 'רצף חללים שגדלים בהדרגה: מהאינטימי אל הפתוח, בלי קפיצות.' },
  ruled: { id: 'ruled', label: 'משטח שנוצר מקווים ישרים', math: 'דרך כל נקודה במשטח עובר קו ישר שכולו על המשטח.', space: 'משטח מעוקל שאפשר לבנות מקורות ישרות: יעיל בחומר ובביצוע.' },
  pure_compression: { id: 'pure_compression', label: 'זרימת כוח טהורה', math: 'הצורה שבה שרשרת תלויה מתייצבת: כל נקודה במתיחה בלבד, והפוכה בלחיצה בלבד.', space: 'קשת וקמרון שעומדים בלי כפיפה, בחומר דק: מפתחים גדולים.' },
  one_sided: { id: 'one_sided', label: 'חד־צדדיות', math: 'למשטח יש צד אחד בלבד: אין "פנים" ו"חוץ" נפרדים.', space: 'ההולך עובר מפנים לחוץ בלי לחצות דופן. חוויה של היפוך.' },
  constant_width: { id: 'constant_width', label: 'רוחב קבוע', math: 'המרחק בין שני קווים מקבילים שנוגעים בצורה זהה בכל כיוון.', space: 'מרחב שאין לו כיוון מועדף אבל הוא לא עיגול: מרכז בלי היררכיה.' },
  rhythm: { id: 'rhythm', label: 'מחזוריות', math: 'אותו דפוס חוזר במרווחים קבועים.', space: 'קצב של פתוח וסגור, אור וצל, לאורך הליכה.' },
  two_lobes: { id: 'two_lobes', label: 'שתי לולאות בקו אחד', math: 'עקומה אחת שחוצה את עצמה ויוצרת שני אזורים.', space: 'שתי חצרות עם מסלול משותף: שתי תוכניות שחולקות כניסה.' },
  self_crossing: { id: 'self_crossing', label: 'מסלול שחוצה את עצמו', math: 'הקו עובר מעל ומתחת לעצמו.', space: 'מפלסים שעוברים זה מעל זה: גשרים, מבטים מלמעלה על מי שהולך מתחת.' },
  discrete: { id: 'discrete', label: 'בדיד שמתקרב לרציף', math: 'סכום של חלקים נפרדים שמתקרב לעקומה רציפה.', space: 'קירות או עמודים נפרדים שיוצרים יחד צורה אחת: מסננים אור, מאפשרים מעבר.' },
  saddle: { id: 'saddle', label: 'עקמומיות כפולה הפוכה', math: 'עולה בכיוון אחד ויורד בכיוון הניצב לו.', space: 'קליפה דקה שמכסה מפתח גדול בלי עמודים, ופתוחה לשני צדדים.' },
  tiling: { id: 'tiling', label: 'ריצוף', math: 'חלוקה של משטח לאריחים בלי חפיפה ובלי רווח.', space: 'מערכת מודולרית לחזיתות, ריצוף וקירוי: כל חלק שונה וכולם שייכים.' },
  focal: { id: 'focal', label: 'מוקדים', math: 'נקודות שכל הקרניים מהקו מתכנסות אליהן.', space: 'קול ואור מתרכזים בנקודה: מקום לדובר, לבמה, לגלריית לחישות.' },
  self_similar: { id: 'self_similar', label: 'דמיון עצמי', math: 'כל חלק דומה לשלם, בכל קנה מידה.', space: 'אותו סדר מהעיר ועד הפרט: הסתעפות, הצללה מדורגת, פרטים שמתגלים מקרוב.' },
  fastest_descent: { id: 'fastest_descent', label: 'הירידה המהירה ביותר', math: 'העקומה שבה גוף מחליק מנקודה לנקודה בזמן הקצר ביותר.', space: 'מגלשות, רמפות ומים: תנועה שמאיצה בהתחלה ומתמתנת בסוף.' },
}

export type UseId =
  | 'pavilion'
  | 'gateway'
  | 'bridge'
  | 'tower'
  | 'ramp'
  | 'gallery'
  | 'shade'
  | 'gathering'
  | 'promenade'
  | 'courtyard'
  | 'sculpture'
  | 'canopy'
  | 'playground'
  | 'facade'

export interface Use {
  id: UseId
  label: string
  /** What the use needs from a form, in one sentence. */
  needs: string
  /** Traits that serve it, with weight 1–3 and the reason; a negative weight is a trait that works against it. */
  traits: Partial<Record<TraitId, { w: number; why: string }>>
}

export const USES: Record<UseId, Use> = {
  pavilion: {
    id: 'pavilion',
    label: 'ביתן',
    needs: 'מקום לשהות קצרה: צל, ישיבה, חוויה אחת ברורה.',
    traits: {
      closed_loop: { w: 2, why: 'הלולאה יוצרת חצר מוגנת שאפשר לשהות בה.' },
      single_edge: { w: 2, why: 'הקצה הרציף הופך את הביקור להליכה שלא נגמרת, חוויה אחת ברורה.' },
      one_sided: { w: 2, why: 'המעבר מפנים לחוץ בלי דופן הוא החוויה עצמה.' },
      symmetry: { w: 1, why: 'נכנסים מכל כיוון, ואין חזית אחורית.' },
      twist: { w: 1, why: 'האור משתנה לאורך ההקפה, ולכן יש סיבה להקיף.' },
    },
  },
  gateway: {
    id: 'gateway',
    label: 'שער וכניסה לעיר',
    needs: 'סף ברור: לפני, מעבר, אחרי. סימון מרחוק וחוויה של כניסה.',
    traits: {
      open_path: { w: 3, why: 'מסלול עם התחלה וסוף הוא בדיוק רצף של התקרבות, מעבר והגעה.' },
      pure_compression: { w: 2, why: 'קשת בזרימת כוח טהורה עוברת מעל הדרך במפתח גדול ובחומר דק.' },
      cusps: { w: 2, why: 'החוד מסמן את השער מרחוק ומכוון את המבט.' },
      twist: { w: 2, why: 'הפיתול משנה את האור והמבט ברגע המעבר, כך שהכניסה מורגשת.' },
      growth: { w: 1, why: 'רצף שגדל או מצטמצם מבטא התקרבות: מהפתוח אל המוגן, או להפך.' },
      closed_loop: { w: -1, why: 'לולאה סגורה מקיפה ולא מובילה: היא מזמינה להישאר ולא לעבור.' },
    },
  },
  bridge: {
    id: 'bridge',
    label: 'גשר הולכי רגל',
    needs: 'מעבר מעל מכשול, מפתח גדול, מבט החוצה.',
    traits: {
      open_path: { w: 3, why: 'גשר הוא מסלול מגדה לגדה.' },
      pure_compression: { w: 3, why: 'הקשת או השרשרת נושאות את המפתח בלי כפיפה.' },
      self_crossing: { w: 2, why: 'מסלול שעובר מעל עצמו פותר מפגש של שני כיווני הליכה.' },
      twist: { w: 1, why: 'הפיתול הופך את המעקה לגג ופותח מבטים מתחלפים.' },
      ruled: { w: 1, why: 'קורות ישרות בונות את המשטח המעוקל ביעילות.' },
    },
  },
  tower: {
    id: 'tower',
    label: 'מגדל תצפית',
    needs: 'עלייה, יציבות, ונוף שנפתח בהדרגה.',
    traits: {
      ascent: { w: 3, why: 'העלייה הרציפה היא הדרך למעלה, בלי מדרגות.' },
      ruled: { w: 3, why: 'היפרבולואיד מקורות ישרות קשיח ויעיל בגובה.' },
      growth: { w: 2, why: 'היחס הקבוע נותן התחדדות טבעית כלפי מעלה.' },
      symmetry: { w: 1, why: 'סימטריה מאזנת עומסי רוח מכל כיוון.' },
    },
  },
  ramp: {
    id: 'ramp',
    label: 'רמפה ומעבר בין מפלסים',
    needs: 'שיפוע נגיש ורציף בין גבהים.',
    traits: {
      ascent: { w: 3, why: 'טיפוס בקצב קבוע הוא רמפה נגישה.' },
      fastest_descent: { w: 2, why: 'העקומה מתאימה לתנועה מהירה למטה: מגלשה, מים, רוכבים.' },
      open_path: { w: 1, why: 'יש התחלה וסוף, כמו בכל מעבר בין מפלסים.' },
    },
  },
  gallery: {
    id: 'gallery',
    label: 'גלריה ומוזיאון',
    needs: 'רצף חדרים, סדר צפייה, אור מבוקר.',
    traits: {
      growth: { w: 3, why: 'חללים שגדלים ביחס קבוע יוצרים סדר צפייה מובנה.' },
      open_path: { w: 2, why: 'מסלול פתוח הוא סיפור עם התחלה וסוף.' },
      discrete: { w: 2, why: 'קירות נפרדים מחלקים לחדרים ומסננים אור.' },
      focal: { w: 1, why: 'המוקדים יוצרים נקודה אקוסטית או נקודת מבט מרכזית.' },
      closed_loop: { w: 1, why: 'הקפה מחזירה את המבקר לכניסה.' },
    },
  },
  shade: {
    id: 'shade',
    label: 'הצללה',
    needs: 'צל משתנה לאורך היום, אוורור, פתיחות.',
    traits: {
      saddle: { w: 3, why: 'קליפה דקה מכסה מפתח גדול ומשאירה את הצדדים פתוחים לרוח.' },
      discrete: { w: 2, why: 'אלמנטים נפרדים מטילים צל מסונן ומעבירים אוויר.' },
      twist: { w: 2, why: 'הפיתול מפנה חלקים שונים לשמש בשעות שונות.' },
      self_similar: { w: 2, why: 'הסתעפות יוצרת צל מדורג, כמו עץ.' },
      cusps: { w: 1, why: 'בין החודים נוצרים מפרצים מוצלים.' },
    },
  },
  gathering: {
    id: 'gathering',
    label: 'מקום כינוס ואמפיתאטרון',
    needs: 'מבט משותף אל מרכז, שמיעה טובה.',
    traits: {
      focal: { w: 3, why: 'קול ממוקד אחד מגיע אל המוקד השני: במה ושמיעה טבעית.' },
      closed_loop: { w: 2, why: 'המעגל מכנס את כולם סביב מרכז אחד.' },
      constant_width: { w: 2, why: 'מרחק שווה מכל צד: אין מקום טוב יותר מאחר.' },
      symmetry: { w: 1, why: 'כל צד שווה.' },
    },
  },
  promenade: {
    id: 'promenade',
    label: 'טיילת ומסלול הליכה',
    needs: 'הליכה ארוכה עם קצב, עצירות ונוף משתנה.',
    traits: {
      rhythm: { w: 3, why: 'המחזוריות פותחת וסוגרת את הנוף בקצב קבוע.' },
      single_edge: { w: 2, why: 'הקצה הרציף הוא מסלול שלא נקטע.' },
      two_lobes: { w: 2, why: 'שתי לולאות נותנות שני מסלולים קצרים או אחד ארוך.' },
      open_path: { w: 1, why: 'מוביל ממקום למקום.' },
    },
  },
  courtyard: {
    id: 'courtyard',
    label: 'חצר וכיכר',
    needs: 'מרחב פתוח מוגדר, מוגן, עם כניסות.',
    traits: {
      closed_loop: { w: 3, why: 'הלולאה מגדירה את החצר.' },
      constant_width: { w: 2, why: 'מרחב בלי כיוון מועדף, שווה לכל הנכנסים.' },
      two_lobes: { w: 2, why: 'שתי חצרות לשני שימושים, עם מעבר ביניהן.' },
      symmetry: { w: 1, why: 'כניסות שוות מכל צד.' },
      tiling: { w: 1, why: 'הריצוף מארגן את הקרקע בלי היררכיה.' },
    },
  },
  sculpture: {
    id: 'sculpture',
    label: 'פסל סביבתי',
    needs: 'צורה שנקראת מכל כיוון ומשתנה בתנועה סביבה.',
    traits: {
      self_crossing: { w: 3, why: 'קשר נראה אחרת מכל זווית.' },
      one_sided: { w: 3, why: 'המשטח החד־צדדי מעורר שאלה: איפה הפנים?' },
      single_edge: { w: 2, why: 'קו אחד שאפשר לעקוב אחריו בעין.' },
      twist: { w: 2, why: 'הפיתול משנה את הקריאה בכל צעד.' },
      cusps: { w: 1, why: 'חודים יוצרים צללית חדה.' },
    },
  },
  canopy: {
    id: 'canopy',
    label: 'גג וחופה',
    needs: 'כיסוי גדול, קל, עם מעט תמיכות.',
    traits: {
      saddle: { w: 3, why: 'עקמומיות כפולה הפוכה נותנת קשיחות לקליפה דקה.' },
      pure_compression: { w: 3, why: 'קמרון בזרימת כוח טהורה עומד בלי כפיפה.' },
      ruled: { w: 2, why: 'נבנה מקורות ישרות.' },
      tiling: { w: 2, why: 'הקירוי מתחלק לאלמנטים מודולריים.' },
      self_similar: { w: 1, why: 'הסתעפות מחלקת את העומס מעמוד אחד לגג רחב.' },
    },
  },
  playground: {
    id: 'playground',
    label: 'גן משחקים',
    needs: 'תנועה, הפתעה, מפלסים, גלישה.',
    traits: {
      fastest_descent: { w: 3, why: 'המגלשה המהירה ביותר בין שתי נקודות.' },
      one_sided: { w: 2, why: 'מסלול שבו אי אפשר לדעת אם אתה בפנים או בחוץ.' },
      self_crossing: { w: 2, why: 'עוברים מעל ומתחת לעצמך.' },
      ascent: { w: 1, why: 'טיפוס הדרגתי.' },
    },
  },
  facade: {
    id: 'facade',
    label: 'חזית ומעטפת',
    needs: 'סינון אור ומבט, אחידות עם גיוון.',
    traits: {
      tiling: { w: 3, why: 'ריצוף מכסה את החזית בלי רווח, באלמנטים שחוזרים.' },
      self_similar: { w: 2, why: 'אותו סדר נקרא מרחוק ומקרוב.' },
      discrete: { w: 2, why: 'אלמנטים נפרדים מסננים אור ומבט.' },
      rhythm: { w: 2, why: 'קצב קבוע נותן סדר לחזית.' },
    },
  },
}

export interface UseFit {
  use: Use
  score: number
  /** Why it fits: one line per trait the model has that serves the use. */
  reasons: { trait: Trait; why: string }[]
  /** Why it may not: traits the model has that work against the use. */
  against: { trait: Trait; why: string }[]
}

/** How well a set of traits serves a use, and why. Pure, so the reasoning is tested. */
export function fitUse(traits: TraitId[], use: Use): UseFit {
  const reasons: UseFit['reasons'] = []
  const against: UseFit['against'] = []
  let score = 0
  for (const t of traits) {
    const r = use.traits[t]
    if (!r) continue
    score += r.w
    ;(r.w > 0 ? reasons : against).push({ trait: TRAITS[t], why: r.why })
  }
  return { use, score, reasons, against }
}

/** The uses a model suits, best first, only those with at least one reason. */
export function usesFor(traits: TraitId[], limit = 4): UseFit[] {
  return Object.values(USES)
    .map((u) => fitUse(traits, u))
    .filter((f) => f.score > 0 && f.reasons.length > 0)
    .sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length)
    .slice(0, limit)
}
