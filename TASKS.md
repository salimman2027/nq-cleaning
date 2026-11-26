# NQ Cleaning — TASKS
الحالة: [ ] لم يبدأ · [~] جزئي · [x] مكتمل ومُختبر

## Phase 0 — الأساس
- [x] هيكل المستودع، .gitignore، .env.example، docker-compose، CI
- [~] Migration 001: الجداول الأساسية (كُتبت، لم تُشغَّل على SQL Server بعد)
- [ ] Backend skeleton (Express + TS + mssql + Zod + Swagger)
- [ ] Frontend skeleton (Vite + React + TS + Tailwind + i18n RTL/LTR)

## Phase 1 — Auth, Customers, Services, Staff, Bookings, Scheduling, Dashboard
- [ ] JWT + Refresh Token Rotation + Argon2
- [ ] RBAC في الـ Backend + عزل الشركة/الفرع
- [ ] Customers + Addresses + منع التكرار بالجوال
- [ ] Services + ServicePrices + Checklists
- [ ] Supervisors / Technicians / Skills / Leaves / Availability
- [ ] Bookings + StatusHistory + منع التعارض (Transaction + sp_getapplock)
- [ ] Dashboard من بيانات فعلية
- [ ] Seed (3 فروع، 50 عميل، 15 خدمة، 5 مشرفين، 30 فني، 6 فرق، 6 سيارات، 100 حجز)
- [ ] اختبارات: دورة الحجز، التعارض، الصلاحيات

## Phase 2 — PWA, Dispatch, GPS, Quality
## Phase 3 — Invoices, Payments, Subscriptions, Costing
## Phase 4 — Portal, WhatsApp, Reports, Deployment

## ملاحظات
- لا تكامل ZATCA ولا ادعاء توافق معه.
- لم يُنفَّذ أي Build أو اختبار حتى الآن (بيئة بلا شبكة).
- جداول Migration 001 جزء من القائمة الكاملة؛ الباقي في migrations لاحقة.
