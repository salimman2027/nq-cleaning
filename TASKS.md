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

## APK
- [~] Capacitor + workflow على GitHub Actions. يحتاج Backend على HTTPS ومتغير `API_URL` (راجع `docs/APK.md`).
