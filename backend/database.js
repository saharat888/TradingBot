const Database = require('better-sqlite3');
const path = require('path');

// สร้าง database file
const dbPath = path.join(__dirname, 'trading-bot.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// สร้างตาราง
function initDatabase() {
  console.log('📊 Initializing Database...');
  
  // ตาราง bots
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      pair TEXT NOT NULL,
      exchange TEXT NOT NULL,
      strategy TEXT DEFAULT 'TradingView Signal',
      status TEXT DEFAULT 'paused',
      profit REAL DEFAULT 0,
      trades INTEGER DEFAULT 0,
      startBalance REAL NOT NULL,
      currentBalance REAL NOT NULL,
      token TEXT UNIQUE NOT NULL,
      webhookUrl TEXT NOT NULL,
      lastSignal TEXT DEFAULT '-',
      lastSignalTime TEXT DEFAULT '-',
      position TEXT DEFAULT 'none',
      entryPrice REAL DEFAULT 0,
      leverageType TEXT DEFAULT 'cross',
      leverageValue INTEGER DEFAULT 1,
      botType TEXT DEFAULT 'single',
      orderType TEXT DEFAULT 'market',
      entryOrderType TEXT DEFAULT 'market',
      orderSizeType TEXT DEFAULT 'usdt',
      orderSizeValue REAL DEFAULT 10,
      direction TEXT DEFAULT 'long',
      stopLoss REAL DEFAULT 0,
      stopLossEnabled INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    )
  `);
  
  // เพิ่มคอลัมน์ stopLoss ถ้ายังไม่มี (สำหรับ database เก่า)
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN stopLoss REAL DEFAULT 0`);
    console.log('✅ Added stopLoss column to bots table');
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN stopLossEnabled INTEGER DEFAULT 0`);
    console.log('✅ Added stopLossEnabled column to bots table');
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN entryOrderType TEXT DEFAULT 'market'`);
    console.log('✅ Added entryOrderType column to bots table');
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN orderSizeType TEXT DEFAULT 'usdt'`);
    console.log('✅ Added orderSizeType column to bots table');
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN orderSizeValue REAL DEFAULT 10`);
    console.log('✅ Added orderSizeValue column to bots table');
  } catch (e) {
    // Column already exists
  }

  // เพิ่มคอลัมน์ openPositions สำหรับสถานะจำนวน Position ที่เปิดอยู่ (รองรับ DB เก่า)
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN openPositions INTEGER DEFAULT 0`);
    console.log('✅ Added openPositions column to bots table');
  } catch (e) {
    // Column already exists
  }

  // เพิ่มคอลัมน์ payload ให้ signals (สำหรับเก็บ TradingView payload)
  try {
    db.exec(`ALTER TABLE signals ADD COLUMN payload TEXT`);
    console.log('✅ Added payload column to signals table');
  } catch (e) {
    // Column already exists
  }
  
  // ตาราง exchanges
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchanges (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      apiKey TEXT NOT NULL,
      apiSecret TEXT,
      status TEXT DEFAULT 'connected',
      testnet INTEGER DEFAULT 0,
      totalUSDT REAL DEFAULT 0,
      lastUpdate TEXT NOT NULL
    )
  `);
  
  // ตาราง exchange_balances
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchange_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exchangeId INTEGER NOT NULL,
      asset TEXT NOT NULL,
      wallet TEXT NOT NULL,
      free REAL DEFAULT 0,
      locked REAL DEFAULT 0,
      total REAL DEFAULT 0,
      FOREIGN KEY (exchangeId) REFERENCES exchanges(id) ON DELETE CASCADE
    )
  `);
  
  // ตาราง signals
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY,
      botId INTEGER NOT NULL,
      type TEXT NOT NULL,
      price REAL NOT NULL,
      time TEXT NOT NULL,
      status TEXT DEFAULT 'executed',
      payload TEXT,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    )
  `);
  
  // ตาราง trade_history
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_history (
      id INTEGER PRIMARY KEY,
      botId INTEGER NOT NULL,
      orderId TEXT NOT NULL,
      type TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      timestamp TEXT NOT NULL,
      symbol TEXT NOT NULL,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    )
  `);
  
  // สร้าง indexes เพื่อเพิ่มประสิทธิภาพ
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
    CREATE INDEX IF NOT EXISTS idx_signals_botId ON signals(botId);
    CREATE INDEX IF NOT EXISTS idx_trade_history_botId ON trade_history(botId);
    CREATE INDEX IF NOT EXISTS idx_exchange_balances_exchangeId ON exchange_balances(exchangeId);
  `);
  
  console.log('✅ Database initialized successfully');
}

// Bot operations
const botOps = {
  getAll: () => {
    return db.prepare('SELECT * FROM bots ORDER BY createdAt DESC').all();
  },
  
  getById: (id) => {
    return db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  },
  
  create: (bot) => {
    const stmt = db.prepare(`
      INSERT INTO bots (
        id, name, pair, exchange, strategy, status, profit, trades,
        startBalance, currentBalance, token, webhookUrl, lastSignal,
        lastSignalTime, position, entryPrice, leverageType, leverageValue,
        botType, orderType, entryOrderType, orderSizeType, orderSizeValue, direction, stopLoss, stopLossEnabled, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      bot.id, bot.name, bot.pair, bot.exchange, bot.strategy, bot.status,
      bot.profit, bot.trades, bot.startBalance, bot.currentBalance, bot.token,
      bot.webhookUrl, bot.lastSignal, bot.lastSignalTime, bot.position,
      bot.entryPrice, bot.leverageType, bot.leverageValue, bot.botType,
      bot.orderType, bot.entryOrderType || 'market', bot.orderSizeType || 'usdt', bot.orderSizeValue || bot.startBalance, 
      bot.direction, bot.stopLoss || 0, bot.stopLossEnabled ? 1 : 0, bot.createdAt
    );
    
    return bot;
  },
  
  update: (id, updates) => {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(id);
    
    db.prepare(`UPDATE bots SET ${fields} WHERE id = ?`).run(...values);
    return botOps.getById(id);
  },
  
  delete: (id) => {
    db.prepare('DELETE FROM bots WHERE id = ?').run(id);
  }
};

// Exchange operations
const exchangeOps = {
  getAll: () => {
    const exchanges = db.prepare('SELECT * FROM exchanges').all();
    // โหลด balances สำหรับแต่ละ exchange
    exchanges.forEach(ex => {
      ex.balances = db.prepare('SELECT * FROM exchange_balances WHERE exchangeId = ?').all(ex.id);
      ex.testnet = Boolean(ex.testnet);
    });
    return exchanges;
  },
  
  getById: (id) => {
    const exchange = db.prepare('SELECT * FROM exchanges WHERE id = ?').get(id);
    if (exchange) {
      exchange.balances = db.prepare('SELECT * FROM exchange_balances WHERE exchangeId = ?').all(id);
      exchange.testnet = Boolean(exchange.testnet);
    }
    return exchange;
  },
  
  create: (exchange) => {
    const stmt = db.prepare(`
      INSERT INTO exchanges (id, name, type, apiKey, apiSecret, status, testnet, totalUSDT, lastUpdate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      exchange.id, exchange.name, exchange.type, exchange.apiKey, exchange.apiSecret,
      exchange.status, exchange.testnet ? 1 : 0, exchange.totalUSDT, exchange.lastUpdate
    );
    
    // เพิ่ม balances
    if (exchange.balances && exchange.balances.length > 0) {
      const balanceStmt = db.prepare(`
        INSERT INTO exchange_balances (exchangeId, asset, wallet, free, locked, total)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((balances) => {
        for (const balance of balances) {
          balanceStmt.run(exchange.id, balance.asset, balance.wallet, balance.free, balance.locked, balance.total);
        }
      });
      
      insertMany(exchange.balances);
    }
    
    return exchange;
  },
  
  update: (id, updates) => {
    const { balances, ...exchangeData } = updates;
    
    if (Object.keys(exchangeData).length > 0) {
      const fields = Object.keys(exchangeData).map(key => {
        if (key === 'testnet') return 'testnet = ?';
        return `${key} = ?`;
      }).join(', ');
      
      const values = Object.values(exchangeData).map(val => {
        if (typeof val === 'boolean') return val ? 1 : 0;
        return val;
      });
      values.push(id);
      
      db.prepare(`UPDATE exchanges SET ${fields} WHERE id = ?`).run(...values);
    }
    
    // อัพเดท balances
    if (balances) {
      db.prepare('DELETE FROM exchange_balances WHERE exchangeId = ?').run(id);
      
      if (balances.length > 0) {
        const balanceStmt = db.prepare(`
          INSERT INTO exchange_balances (exchangeId, asset, wallet, free, locked, total)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const insertMany = db.transaction((bals) => {
          for (const balance of bals) {
            balanceStmt.run(id, balance.asset, balance.wallet, balance.free, balance.locked, balance.total);
          }
        });
        
        insertMany(balances);
      }
    }
    
    return exchangeOps.getById(id);
  },
  
  delete: (id) => {
    db.prepare('DELETE FROM exchange_balances WHERE exchangeId = ?').run(id);
    db.prepare('DELETE FROM exchanges WHERE id = ?').run(id);
  }
};

// Signal operations
const signalOps = {
  getAll: (limit = 100) => {
    return db.prepare('SELECT * FROM signals ORDER BY id DESC LIMIT ?').all(limit);
  },
  
  create: (signal) => {
    const stmt = db.prepare(`
      INSERT INTO signals (id, botId, type, price, time, status, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(signal.id, signal.botId, signal.type, signal.price, signal.time, signal.status, signal.payload || null);
    return signal;
  },
  
  deleteOld: (keepCount = 100) => {
    db.prepare(`
      DELETE FROM signals WHERE id NOT IN (
        SELECT id FROM signals ORDER BY id DESC LIMIT ?
      )
    `).run(keepCount);
  }
};

// Trade history operations
const tradeOps = {
  getAll: () => {
    return db.prepare('SELECT * FROM trade_history ORDER BY id DESC').all();
  },
  
  getByBotId: (botId) => {
    return db.prepare('SELECT * FROM trade_history WHERE botId = ? ORDER BY id DESC').all(botId);
  },
  
  create: (trade) => {
    const stmt = db.prepare(`
      INSERT INTO trade_history (id, botId, orderId, type, side, price, quantity, timestamp, symbol)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      trade.id, trade.botId, trade.orderId, trade.type, trade.side,
      trade.price, trade.quantity, trade.timestamp, trade.symbol
    );
    
    return trade;
  }
};

// Backup operations
function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, `backups/trading-bot-${timestamp}.db`);
  
  try {
    const fs = require('fs');
    const backupDir = path.join(__dirname, 'backups');
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    db.backup(backupPath);
    console.log('💾 Database backup created:', backupPath);
    
    // ลบ backup เก่าที่มีอายุเกิน 7 วัน
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    
    files.forEach(file => {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtime.getTime() > sevenDays) {
        fs.unlinkSync(filePath);
        console.log('🗑️ Deleted old backup:', file);
      }
    });
    
    return true;
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    return false;
  }
}

// Auto backup every 6 hours
setInterval(backupDatabase, 6 * 60 * 60 * 1000);

// Calculate profit/loss for a bot
function calculateBotProfit(botId, currentPrice = null) {
  const bot = botOps.getById(botId);
  if (!bot) return { profit: 0, profitUSDT: 0, realizedPnL: 0, unrealizedPnL: 0 };
  
  const botTrades = tradeOps.getByBotId(botId);
  if (botTrades.length === 0) return { profit: 0, profitUSDT: 0, realizedPnL: 0, unrealizedPnL: 0 };
  
  let realizedPnL = 0;  // กำไร/ขาดทุนจากการปิด position แล้ว
  let unrealizedPnL = 0; // กำไร/ขาดทุนจาก position ที่ยังเปิดอยู่
  let openTrades = [];
  
  // เรียงตาม timestamp เพื่อให้แน่ใจว่าประมวลผลตามลำดับเวลา
  const sortedTrades = [...botTrades].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  for (const trade of sortedTrades) {
    if (trade.type === 'OPEN') {
      // เปิด position ใหม่
      openTrades.push(trade);
    } else if (trade.type === 'CLOSE' && openTrades.length > 0) {
      // ปิด position - คำนวณ realized P&L
      const openTrade = openTrades.shift(); // FIFO (First In First Out)

      const entryPrice = openTrade.price;
      const exitPrice = trade.price;

      // ใช้ quantity จาก CLOSE trade (จำนวนที่ปิดจริง)
      // ถ้าไม่มีหรือเป็น 0 ให้ fallback ไปใช้จาก OPEN trade
      const quantity = trade.quantity && trade.quantity > 0 ? trade.quantity : openTrade.quantity;

      // คำนวณ P&L แบบถูกต้อง
      // P&L = (Exit Price - Entry Price) * Quantity (สำหรับ LONG)
      // P&L = (Entry Price - Exit Price) * Quantity (สำหรับ SHORT)
      let pnl = 0;

      if (openTrade.side === 'LONG') {
        // LONG: ซื้อถูก ขายแพง = กำไร
        pnl = (exitPrice - entryPrice) * quantity;
      } else if (openTrade.side === 'SHORT') {
        // SHORT: ขายแพง ซื้อคืนถูก = กำไร
        pnl = (entryPrice - exitPrice) * quantity;
      }

      realizedPnL += pnl;
    }
  }
  
  // คำนวณ Unrealized P&L สำหรับ position ที่ยังเปิดอยู่
  if (openTrades.length > 0 && currentPrice) {
    for (const openTrade of openTrades) {
      const entryPrice = openTrade.price;
      const quantity = openTrade.quantity;
      
      let unrealizedPnL_single = 0;
      if (openTrade.side === 'LONG') {
        unrealizedPnL_single = (currentPrice - entryPrice) * quantity;
      } else if (openTrade.side === 'SHORT') {
        unrealizedPnL_single = (entryPrice - currentPrice) * quantity;
      }
      
      unrealizedPnL += unrealizedPnL_single;
    }
  }
  
  // รวม P&L ทั้งหมด
  const totalPnL = realizedPnL + unrealizedPnL;
  
  // คำนวณเป็นเปอร์เซ็นต์
  const profitPercentage = (totalPnL / bot.startBalance) * 100;
  
  return {
    profit: profitPercentage,
    profitUSDT: totalPnL,
    realizedPnL: realizedPnL,
    unrealizedPnL: unrealizedPnL,
    openPositions: openTrades.length
  };
}

module.exports = {
  db,
  initDatabase,
  botOps,
  exchangeOps,
  signalOps,
  tradeOps,
  backupDatabase,
  calculateBotProfit
};

