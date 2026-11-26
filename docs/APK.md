# بناء ملف APK

الـ APK يُبنى على GitHub Actions (فيه Android SDK وإنترنت)، وليس على جهازك.

## الخطوات
1. **الـ Backend لازم يكون على عنوان HTTPS عام** (مثلاً `https://api.example.com`). تطبيق الأندرويد يمنع HTTP العادي، ولا يستطيع الوصول إلى `localhost` الخاص بجهازك.
2. في GitHub: `Settings → Secrets and variables → Actions → Variables → New repository variable`
   - الاسم: `API_URL`
   - القيمة: `https://api.example.com/api`
3. في ملف `.env` على السيرفر أضف `https://localhost` إلى `CORS_ORIGINS` (هذا هو origin تطبيق Capacitor).
4. افتح تبويب **Actions → Build Android APK → Run workflow**.
5. بعد انتهاء التشغيل نزّل الملف `nq-cleaning-debug-apk` من قسم Artifacts وفك الضغط، ستجد `app-debug.apk`.
6. انقل الملف للموبايل وثبّته (فعّل "التثبيت من مصادر غير معروفة").

## ملاحظات
- هذا APK من نوع **debug** (موقّع بمفتاح debug) مناسب للتجربة الداخلية. للنشر على Google Play يلزم APK/AAB موقّع بمفتاح إصدار خاص بك (keystore)، وهذا غير مُعدّ بعد.
- بدون `API_URL` سيُبنى التطبيق لكنه لن يتصل بأي سيرفر.
- يمكن أيضاً تثبيت التطبيق كـ PWA مباشرة من المتصفح (Add to Home screen) بدون APK.
