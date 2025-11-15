# TradingBot – คู่มือการติดตั้งและนำกลับมาใช้ใหม่

## ภาพรวม
TradingBot คือระบบรับสัญญาณจาก TradingView (ผ่าน Webhook) แล้วสั่งงาน Binance Futures ผ่าน API พร้อม Dashboard (Frontend static + Backend Express) จัดการบอท สัญญาณ ประวัติการเทรด และสถานะกระดานเทรดจากฐานข้อมูล SQLite (`backend/trading-bot.db`). คู่มือนี้สรุปขั้นตอนการติดตั้งใหม่หรือกู้กลับมาใช้งานหลังย้ายเครื่อง/ย้ายเซิร์ฟเวอร์

## โครงสร้างโฟลเดอร์หลัก
- `backend/` – Node.js API + งานประมวลผลบอท (Express, Binance SDK, better-sqlite3)
- `frontend/` – Single-page dashboard (Vanilla JS + Tailwind จาก CDN) ที่ถูกเสิร์ฟโดย Express
- `backend/backups/` – สำเนาฐานข้อมูลที่สร้างจาก API `/api/backup`
- `backend/trading-bot.db` – SQLite ตัวหลัก, มีไฟล์ WAL/SHM หากเปิดใช้งานอยู่

## ความต้องการระบบ
- Node.js 18 LTS ขึ้นไป (รองรับ `better-sqlite3` prebuild) + npm 9+
- ระบบปฏิบัติการ Linux x86_64 (ทดสอบบน Ubuntu 22.04/24.04)
- อินเทอร์เน็ตออก Binance Futures (สำหรับ webhook, market data, client futures API)
- บัญชี TradingView (รองรับ Webhook Alert) และ Binance API key/secret (สิทธิ Futures Trade + Futures Position)
- พอร์ต `3000` เปิดให้ Dashboard/Webhook ใช้งาน (หากอยู่หลัง reverse proxy อาจ map พอร์ตอื่น)

## ขั้นตอนติดตั้งใหม่ / นำกลับมาใช้

### 1. เตรียมโค้ดและ dependencies
```bash
sudo apt update && sudo apt install -y build-essential sqlite3 git
cd /var/www/trading-bot
git clone <repo> .   # หรือคัดลอกไฟล์เดิมกลับมา
cd backend
npm ci               # หรือ npm install หากไม่มี package-lock.json ที่ตรงกัน
```

> หาก `npm ci` ล้มเหลวเพราะ build tools ของ `better-sqlite3` ให้ติดตั้ง `python3` และ `make` เพิ่ม หรือใช้ Node version ที่มี prebuilt ตรงกัน (แนะนำ Node 20 LTS)

### 2. กู้และตรวจฐานข้อมูล
1. ถ้ามีไฟล์ backup (`backend/backups/trading-bot-*.db`) ให้นำไฟล์ล่าสุดคัดลอกเป็น `backend/trading-bot.db`
2. ตรวจสอบสิทธิ์ไฟล์  
   ```bash
   cd /var/www/trading-bot/backend
   ls -l trading-bot.db*
   sudo chown <user>:<group> trading-bot.db*
   ```
3. หากเริ่มระบบใหม่ (ไม่มี backup) ตัว `database.js` จะสร้าง schema อัตโนมัติเมื่อ `server.js` รันครั้งแรก

### 3. ตั้งค่าความปลอดภัย (ทำก่อนเปิดบริการ)
- Basic Auth สำหรับ Dashboard/Management API ถูกกำหนดใน `backend/server.js` ส่วน `authMiddleware` (user `admin`, password `057631590`) ควรแก้เป็น credential ใหม่ก่อน deploy
- ค่า Webhook URL ที่ฝังในบอท (`bot.webhookUrl`) อิง host `http://5.223.66.33`. หากย้ายเครื่องควรแก้ base URL ใน `server.js` ตรงการสร้าง `webhookUrl` (ฟังก์ชัน POST `/api/bots`) ให้เป็นโดเมน/ไอพีใหม่ หรือสร้าง reverse proxy ให้ path `/api/webhook/*` ชี้มาที่ backend
- ป้องกันการเข้าถึงพอร์ต 3000 จากสาธารณะโดยใช้ Firewall/Reverse Proxy (เช่น Nginx + TLS + Basic Auth)

### 4. เริ่มต้นเซิร์ฟเวอร์
โหมดทดลอง:
```bash
cd /var/www/trading-bot/backend
node server.js
```

โหมดบริการระยะยาวแนะนำให้ใช้ process manager:
```bash
pm2 start server.js --name trading-bot
pm2 save
pm2 startup systemd   # สร้าง service สำหรับ reboot แล้วกลับมาทำงานต่อ
```

หลังรันสำเร็จ Dashboard อยู่ที่ `http(s)://<host>:3000/` และ Webhook endpoint ที่ `http(s)://<host>:3000/api/webhook/:botId?token=<botToken>`

### 5. ทดสอบระบบ
1. เรียก `curl http://<host>:3000/api/health` (ไม่มี Basic Auth) เพื่อตรวจสถานะฐานข้อมูล
2. เปิดเบราว์เซอร์ เข้าหน้า Dashboard → ระบบจะถาม Basic Auth → ใส่ credential ที่ตั้งไว้
3. เพิ่ม Exchange (ใส่ Binance API key/secret) จากเมนู Exchanges เพื่อตรวจสอบว่าระบบเชื่อม Binance สำเร็จ (`Refresh Balance` ควรแสดงยอด `totalUSDT`)

## การผูก TradingView Webhook
1. หลังสร้าง Bot ใหม่ ระบบจะสร้าง `webhookUrl` ในรายละเอียดบอท (รูปแบบ `http://<host>/api/webhook/<botId>?token=<botToken>`)
2. ใน TradingView → Set Alert → เลือก “Webhook URL” แล้ววาง URL ดังกล่าว
3. Payload แนะนำ (ตัวอย่าง Long/Short):
```json
{
  "botId": 1700000000000,
  "token": "xxxxxxxx",
  "action": "long",
  "price": "{{close}}"
}
```
4. ระบบ `server.js` จะตรวจ token ก่อนลงมือเปิด/ปิด position และบันทึกสัญญาณลงตาราง `signals`

## การจัดการ Binance API และเวอร์ชัน Testnet
- เมื่อเพิ่ม Exchange สามารถระบุ `testnet` เพื่อให้ `binance-api-node` ใช้ `https://testnet.binancefuture.com`
- ควรสร้าง API key/secret แยกสำหรับแต่ละบอทหรืออย่างน้อยเปิดสิทธิ Futures Trade + Universal Transfer
- ข้อมูลคีย์เก็บในฐานข้อมูล SQLite; ปกป้องไฟล์ `trading-bot.db` และกำหนดสิทธิ์การเข้าถึงเครื่อง

## งานบำรุงรักษา
- **สำรองฐานข้อมูล:** เรียก `POST /api/backup` (ผ่าน Basic Auth) หรือรัน `curl -u admin:**** -X POST http://<host>:3000/api/backup` จะสร้างไฟล์ใน `backend/backups/` และลบของเกิน 7 วัน
- **ตรวจสอบฐานข้อมูล/สถิติเทรด:** มีสคริปต์ช่วยใน `backend/*.js` เช่น `node check-trades.js`, `node reset-bot-data.js`
- **Log:** ค่า console จะออกไปที่ STDOUT; หากใช้ `pm2` ให้ดู `pm2 logs trading-bot`
- **อัปเดต dependencies:** `cd backend && npm outdated` จากนั้น `npm install <pkg>@latest` ตามความจำเป็น แต่ควรหยุดบริการก่อน

## ปัญหาที่พบบ่อย
- `better-sqlite3` build fail → ตรวจ Node version หรือ `sudo apt install python3 g++ make`
- Dashboard ขอ Basic Auth กับ `/api/webhook` → ตรวจว่า middleware ข้าม path `/api/webhook/` แล้ว (`server.js` มีเงื่อนไข `req.path.startsWith('/api/webhook/')`)
- ไม่เห็นบอทหรือข้อมูลกำไร → ตรวจ `node server.js` log ว่า `binance-api-node` เชื่อมต่อสำเร็จและมีการเรียก `loadBotsProfit()` ใน frontend (`frontend/app.js`)

พร้อมใช้งาน! เมื่อต้องย้ายเครื่องให้เน้น 3 ส่วนคือ **ไฟล์โค้ด + `node_modules` (ติดตั้งใหม่) + `trading-bot.db`/backup** และอัปเดต URL/credential ให้ตรงกับสภาพแวดล้อมใหม่ทุกครั้ง