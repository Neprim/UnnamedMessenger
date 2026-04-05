# Безымянный гонец

Самописная (самонавайбкоденная) общалка со сквозным шифрованием.
*(весь текст далее сгенерирован)*

## Структура проекта

- `Backend` — Express API, SSE, SQLite, Swagger, раздача собранного фронтенда
- `Frontend` — Svelte SPA

## Локальный запуск для разработки

### 1. Установка зависимостей

```bash
cd Backend
npm install

cd ../Frontend
npm install
```

### 2. Настройка backend

Создайте файл `Backend/.env` на основе `Backend/.env.example`.

Пример для локальной разработки:

```env
PORT=3000
NODE_ENV=development
URL=
JWT_SECRET=dev-secret-change-me
```

### 3. Запуск

В одном терминале:

```bash
cd Backend
npm start
```

В другом:

```bash
cd Frontend
npm run dev
```

Фронтенд по умолчанию будет доступен на `http://localhost:5173`, backend — на `http://localhost:3000`.

## Production-сборка фронтенда

Сборка фронтенда настроена так, чтобы результат сразу попадал в `Backend/dist`.

```bash
cd Frontend
npm run build
```

После этого backend сможет раздавать SPA сам.

## Развёртывание на выделенном сервере без nginx

### 1. Клонировать репозиторий

```bash
git clone https://github.com/Neprim/UnnamedMessenger.git
cd UnnamedMessenger
```

### 2. Установить зависимости

```bash
cd Backend
npm install

cd ../Frontend
npm install
```

### 3. Подготовить `.env`

Создайте `Backend/.env` на основе `Backend/.env.example`.

Пример:

```env
PORT=3000
NODE_ENV=production
URL=https://your-domain-or-server-address:3000
CORS_ORIGIN=https://your-domain-or-server-address:3000
JWT_SECRET=replace-with-a-long-random-secret
SSL_KEY_PATH=ssl/server.key
SSL_CERT_PATH=ssl/server.crt
```

Пояснения:

- `NODE_ENV=production` включает HTTPS-режим backend
- `URL` должен совпадать с публичным адресом сервера
- `CORS_ORIGIN` лучше держать равным публичному адресу приложения
- `JWT_SECRET` обязан быть уникальным и непредсказуемым
- `SSL_KEY_PATH` и `SSL_CERT_PATH` задают пути до сертификатов относительно папки `Backend`

### 4. Подготовить SSL-сертификаты

В production backend ожидает файлы:

- `Backend/ssl/server.key`
- `Backend/ssl/server.crt`

Так как предполагается использование самоподписанных сертификатов, их нужно создать заранее и положить именно в эту папку.

Пример генерации через `openssl`:

```bash
mkdir -p Backend/ssl
openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 365 \
  -keyout Backend/ssl/server.key \
  -out Backend/ssl/server.crt \
  -subj "/CN=your-domain-or-server-address"
```

Важно: браузер будет показывать предупреждение о недоверенном сертификате, пока вы явно не разрешите доступ.

### 5. Собрать фронтенд

```bash
cd Frontend
npm run build
```

### 6. Запустить backend

```bash
cd ../Backend
npm start
```

После запуска приложение будет доступно по адресу из `URL`, например:

`https://your-domain-or-server-address:3000`

## Swagger / OpenAPI

Документация доступна по адресу:

`/api-docs`

Например:

`https://your-domain-or-server-address:3000/api-docs`

## Хранение данных

- база SQLite: `Backend/messenger.db`
- собранный фронтенд: `Backend/dist`
- SSL-сертификаты: `Backend/ssl`