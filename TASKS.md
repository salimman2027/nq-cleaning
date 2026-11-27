# NQ Cleaning — TASKS

الحالة: `[ ]` لم يبدأ · `[~]` مكتوب لكن لم يُجمَّع/يُختبر بعد · `[x]` مكتمل ومُختبر

> **مهم:** لا توجد شبكة في بيئة التطوير التي كُتب فيها الكود، فلم يُنفَّذ `npm install` ولا Build كامل ولا اختبارات التكامل.
> الوحيد المُختبر فعلياً: اختبارات المنطق الصافي (`backend/src/lib`، 7 اختبارات نجحت).
> التحقق الحقيقي يتم على GitHub Actions (`ci.yml`) — أي خطأ يظهر هناك يُصلَح أولاً.

## Phase 0 — الأساس
- [x] هيكل المستودع، `.gitignore`، `.env.example`، docker-compose، Dockerfiles
- [~] CI: build + test على SQL Server (`ci.yml`)
- [~] workflow بناء APK (`android-apk.yml`)
- [~] حزمة نشر MonsterASP (`package-monsterasp.yml`) + إعداد قاعدة البيانات عن بُعد (`db-setup.yml`) — راجع `docs/MONSTERASP.md`
- [~] Migrations: `001_core.sql`، `002_phase1_ops.sql` (لم تُشغَّل على SQL Server بعد)

## Phase 1
- [~] Auth: JWT + Refresh Token Rotation + كشف إعادة الاستخدام + bcrypt
- [~] RBAC داخل Backend (20 صلاحية، 10 أدوار) + عزل الشركة/الفرع
- [~] Customers + Addresses + تنبيه التكرار بالجوال
- [~] Services + ServicePrices (أسعار بتواريخ، سعر خاص بنوع العميل)
- [~] Technicians + الإجازات + التوفر
- [~] Bookings: إنشاء، تعيين، حالات (15 حالة)، إعادة جدولة، منع التكرار (Idempotency)
- [~] منع التعارض: applock + فحص زمن الانتقال 30 دقيقة + Trigger على مستوى قاعدة البيانات
- [~] Dashboard من بيانات فعلية
- [~] اختبارات تكامل: دورة الحجز، التعارض المتزامن، الصلاحيات، تدوير الـ tokens (`src/integration`)
- [~] Frontend: دخول، Dashboard، حجوزات، عملاء، فنيون، خدمات، RTL/LTR، داكن، PWA
- [ ] المشرفون (جدول `Supervisors` موجود، لا API ولا شاشة)
- [ ] مهارات الفنيين، التوفر الأسبوعي، ساعات العمل
- [ ] نسخ الحجز، الحجز المتكرر
- [ ] Seed الكامل (3 فروع، 50 عميل، 15 خدمة، 30 فني، 100 حجز…)
- [ ] مؤشرات Dashboard: متوسط التقييم، استغلال الساعات، صافي الربح (تُرجَع كـ null وليست أرقاماً مزيفة)

## Phase 2 — PWA الفني، Dispatch، GPS، الجودة، المرفقات
- [ ] لم يبدأ (دور Technician لا يملك أي صلاحيات حالياً عمداً)

## Phase 3 — الفواتير، التحصيلات، الاشتراكات، التكاليف
- [ ] لم يبدأ. لا يوجد أي ادعاء بالتوافق مع ZATCA.

## Phase 4 — بوابة العميل، WhatsApp، التقارير، النشر
- [ ] لم يبدأ

## Platform (marketplace) — مبنية محلياً، لم تُرفع ولم تُختبر على CI
- [~] 003_platform.sql: القطاعات، حالة الشركة، OTP، سجل الإشعارات
- [~] OTP بالجوال (HMAC، صلاحية 5 دقائق، 5 محاولات، حد ساعي)، تسجيل دخول بالجوال
- [~] تسجيل شركة (جوال + OTP) ← مسودة ← إكمال السجل/الضريبي/العنوان الوطني ← إرسال للمراجعة
- [~] قسم المراجعة: اعتماد/رفض بسبب/إيقاف/إعادة تفعيل + إشعار المالك برابط لوحة التحكم
- [~] حجب واجهات الشركة (tenant) حتى الاعتماد، وفصل صلاحيات المنصة عن الشركات
- [~] واجهة السوق العامة (قطاعات، شركات، واجهة شركة بأسعار "تبدأ من")
- [~] بيانات تجريبية قابلة للحذف (`npm run seed:demo -w backend`، `-- --purge`)
- [ ] **إرسال الرسائل فعلياً**: مزود WhatsApp Cloud API مكتوب لكنه غير مُجرَّب ويحتاج حساب Meta وقوالب معتمدة. **SMS غير منفَّذ.** الوضع الافتراضي `dev` لا يرسل شيئاً.
- [ ] حجز العميل من الموقع (حساب بالجوال + OTP)، ربطه بعميل الشركة، رسالة الحجز للشركة
- [ ] عمولة 1 ريال لكل حجز وكشف حساب شهري
- [ ] اشتراك 99 ريال/شهر + بوابة دفع (لم تُختر بعد)
- [ ] تصميم أصلي نهائي (شعار/ألوان من المالك؛ لا نسخ لهوية جهة أخرى)
- [ ] ولاء/باقات/بطاقات هدايا، حملات WhatsApp، مساعد ذكي (يحتاج مفتاح API)

## APK
- [~] Capacitor + workflow على GitHub Actions. يحتاج Backend على HTTPS ومتغير `API_URL` (راجع `docs/APK.md`).

## Company documents (platform onboarding)
- [x] Owner uploads CR, VAT certificate, national address (PDF/PNG/JPG/WEBP, 5 MB); real type checked by file signature; stored in SQL Server (migration 004). Submit requires all three.
- [x] Platform staff open the original files from the review screen (audited); mismatch flag when file values differ from typed values.
- [~] Auto-read of values: only when ANTHROPIC_API_KEY is set (unit-tested with a stubbed API; NOT yet verified against real Saudi documents). Without a key, files are delivered and the owner types the values.
- [ ] Malware scanning of uploads, virus/OCR fallback without an API key.
