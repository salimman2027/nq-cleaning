# النشر على MonsterASP.NET

## ما تأكدت منه من وثائق المزوّد
- **Node.js مدعوم** عبر IIS و HttpPlatform، مع ملف `web.config` إلزامي. المنفذ يُعطى ديناميكياً عبر `PORT` (المنافذ الثابتة لا تعمل).
- **لا يوجد shell ولا `npm` على السيرفر.** لذلك حزمة النشر تُبنى على GitHub وبداخلها `node_modules` جاهزة (workflow: **Package for MonsterASP**).
- **قاعدة البيانات SQL Server 2025**: تدعم Triggers و Sequences و `STRING_AGG` و `THROW` المستخدمة في المشروع.
- **الوصول عن بُعد لقاعدة البيانات** يُفعَّل من لوحة التحكم (منفذ 1433 عبر TLS)، وهذا ما يستخدمه workflow **Database setup**.
- الخطة المجانية: موقع واحد وقاعدة واحدة بحجم 1GB، **بدون نسخ احتياطي تلقائي** (تنزّل ملف .bak بنفسك).

## ما لم أستطع التأكد منه (تتأكد منه بعد أول رفع)
- **إصدار Node.js على السيرفر** (غير مذكور في الوثائق). المشروع يحتاج Node 18 أو أحدث.
- **هل الخطة المجانية تشغّل Node.js** بنفس الشروط (غير مذكور).
- حدود الذاكرة والمعالج، وهل تتوقف العملية عند الخمول.
إذا فشل التشغيل فالسبب غالباً أحد هذه الثلاثة، وستجد السبب في `logs/node*` على السيرفر.

## الخطوات
1. **اجمع بيانات قاعدة البيانات** من لوحة التحكم: اسم قاعدة البيانات، المستخدم، كلمة المرور، العنوان الداخلي (للموقع)، والعنوان العام (للـ workflow). فعّل **Remote access**.
2. **جهّز القاعدة**: في GitHub أضف Secrets (`DB_SERVER`=العنوان العام، `DB_NAME`، `DB_USER`، `DB_PASSWORD`، `ADMIN_EMAIL`، `ADMIN_PASSWORD` من 12 حرفاً فأكثر) ثم شغّل **Actions → Database setup**. هذا ينشئ الجداول والصلاحيات وأول مسؤول.
3. **نزّل الحزمة**: **Actions → Package for MonsterASP → Run workflow**، ثم نزّل `nq-cleaning-monsterasp.zip` من Artifacts.
4. **ارفعها**: فك الضغط وارفع المحتوى كله إلى `wwwroot` (يفضّل ZIP deploy أو سطر الأوامر؛ الوثائق تنصح بعدم استخدام FTP لكثرة ملفات `node_modules`).
5. **عدّل `web.config` على السيرفر** واستبدل كل `REPLACE_ME` (العنوان الداخلي لقاعدة البيانات، المستخدم، كلمة المرور، `JWT_ACCESS_SECRET` عشوائي 48 حرفاً، ورابط موقعك في `CORS_ORIGINS`). لا ترفع الأسرار إلى GitHub.
6. افتح الموقع: `https://موقعك/api/health` يجب أن يرجع `{"status":"ok"}`، ثم الصفحة الرئيسية للدخول.
7. **للـ APK**: ضع `API_URL = https://موقعك/api` كـ Variable في GitHub وشغّل **Build Android APK**.

## المصادر
- [How to run Node.js application (MonsterASP help)](https://help.monsterasp.net/books/nodejs/page/how-to-run-nodejs-application)
- [Node.js support announcement](https://forum.monsterasp.net/d/1-announcement-nodejs-support)
- [SQL Server 2025 hosting (MonsterASP)](https://www.monsterasp.net/MSSQL-2025-Hosting/)
