import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const dict = {
  ar: {
    app: 'NQ Cleaning', login: 'تسجيل الدخول', email: 'البريد الإلكتروني', password: 'كلمة المرور', logout: 'خروج',
    dashboard: 'لوحة التحكم', bookings: 'الحجوزات', customers: 'العملاء', technicians: 'الفنيون', services: 'الخدمات',
    newBooking: 'حجز جديد', newCustomer: 'عميل جديد', save: 'حفظ', cancel: 'إلغاء', search: 'بحث', loading: 'جاري التحميل…',
    name: 'الاسم', mobile: 'الجوال', code: 'الكود', status: 'الحالة', total: 'الإجمالي', date: 'التاريخ', price: 'السعر', minutes: 'المدة (دقيقة)',
    todayTotal: 'حجوزات اليوم', todayNew: 'جديدة', todayConfirmed: 'مؤكدة', todayInProgress: 'جاري التنفيذ', todayDone: 'منفذة', todayCancelled: 'ملغاة',
    tomorrow: 'غداً', late: 'متأخرة', unassigned: 'غير موزعة', revenueToday: 'إيراد اليوم', revenueMonth: 'إيراد الشهر', collectedMonth: 'المحصّل (الشهر)', outstandingMonth: 'المتبقي (الشهر)',
    techAvailable: 'فنيون متاحون', techBusy: 'فنيون مشغولون', techAbsent: 'فنيون غائبون', topServices: 'أكثر الخدمات طلباً', daily: 'الحجوزات اليومية',
    customer: 'العميل', address: 'العنوان', start: 'البداية', pickTechs: 'الفنيون المتاحون', addLine: 'إضافة خدمة', quantity: 'الكمية', discount: 'الخصم',
    duplicateWarn: 'يوجد عميل بنفس رقم الجوال. هل تريد الإضافة رغم ذلك؟', reason: 'السبب', apply: 'تطبيق', noData: 'لا توجد بيانات', saved: 'تم الحفظ',
    allStatuses: 'كل الحالات', branch: 'الفرع', details: 'التفاصيل', history: 'سجل الحالات', assigned: 'الفنيون المكلفون', dark: 'الوضع الداكن', lang: 'English',
    pricingMethod: 'طريقة التسعير', defaultMinutes: 'المدة الافتراضية',
    marketTitle: 'ابشر، اطلب خدمتك من أحسن الشركات', marketSub: 'اختر القطاع، واحنا نوصّلك لشركات موثوقة. احجز في دقائق وارتاح', allSectors: 'كل القطاعات', searchCompany: 'ابحث عن شركة…',
    noCompanies: 'للحين ما فيه شركات هنا. كن أول من يسجّل، ارحب!', newBadge: 'جديد', docs: 'المستندات الرسمية', docsHint: 'ارفع صورة أو PDF (حتى 5 ميجا). تُرسل للإدارة مع بياناتك.', doc_cr: 'السجل التجاري', doc_vat: 'شهادة الضريبة', doc_address: 'العنوان الوطني', upload: 'رفع ملف', replaceFile: 'استبدال', viewFile: 'عرض', fileMismatch: 'البيانات المقروءة من الملف تختلف عمّا كتبت', applyExtracted: 'استخدم البيانات من الملف', docMissing: 'مطلوب', docsFor: 'المستندات المرفوعة', fromFile: 'من الملف', typed: 'المُدخل', welcomeNew: 'ياهلا فيهم! وصلوا حديثاً', openStore: 'ادخل المتجر', servicesFrom: 'تبدأ من', bookSoon: 'الحجز عبر المنصة قريباً', back: 'رجوع', joinAsCompany: 'سجّل شركتك يا هلا',
    companyLogin: 'دخول الشركات', registerTitle: 'تسجيل شركة جديدة', step: 'الخطوة', mobileHint: 'جوال سعودي 05xxxxxxxx', sendCode: 'إرسال الرمز',
    otpCode: 'رمز التحقق', companyName: 'اسم الشركة', ownerName: 'اسم المالك', sectors: 'القطاعات (حتى 3)', createAccount: 'إنشاء الحساب', devCodeNote: 'رمز التطوير (يظهر محلياً فقط)',
    company: 'الشركة', review: 'مراجعة الشركات', cr: 'رقم السجل التجاري (10 أرقام)', vat: 'الرقم الضريبي (15 رقماً)', natAddr: 'العنوان الوطني', building: 'رقم المبنى', street: 'الشارع',
    district: 'الحي', city: 'المدينة', postal: 'الرمز البريدي', additional: 'الرقم الإضافي', description: 'نبذة', slugLabel: 'رابط الواجهة', submitReview: 'إرسال للمراجعة',
    st_draft: 'مسودة', st_pending_review: 'قيد المراجعة', st_approved: 'معتمدة', st_rejected: 'مرفوضة', st_suspended: 'موقوفة', rejectionReason: 'سبب الرفض', missingFields: 'بيانات ناقصة',
    approve: 'اعتماد', reject: 'رفض', suspend: 'إيقاف', reactivate: 'إعادة تفعيل', owner: 'المالك', pendingNote: 'طلبك قيد المراجعة. سنراسلك عند الاعتماد.', lockedNote: 'البيانات القانونية مقفلة بعد الاعتماد.',
    settings: 'الإعدادات', brandColor: 'لون الواجهة', logoUrl: 'رابط الشعار (https)', removeLogo: 'إزالة الشعار',
    signInPhone: 'الدخول بالجوال', signInEmail: 'الدخول بالبريد', verify: 'تحقق',
  },
  en: {
    app: 'NQ Cleaning', login: 'Sign in', email: 'Email', password: 'Password', logout: 'Sign out',
    dashboard: 'Dashboard', bookings: 'Bookings', customers: 'Customers', technicians: 'Technicians', services: 'Services',
    newBooking: 'New booking', newCustomer: 'New customer', save: 'Save', cancel: 'Cancel', search: 'Search', loading: 'Loading…',
    name: 'Name', mobile: 'Mobile', code: 'Code', status: 'Status', total: 'Total', date: 'Date', price: 'Price', minutes: 'Duration (min)',
    todayTotal: "Today's bookings", todayNew: 'New', todayConfirmed: 'Confirmed', todayInProgress: 'In progress', todayDone: 'Done', todayCancelled: 'Cancelled',
    tomorrow: 'Tomorrow', late: 'Late', unassigned: 'Unassigned', revenueToday: 'Revenue today', revenueMonth: 'Revenue this month', collectedMonth: 'Collected (month)', outstandingMonth: 'Outstanding (month)',
    techAvailable: 'Available technicians', techBusy: 'Busy technicians', techAbsent: 'Absent technicians', topServices: 'Top services', daily: 'Bookings per day',
    customer: 'Customer', address: 'Address', start: 'Start', pickTechs: 'Available technicians', addLine: 'Add service', quantity: 'Qty', discount: 'Discount',
    duplicateWarn: 'A customer with this mobile already exists. Create anyway?', reason: 'Reason', apply: 'Apply', noData: 'No data', saved: 'Saved',
    allStatuses: 'All statuses', branch: 'Branch', details: 'Details', history: 'Status history', assigned: 'Assigned technicians', dark: 'Dark mode', lang: 'العربية',
    pricingMethod: 'Pricing method', defaultMinutes: 'Default duration',
    marketTitle: 'Book services from trusted companies', marketSub: 'Pick a sector, then a company, and book in minutes', allSectors: 'All sectors', searchCompany: 'Search companies…',
    noCompanies: 'No approved companies yet. Be the first to join!', newBadge: 'New', docs: 'Official documents', docsHint: 'Upload an image or PDF (up to 5 MB). It is sent to the platform team with your details.', doc_cr: 'Commercial registration', doc_vat: 'VAT certificate', doc_address: 'National address', upload: 'Upload file', replaceFile: 'Replace', viewFile: 'View', fileMismatch: 'Values read from the file differ from what you typed', applyExtracted: 'Use values from the file', docMissing: 'Required', docsFor: 'Uploaded documents', fromFile: 'From file', typed: 'Entered', welcomeNew: 'Just joined. Say hello!', openStore: 'Open store', servicesFrom: 'From', bookSoon: 'Booking through the platform is coming soon', back: 'Back', joinAsCompany: 'Register your company',
    companyLogin: 'Company sign-in', registerTitle: 'Register a new company', step: 'Step', mobileHint: 'Saudi mobile 05xxxxxxxx', sendCode: 'Send code',
    otpCode: 'Verification code', companyName: 'Company name', ownerName: 'Owner name', sectors: 'Sectors (up to 3)', createAccount: 'Create account', devCodeNote: 'Dev code (shown locally only)',
    company: 'Company', review: 'Company review', cr: 'Commercial registration (10 digits)', vat: 'VAT number (15 digits)', natAddr: 'National address', building: 'Building no.', street: 'Street',
    district: 'District', city: 'City', postal: 'Postal code', additional: 'Additional no.', description: 'About', slugLabel: 'Storefront link', submitReview: 'Submit for review',
    st_draft: 'Draft', st_pending_review: 'Pending review', st_approved: 'Approved', st_rejected: 'Rejected', st_suspended: 'Suspended', rejectionReason: 'Rejection reason', missingFields: 'Missing details',
    approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reactivate: 'Reactivate', owner: 'Owner', pendingNote: 'Your request is under review. We will message you once approved.', lockedNote: 'Legal details are locked after approval.',
    settings: 'Settings', brandColor: 'Storefront color', logoUrl: 'Logo URL (https)', removeLogo: 'Remove logo',
    signInPhone: 'Sign in with phone', signInEmail: 'Sign in with e-mail', verify: 'Verify',
  },
} as const;

export type Lang = keyof typeof dict;
export type Key = keyof (typeof dict)['ar'];

interface Ctx { lang: Lang; t: (k: Key) => string; toggle: () => void }
const I18n = createContext<Ctx>(null as unknown as Ctx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try { return localStorage.getItem('nq.lang') === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem('nq.lang', lang); } catch { /* ignore */ }
  }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, t: (k) => dict[lang][k], toggle: () => setLang((l) => (l === 'ar' ? 'en' : 'ar')) }), [lang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = (): Ctx => useContext(I18n);

export const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  new: { ar: 'طلب جديد', en: 'New' }, awaiting_confirmation: { ar: 'بانتظار التأكيد', en: 'Awaiting confirmation' },
  confirmed: { ar: 'مؤكد', en: 'Confirmed' }, awaiting_assignment: { ar: 'بانتظار توزيع الفريق', en: 'Awaiting assignment' },
  assigned: { ar: 'تم توزيع الفريق', en: 'Assigned' }, on_the_way: { ar: 'الفريق في الطريق', en: 'On the way' },
  arrived: { ar: 'وصل الفريق', en: 'Arrived' }, in_progress: { ar: 'جاري التنفيذ', en: 'In progress' }, paused: { ar: 'متوقف مؤقتاً', en: 'Paused' },
  awaiting_review: { ar: 'بانتظار مراجعة المشرف', en: 'Awaiting review' }, done: { ar: 'تم التنفيذ', en: 'Done' }, closed: { ar: 'مغلق', en: 'Closed' },
  postponed: { ar: 'مؤجل', en: 'Postponed' }, cancelled: { ar: 'ملغى', en: 'Cancelled' }, redo: { ar: 'إعادة تنفيذ', en: 'Redo' },
};
