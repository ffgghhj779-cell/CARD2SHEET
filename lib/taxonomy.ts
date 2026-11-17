// Single source of truth for classification. Names are also used as Google Sheets / Excel tab names,
// so each one is <= 31 chars and contains none of: [ ] : * ? / \

export const SECTORS: { name: string; hints: string }[] = [
  { name: "تموين وإعاشة", hints: "تموين، إعاشة، catering، تغذية، وجبات جماعية، مطابخ مركزية" },
  { name: "حج وعمرة", hints: "حج، عمرة، حملات، خدمة ضيوف الرحمن، مطوفين، Hajj, Umrah" },
  { name: "أغذية ومشروبات", hints: "مصانع أغذية، ألبان، مياه، عصائر، تمور، حلويات، توزيع مواد غذائية، FMCG food" },
  { name: "مطاعم ومقاهي", hints: "مطعم، كافيه، قهوة، bakery، مخبز، وجبات سريعة" },
  { name: "تجارة عامة وتوريدات", hints: "تجارة عامة، توريدات، مؤسسة تجارية، تجهيزات، مستلزمات متنوعة، general trading" },
  { name: "تجارة تجزئة ومتاجر", hints: "سوبر ماركت، متجر، retail، معارض بيع، متجر إلكتروني، e-commerce" },
  { name: "استيراد وتصدير", hints: "import, export، وكيل، توكيلات، تخليص جمركي" },
  { name: "سياحة وسفر", hints: "وكالة سفر، سياحة، تذاكر، رحلات، travel agency" },
  { name: "فنادق وضيافة", hints: "فندق، شقق فندقية، شاليهات، منتجع، استراحات، hospitality, resort" },
  { name: "مقاولات وإنشاءات", hints: "مقاولات، إنشاءات، بناء، ترميم، contracting, construction" },
  { name: "هندسة واستشارات هندسية", hints: "مكتب هندسي، تصميم معماري، إشراف، استشارات هندسية، MEP" },
  { name: "مواد بناء وتشطيبات", hints: "حديد، أسمنت، بلاط، سيراميك، دهانات، ألمنيوم، زجاج، أدوات صحية، عزل" },
  { name: "عقارات وتطوير عقاري", hints: "عقار، تطوير عقاري، تسويق عقاري، إدارة أملاك، real estate" },
  { name: "تقنية معلومات وبرمجيات", hints: "برمجيات، software، تطبيقات، cloud، حلول تقنية، ERP، ذكاء اصطناعي، IT" },
  { name: "اتصالات وإنترنت", hints: "اتصالات، شبكات، إنترنت، فايبر، telecom، ISP" },
  { name: "إلكترونيات وأجهزة", hints: "إلكترونيات، أجهزة منزلية، كمبيوتر، جوالات، أجهزة كهربائية" },
  { name: "أمن وسلامة ومراقبة", hints: "كاميرات، حراسات أمنية، إطفاء، سلامة، أنظمة إنذار، security" },
  { name: "صناعة وتصنيع", hints: "مصنع، تصنيع، معدات صناعية، آلات، خطوط إنتاج، manufacturing" },
  { name: "طباعة وتغليف", hints: "مطبعة، تغليف، كراتين، بلاستيك تغليف، دعاية مطبوعة، packaging" },
  { name: "كيماويات وبتروكيماويات", hints: "كيماويات، منظفات صناعية، بتروكيماويات، أسمدة" },
  { name: "نفط وغاز وطاقة", hints: "نفط، غاز، بترول، كهرباء، محطات، oil & gas، طاقة تقليدية" },
  { name: "طاقة متجددة", hints: "طاقة شمسية، رياح، solar، كفاءة طاقة" },
  { name: "بيئة ومياه ونظافة", hints: "معالجة مياه، صرف صحي، نظافة، إعادة تدوير، نفايات، تعقيم" },
  { name: "نقل وشحن ولوجستيات", hints: "شحن، نقل، لوجستيات، توصيل، مستودعات، cargo، freight، courier" },
  { name: "سيارات وقطع غيار", hints: "سيارات، معارض سيارات، قطع غيار، تأجير سيارات، ورش، إطارات" },
  { name: "طيران", hints: "طيران، خطوط جوية، مطارات، aviation" },
  { name: "بنوك وخدمات مالية", hints: "بنك، تمويل، استثمار، صرافة، مدفوعات، fintech" },
  { name: "تأمين", hints: "تأمين، insurance، وساطة تأمين" },
  { name: "محاسبة وتدقيق", hints: "محاسب قانوني، تدقيق، audit، زكاة وضريبة، مكتب محاسبة" },
  { name: "محاماة وخدمات قانونية", hints: "محامي، مكتب محاماة، استشارات قانونية، legal" },
  { name: "استشارات إدارية وأعمال", hints: "استشارات إدارية، تطوير أعمال، دراسات جدوى، consulting" },
  { name: "موارد بشرية وتوظيف", hints: "توظيف، استقدام، موارد بشرية، recruitment، manpower، عمالة" },
  { name: "تسويق وإعلان وعلاقات عامة", hints: "تسويق، إعلان، علاقات عامة، سوشيال ميديا، branding، وكالة إبداعية" },
  { name: "إعلام ونشر وإنتاج", hints: "إعلام، قناة، صحيفة، نشر، إنتاج فني، تصوير، media" },
  { name: "معارض ومؤتمرات وفعاليات", hints: "تنظيم معارض، مؤتمرات، فعاليات، events، exhibition organizer" },
  { name: "تعليم وتدريب", hints: "مدرسة، جامعة، معهد، تدريب، أكاديمية، education" },
  { name: "رعاية صحية ومستشفيات", hints: "مستشفى، عيادة، مجمع طبي، مختبر، أسنان، healthcare" },
  { name: "أدوية ومستلزمات طبية", hints: "صيدلية، أدوية، أجهزة طبية، مستلزمات طبية، pharma" },
  { name: "تجميل وعناية شخصية", hints: "صالون، تجميل، عطور، مستحضرات، عناية، spa" },
  { name: "أزياء وملابس ومنسوجات", hints: "ملابس، أزياء، أقمشة، عبايات، خياطة، أحذية، textile" },
  { name: "مجوهرات وساعات", hints: "ذهب، مجوهرات، ساعات، jewelry" },
  { name: "أثاث وديكور", hints: "أثاث، ديكور، مفروشات، تصميم داخلي، سجاد، interior" },
  { name: "زراعة وثروة حيوانية", hints: "زراعة، مزارع، ثروة حيوانية، دواجن، أسماك، أعلاف، بذور" },
  { name: "تشغيل وصيانة ومرافق", hints: "صيانة، تشغيل، إدارة مرافق، facility management، تكييف، مصاعد" },
  { name: "رياضة وترفيه", hints: "رياضة، نادي، جيم، ترفيه، ألعاب، fitness، entertainment" },
  { name: "جهات حكومية ورسمية", hints: "وزارة، هيئة، أمانة، بلدية، جهة حكومية، government" },
  { name: "جمعيات وقطاع غير ربحي", hints: "جمعية خيرية، وقف، مؤسسة غير ربحية، NGO" },
  { name: "أخرى", hints: "فقط إذا لم يناسب أي قطاع آخر إطلاقاً" },
];
export const SECTOR_NAMES = SECTORS.map((s) => s.name);

export const LEVELS = [
  "1 - الإدارة العليا",
  "2 - الإدارة الوسطى",
  "3 - الإدارة الإشرافية",
  "4 - الموظفون والمختصون",
  "5 - غير محدد",
] as const;

export const LEVEL_HINTS = `
"1 - الإدارة العليا": مالك، مؤسس، شريك، رئيس مجلس الإدارة، عضو مجلس إدارة، الرئيس التنفيذي، المدير العام، المدير التنفيذي، نائب الرئيس، المدير الإقليمي، Owner, Founder, Partner, Chairman, CEO, GM, Managing Director, President, VP, C-level (CFO/COO/CTO/CMO).
"2 - الإدارة الوسطى": مدير إدارة أو قسم أو فرع أو مشروع (مدير المبيعات، مدير المشتريات، مدير التسويق، مدير الفرع، مدير المشاريع)، Head of ..., Director of ..., ... Manager.
"3 - الإدارة الإشرافية": مشرف، رئيس قسم صغير، رئيس فريق، منسق، مساعد مدير، Supervisor, Team Leader, Coordinator, Assistant Manager, Section Head.
"4 - الموظفون والمختصون": مندوب، أخصائي، مهندس، محاسب، فني، موظف، ممثل مبيعات، Sales Executive/Representative, Specialist, Engineer, Accountant, Officer, Consultant (فرد).
"5 - غير محدد": لا يوجد مسمى وظيفي أو كارت شركة عام بدون شخص.`;

export const DEPARTMENTS = [
  "الإدارة العامة", "المبيعات", "التسويق", "المشتريات والتوريد", "العمليات والتشغيل",
  "المالية والمحاسبة", "الموارد البشرية", "تقنية المعلومات", "الهندسة والمشاريع",
  "خدمة العملاء", "الشؤون القانونية", "الجودة والسلامة", "البحث والتطوير",
  "العلاقات العامة والإعلام", "اللوجستيات والمستودعات", "الشؤون الطبية", "أخرى", "غير محدد",
] as const;

export const DECISION = ["نعم", "لا"] as const;

export const SUMMARY_TAB = "ملخص";
export const MASTER_TAB_DEFAULT = "كل العملاء";

const norm = (s: string) =>
  (s || "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[\s\-_.]/g, "").replace(/^ال/, "").toLowerCase();

/** Map any free-text value onto the closest allowed enum value (used for corrections & safety). */
export function matchEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  const v = norm(value);
  if (!v) return fallback;
  const exact = allowed.find((a) => norm(a) === v);
  if (exact) return exact;
  if (allowed === (LEVELS as readonly string[]) && /^[1-5]/.test(value.trim())) return allowed[Number(value.trim()[0]) - 1];
  if (v.length < 3) return fallback;
  const part = allowed.find((a) => norm(a).includes(v) || v.includes(norm(a).replace(/^\d/, "")));
  return part ?? fallback;
}

export const levelRank = (l: string) => {
  const i = LEVELS.indexOf(l as (typeof LEVELS)[number]);
  return i < 0 ? 9 : i;
};
