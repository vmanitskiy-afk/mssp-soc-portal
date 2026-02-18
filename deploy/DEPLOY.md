# Деплой MSSP SOC Portal

## 1. Требования к серверу

**Минимальная конфигурация (до 5 клиентов):**
- CPU: 2 vCPU
- RAM: 4 GB
- SSD: 40 GB
- OS: Ubuntu 24.04 LTS
- Сеть: статический IP, доступ к RuSIEM по сети

**Рекомендуемая (5–20 клиентов):**
- CPU: 4 vCPU
- RAM: 8 GB
- SSD: 80 GB

**Где заказать (РФ):**

| Провайдер | Минималка (2/4/40) | Рекомендуемый (4/8/80) | Плюсы |
|-----------|-------------------|----------------------|-------|
| **Selectel** | ~1 500 ₽/мес | ~3 000 ₽/мес | Свой ЦОД в РФ, хороший API |
| **Yandex Cloud** | ~1 800 ₽/мес | ~3 500 ₽/мес | ФЗ-152, управляемые БД |
| **Timeweb Cloud** | ~900 ₽/мес | ~1 800 ₽/мес | Дешевле, но попроще |
| **VDSina** | ~800 ₽/мес | ~1 600 ₽/мес | Бюджетный вариант |

> Для MSSP с клиентскими данными рекомендую **Selectel** или **Yandex Cloud** — оба сертифицированы по ФЗ-152.

---

## 2. Первичная настройка сервера

```bash
# Подключиться как root
ssh root@85.239.57.76

# Скачать и запустить скрипт настройки
curl -sfL https://raw.githubusercontent.com/vmanitskiy-afk/mssp-soc-portal/main/deploy/setup-server.sh | bash
```

Скрипт автоматически:
- Обновит систему
- Установит Docker + Docker Compose
- Создаст пользователя `deploy`
- Настроит UFW (порты 22, 80, 443)
- Настроит fail2ban (защита SSH)
- Захардит SSH (отключит root, включит только ключи)
- Включит автообновления безопасности
- Настроит ежедневный бэкап БД (3:00, хранение 30 дней)

### После скрипта — вручную:

```bash
# Добавить SSH-ключ для deploy
mkdir -p /home/deploy/.ssh
echo "ssh-ed25519 AAAA..." >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Перезапустить SSH
systemctl restart sshd

# ВАЖНО: проверить вход с ключом ДО выхода из root-сессии!
```

---

## 3. Деплой приложения

```bash
# Зайти как deploy
ssh deploy@85.239.57.76

# Клонировать репозиторий
cd /opt
git clone https://github.com/vmanitskiy-afk/mssp-soc-portal.git
cd mssp-soc-portal

# Создать конфиг
cp .env.production.example .env.production
nano .env.production
```

### Заполнить `.env.production`:

```bash
# Сгенерировать секреты:
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # → SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(32))"   # → DB_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(32))"   # → REDIS_PASSWORD
```

Ключевые поля:
- `SECRET_KEY` — сгенерированный выше
- `DB_PASSWORD` — сгенерированный выше
- `REDIS_PASSWORD` — сгенерированный выше
- `RUSIEM_API_URL` — URL вашего RuSIEM (например, `https://siem.company.local/api/v1`)
- `RUSIEM_API_KEY` — API-ключ RuSIEM
- `CORS_ORIGINS` — `http://85.239.57.76`

### Запуск:

```bash
bash deploy/deploy.sh
```

Скрипт:
1. Соберёт Docker-образы
2. Запустит БД, применит миграции
3. Запустит все сервисы
4. Проверит health check

### Создать первого администратора:

```bash
docker compose -f docker-compose.prod.yml exec backend python -m app.scripts.seed_admin
```

Портал доступен: `http://85.239.57.76`

---

## 4. Подключение SSL (когда появится домен)

1. Направить DNS A-запись `soc.itnovation.pro` → IP сервера
2. Дождаться распространения DNS (5–30 мин)
3. Запустить:

```bash
bash deploy/enable-ssl.sh soc.itnovation.pro
```

Скрипт автоматически:
- Получит сертификат Let's Encrypt
- Перегенерирует nginx-конфиг с HTTPS
- Включит HTTP→HTTPS редирект
- Запустит автообновление сертификата

---

## 5. Обновление

```bash
ssh deploy@85.239.57.76
cd /opt/mssp-soc-portal
bash deploy/deploy.sh
```

`deploy.sh` делает `git pull`, пересборку образов, миграции и рестарт.

---

## 6. Обслуживание

```bash
# Логи
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f nginx

# Статус
docker compose -f docker-compose.prod.yml ps

# Ручной бэкап
docker compose -f docker-compose.prod.yml exec -T db \
    pg_dump -U portal mssp_portal | gzip > backups/manual-$(date +%Y%m%d).sql.gz

# Восстановление
gunzip -c backups/backup-20260217.sql.gz | \
    docker compose -f docker-compose.prod.yml exec -T db psql -U portal mssp_portal

# Рестарт всего
docker compose -f docker-compose.prod.yml restart

# Пересоздать с нуля (данные в volumes сохранятся)
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

---

## 7. Архитектура деплоя

```
  Internet
     │
     ▼
  ┌──────────┐
  │  nginx   │ :80/:443  — SSL termination, rate limiting
  └────┬─────┘
       │
  ┌────┴──────────────────────────┐  internal network
  │                               │
  ▼                               ▼
┌──────────┐              ┌───────────┐
│ frontend │ :80 (nginx)  │  backend  │ :8000 (uvicorn x4)
│  (React) │              │ (FastAPI) │
└──────────┘              └─────┬─────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌──────────┐ ┌───────┐ ┌──────────┐
              │ postgres │ │ redis │ │  celery  │
              │   :5432  │ │ :6379 │ │ worker+  │
              └──────────┘ └───────┘ │   beat   │
                                     └──────────┘
```

Все сервисы в одной Docker-сети. Наружу открыты только 80/443 через nginx.
