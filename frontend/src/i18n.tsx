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
