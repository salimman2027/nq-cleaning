# NQ Cleaning
نظام إدارة شركات خدمات النظافة (Node/Express/TS + React + SQL Server). راجع TASKS.md.
1. `cp .env.example .env` واملأ القيم (لا بيانات دخول افتراضية).
2. `docker compose up -d db` ثم نفّذ `database/migrations` بالترتيب.
3. `npm ci && npm run build && npm test`
