/** Suggested structure for a services company: sectors → sections → suggested service names. No prices: the company sets them. */
export interface StarterSection { ar: string; en: string; services: { ar: string; en: string }[] }
export interface StarterSector { ar: string; en: string; sections: StarterSection[] }

export const STARTER: StarterSector[] = [
  {
    ar: 'قطاع الأفراد', en: 'Individuals',
    sections: [
      { ar: 'النظافة والمكافحة', en: 'Cleaning & pest control', services: [
        { ar: 'تنظيف عميق للمنازل', en: 'Deep home cleaning' }, { ar: 'تنظيف الشقق بعد التسليم', en: 'Post-handover apartment cleaning' },
        { ar: 'تنظيف المجالس والكنب', en: 'Majlis & sofa cleaning' }, { ar: 'غسيل وتعقيم خزانات المياه', en: 'Water tank washing' },
        { ar: 'غسيل المكيفات', en: 'AC washing' }, { ar: 'مكافحة الحشرات', en: 'Insect control' }, { ar: 'مكافحة القوارض', en: 'Rodent control' } ] },
      { ar: 'الصيانة', en: 'Maintenance', services: [
        { ar: 'سباكة', en: 'Plumbing' }, { ar: 'كهرباء', en: 'Electrical' }, { ar: 'صيانة وتركيب المكيفات', en: 'AC repair & installation' },
        { ar: 'نجارة وتركيب أثاث', en: 'Carpentry & furniture assembly' }, { ar: 'دهانات', en: 'Painting' }, { ar: 'كشف تسربات المياه', en: 'Water leak detection' } ] },
    ],
  },
  {
    ar: 'قطاع المشاريع والتعاقدات الشهرية', en: 'Projects & monthly contracts',
    sections: [
      { ar: 'مشاريع المرة الواحدة', en: 'One-time projects', services: [
        { ar: 'تنظيف ما بعد البناء', en: 'Post-construction cleaning' }, { ar: 'تنظيف الواجهات الزجاجية', en: 'Glass facade cleaning' },
        { ar: 'تعقيم وتطهير المنشآت', en: 'Facility disinfection' }, { ar: 'مكافحة حشرات للمنشآت', en: 'Facility pest control' }, { ar: 'صيانة شاملة لمبنى', en: 'Full building maintenance' } ] },
      { ar: 'العقود الشهرية', en: 'Monthly contracts', services: [
        { ar: 'نظافة شهرية للمكاتب والمحلات', en: 'Monthly office & shop cleaning' }, { ar: 'مكافحة دورية شهرية', en: 'Monthly pest control' },
        { ar: 'صيانة وقائية شهرية', en: 'Monthly preventive maintenance' }, { ar: 'عمالة نظافة للمنشآت', en: 'On-site cleaning crew' } ] },
    ],
  },
];
