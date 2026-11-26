# التشغيل والنشر

## تشغيل محلي
```bash
cp .env.example .env        # املأ DB_USER / DB_PASSWORD / JWT_ACCESS_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD
npm install
npm run migrate -w backend  # ينشئ قاعدة البيانات ويطبّق database/migrations بالترتيب
npm run bootstrap -w backend  # ينشئ الشركة والصلاحيات والأدوار والمسؤول الأول
npm run dev -w backend      # http://localhost:4000/api/docs
npm run dev -w frontend     # http://localhost:5173
```
لا توجد بيانات دخول افتراضية: كلمة مرور المسؤول (12 حرفاً فأكثر) تأتي من `ADMIN_PASSWORD`.

## Docker
`docker compose up -d --build` ثم نفّذ migrate و bootstrap داخل حاوية backend:
`docker compose exec backend node -e "..."` أو شغّلهما من جهازك على نفس قاعدة البيانات.

## IIS (Reverse Proxy)
1. ثبّت URL Rewrite و Application Request Routing.
2. موقع يخدم مجلد `frontend/dist`، وقاعدة Rewrite تحوّل `/api/*` إلى `http://localhost:4000/api/*`.
3. شغّل الـ Backend كخدمة (NSSM أو PM2): `node backend/dist/server.js`.
4. الـ Backend يعمل بـ `trust proxy` لقراءة عنوان العميل الحقيقي.

## النسخ الاحتياطي والاستعادة
```sql
BACKUP DATABASE [NQCleaning] TO DISK = N'/var/opt/mssql/backup/NQCleaning.bak' WITH COMPRESSION, CHECKSUM;
RESTORE VERIFYONLY FROM DISK = N'/var/opt/mssql/backup/NQCleaning.bak' WITH CHECKSUM;
RESTORE DATABASE [NQCleaning] FROM DISK = N'/var/opt/mssql/backup/NQCleaning.bak' WITH REPLACE;
```
جدول نسخ يومي (SQL Agent) + نسخ الملف خارج السيرفر + تجربة استعادة دورية على بيئة اختبار.

## متغيرات البيئة
راجع `.env.example`؛ كل متغير موثّق بتعليق.
