const express = require('express');
const cors = require('cors');
const path = require('path');
const basicAuth = require('express-basic-auth');
const { initDatabase, botOps, exchangeOps, signalOps, tradeOps, backupDatabase, calculateBotProfit } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

// Basic Authentication - ป้องกันการเข้าถึง UI และ Management API
// แต่ EXCLUDE webhook endpoint เพื่อให้ TradingView ส่งได้
const authMiddleware = basicAuth({
  users: { 'admin': '057631590' }, // เปลี่ยนรหัสผ่านตามต้องการ
  challenge: true,
  realm: 'Trading Bot Dashboard',
  unauthorizedResponse: (req) => {
    return req.auth ? 'Invalid credentials' : 'Authentication required';
  }
});

// ใช้ auth เฉพาะ path ที่ไม่ใช่ webhook
app.use((req, res, next) => {
  // Webhook endpoints ไม่ต้องผ่าน Basic Auth (ใช้ token แทน)
  if (req.path.startsWith('/api/webhook/') || req.path === '/api/health') {
    return next();
  }
  // ส่วนอื่นๆ ต้องผ่าน Basic Auth
  return authMiddleware(req, res, next);
});

// Initialize database
initDatabase();

// โหลด Exchange clients ตอน server start
const Binance = require('binance-api-node').default;
function loadExchangeClients() {
  const exchanges = exchangeOps.getAll();
  console.log(`🔗 Loading ${exchanges.length} exchange client(s)...`);
  
  exchanges.forEach(exchange => {
    try {
      if (!exchange.apiKey || !exchange.apiSecret) {
        console.log(`⚠️ ${exchange.name}: Missing API credentials`);
        return;
      }
      
      console.log(`🔗 Loading exchange client: ${exchange.name}`);
      
      const client = Binance({
        apiKey: exchange.apiKey,
        apiSecret: exchange.apiSecret,
        useServerTime: true,
        ...(exchange.testnet && { 
          baseURL: 'https://testnet.binancefuture.com',
          futures: true 
        })
      });
      
      // เก็บ client ใน cache
      exchangeClients[exchange.name] = client;
      console.log(`✅ ${exchange.name}: Connected`);
      
    } catch (err) {
      console.log(`❌ ${exchange.name}: ${err.message}`);
    }
  });
}

// โหลด exchange clients (ถ้ามี)
setTimeout(() => loadExchangeClients(), 1000);

// Exchange clients cache (ไม่เก็บใน DB เพราะมี API client object)
let exchangeClients = {};

// --- Helpers ---
function stripSymbol(s) { return (s || '').toUpperCase().replace(/^BINANCE:/, '').replace(/\.P$/, ''); }
function decimalsFromStep(step) {
  const t = String(step || '0.001');
  return Math.max(0, (t.split('.')[1] || '').length);
}
function roundToStep(qty, step) {
  const p = decimalsFromStep(step);
  return Number((Math.floor(qty / step) * step).toFixed(p));
}

// Map pair like "ZECUSDT/USDT" -> futures symbol "ZECUSDT"
// Handles cases like "ZEC.Shift" -> "ZEC", "SOL.Shift" -> "SOL"
function pairToSymbol(pair) {
  try {
    if (!pair) return null;
    let base = String(pair).split('/')[0];
    
    // ถ้ามีจุด (.) ให้เอาเฉพาะส่วนก่อนจุด (เช่น "ZEC.Shift" -> "ZEC")
    if (base.includes('.')) {
      base = base.split('.')[0];
    }
    
    // ลบอักขระพิเศษทั้งหมดและแปลงเป็นตัวพิมพ์ใหญ่
    return base.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } catch (_) { return null; }
}

// Helper function to convert pair to Binance futures symbol with USDT suffix
function pairToBinanceSymbol(pair) {
  try {
    if (!pair) return null;
    
    // ใช้ pairToSymbol เพื่อแปลง
    let symbol = pairToSymbol(pair);
    
    if (!symbol) {
      // ถ้า pairToSymbol ไม่ได้ผล ให้ใช้วิธีเดิม
      symbol = String(pair);
      if (symbol.includes('/')) {
        const parts = symbol.split('/');
        symbol = parts[0];
      }
      // ลบอักขระพิเศษ
      symbol = symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    }
    
    // ตรวจสอบว่ามี USDT ต่อท้ายหรือยัง ถ้าไม่มีให้เติม
    if (!symbol.endsWith('USDT')) {
      symbol = symbol + 'USDT';
    }
    
    return symbol;
  } catch (err) {
    console.error(`❌ Error converting pair to symbol: ${pair}`, err.message);
    return null;
  }
}

// --- Event logging helper ---
function logSignal(bot, type, opts = {}) {
  try {
    const signal = {
      id: Date.now(),
      botId: bot.id,
      type,
      price: typeof opts.price === 'number' ? opts.price : 0,
      time: new Date().toISOString(),
      status: opts.status || 'info',
      payload: opts.payload ? (typeof opts.payload === 'string' ? opts.payload : JSON.stringify(opts.payload)) : null
    };
    signalOps.create(signal);
    signalOps.deleteOld(200); // keep last 200 signals for richer timeline
  } catch (_) {}
}

// Periodically reconcile positions with exchange (two-way sync)
async function reconcilePositions() {
  try {
    const bots = botOps.getAll();
    for (const bot of bots) {
      const client = exchangeClients[bot.exchange];
      if (!client) continue;
      const symbol = pairToSymbol(bot.pair);
      if (!symbol) continue;
      try {
        const risks = await client.futuresPositionRisk({ symbol });
        const risk = Array.isArray(risks) ? risks[0] : risks;
        if (!risk) continue;
        const posAmt = parseFloat(risk.positionAmt || '0');
        const entry = parseFloat(risk.entryPrice || '0');

        // Case 1: Exchange has no position → ensure DB is closed
        if (posAmt === 0 && bot.position !== 'none') {
          console.log(`🔄 Reconcile [${bot.name}]: Exchange NONE, DB ${bot.position}. Sync -> NONE`);
          botOps.update(bot.id, { position: 'none', entryPrice: 0, openPositions: 0 });
        }

        // Case 2: Exchange has a position but DB shows none
        if (posAmt !== 0 && bot.position === 'none') {
          const side = posAmt > 0 ? 'long' : 'short';
          console.log(`🔄 Reconcile [${bot.name}]: Exchange ${side.toUpperCase()} ${posAmt}, DB NONE. Sync -> ${side.toUpperCase()}`);
          botOps.update(bot.id, { position: side, entryPrice: entry, openPositions: 1 });
          await updateBotProfit(bot.id);
        }

        // Case 3: Both have position but mismatch direction
        if (posAmt !== 0 && bot.position !== 'none') {
          const side = posAmt > 0 ? 'long' : 'short';
          if (bot.position !== side) {
            console.log(`🔄 Reconcile [${bot.name}]: Mismatch Exchange=${side.toUpperCase()} DB=${bot.position.toUpperCase()} → Sync DB`);
            botOps.update(bot.id, { position: side, entryPrice: entry, openPositions: 1 });
            await updateBotProfit(bot.id);
          }
        }
      } catch (e) {
        // Ignore per-bot errors but log meaningful ones
        if (e?.message && !/Invalid symbol/i.test(e.message)) {
          console.log(`⚠️ Reconcile error for ${bot.name}:`, e.message);
        }
      }
      await new Promise(r => setTimeout(r, 50));
    }
  } catch (e) {
    console.error('reconcilePositions error:', e?.message || e);
  }
}

// Run reconciliation every 30 seconds
setInterval(reconcilePositions, 30000);

// Generate secure token for bot
function generateBotToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Update bot profit
async function updateBotProfit(botId, currentPrice = null) {
  const bot = botOps.getById(botId);
  if (bot) {
    const profitData = calculateBotProfit(botId, currentPrice);
    const currentBalance = bot.startBalance + profitData.profitUSDT;
    
    // Sync openPositions to avoid stale UI state; if none open, ensure position is NONE
    const updates = {
      profit: profitData.profit,
      currentBalance: currentBalance,
      openPositions: profitData.openPositions
    };
    if (profitData.openPositions === 0 && bot.position !== 'none') {
      updates.position = 'none';
      updates.entryPrice = 0;
    }
    botOps.update(botId, updates);
    
    console.log(`📊 Bot ${bot.name} P&L Updated:`);
    console.log(`   Realized: $${profitData.realizedPnL.toFixed(2)}`);
    console.log(`   Unrealized: $${profitData.unrealizedPnL.toFixed(2)}`);
    console.log(`   Total: ${profitData.profit.toFixed(2)}% ($${profitData.profitUSDT.toFixed(2)})`);
    
    return profitData;
  }
  return null;
}


app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/api/health', (req, res) => {
  const bots = botOps.getAll();
  const signals = signalOps.getAll();
  const exchanges = exchangeOps.getAll();
  
  res.json({ 
    status: 'OK',
    bots: bots.length,
    signals: signals.length,
    exchanges: exchanges.length,
    timestamp: new Date().toLocaleString('th-TH')
  });
});

// ================== BOTS API ==================
app.get('/api/bots', (req, res) => {
  // Ensure UI doesn't show stale open count after positions are closed
  const bots = botOps.getAll().map(b => {
    if (b.position === 'none' && Number(b.openPositions || 0) > 0) {
      // Soft-fix in the response; DB will be synced by updateBotProfit later
      return { ...b, openPositions: 0 };
    }
    return b;
  });
  res.json({ success: true, bots });
});

app.post('/api/bots', (req, res) => {
  const { name, pair, investment, exchange, leverageType, leverageValue, botType, orderType, entryOrderType, orderSizeType, orderSizeValue, direction, stopLoss, stopLossEnabled } = req.body;
  
  const botId = Date.now();
  const botToken = generateBotToken();
  const newBot = {
    id: botId,
    name,
    pair,
    exchange: exchange || 'Binance',
    strategy: 'TradingView Signal',
    status: 'paused',
    profit: 0,
    trades: 0,
    startBalance: investment,
    currentBalance: investment,
    token: botToken,
    webhookUrl: `http://5.223.66.33/api/webhook/${botId}?token=${botToken}`,
    lastSignal: '-',
    lastSignalTime: '-',
    position: 'none',
    entryPrice: 0,
    leverageType: leverageType || 'cross',
    leverageValue: leverageValue || 1,
    botType: botType || 'single',
    orderType: orderType || 'market',
    entryOrderType: entryOrderType || 'market',
    orderSizeType: orderSizeType || 'usdt',
    orderSizeValue: orderSizeValue || investment,
    direction: direction || 'long',
    stopLoss: stopLoss || 0,
    stopLossEnabled: stopLossEnabled || false,
    createdAt: new Date().toISOString()
  };
  
  botOps.create(newBot);
  console.log('✅ สร้างบอท:', newBot.name, stopLossEnabled ? `(SL: ${stopLoss}%)` : '(No SL)');
  
  res.json({ success: true, bot: newBot });
});

// Get detailed P&L for a bot (ต้องอยู่ก่อน generic :id route)
app.get('/api/bots/:id/profit', async (req, res) => {
  const botId = parseInt(req.params.id);
  const bot = botOps.getById(botId);
  
  if (!bot) {
    return res.status(404).json({ success: false, message: 'Bot not found' });
  }
  
  // ดึงราคาปัจจุบันจาก Binance (ทุกครั้ง - ไม่ว่าจะมี position หรือไม่)
  let currentPrice = null;
  const trades = tradeOps.getByBotId(botId);
  const openTrades = trades.filter(t => t.type === 'OPEN');
  const closeTrades = trades.filter(t => t.type === 'CLOSE');

  // ตรวจสอบว่ามี open position จริงๆ จาก Binance API
  let hasOpenPosition = false;
  const exchangeClient = exchangeClients[bot.exchange];

  let currentPositionStr = 'none';
  let binanceSymbol = null; // เก็บ symbol ที่ใช้ร่วมกัน

  // แปลง pair เป็น Binance symbol
  try {
    binanceSymbol = pairToBinanceSymbol(bot.pair);
    if (!binanceSymbol) {
      throw new Error(`Cannot convert pair "${bot.pair}" to symbol`);
    }
  } catch (err) {
    console.log(`⚠️ Cannot convert pair for ${bot.name}:`, err.message);
  }

  if (exchangeClient && binanceSymbol) {
    try {
      console.log(`🔍 Converting pair "${bot.pair}" -> symbol: ${binanceSymbol}`);

      // เช็ค position จริงจาก Binance
      const positions = await exchangeClient.futuresPositionRisk({ symbol: binanceSymbol });
      const activePosition = positions.find(p => parseFloat(p.positionAmt) !== 0);
      hasOpenPosition = !!activePosition;
      if (activePosition) {
        const amt = parseFloat(activePosition.positionAmt);
        currentPositionStr = amt > 0 ? 'long' : 'short';
      }

      console.log(`📊 Check position for ${bot.name}: ${hasOpenPosition ? 'HAS POSITION' : 'NO POSITION'} (symbol: ${binanceSymbol})`);
    } catch (err) {
      // ถ้า error ให้ใช้วิธีเดิมจาก database
      hasOpenPosition = openTrades.length > closeTrades.length;
      console.log(`⚠️ Cannot check position from Binance for ${bot.name} (pair: ${bot.pair}):`, err.message);
    }
  } else {
    // ถ้าไม่มี exchange client ให้ใช้วิธีเดิม
    hasOpenPosition = openTrades.length > closeTrades.length;
  }

  // ดึงราคาปัจจุบัน real-time ทุกครั้ง (แม้ไม่มี position ก็ดึง)
  if (binanceSymbol) {
    try {
      console.log(`🔍 Fetching real-time price for bot "${bot.name}" (pair: ${bot.pair}) -> symbol: ${binanceSymbol}`);

      // ใช้ axios ดึงจาก Binance Public API (ไม่ต้อง authentication)
      const axios = require('axios');
      const response = await axios.get(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${binanceSymbol}`, {
        timeout: 5000 // timeout 5 seconds
      });

      if (response.data && response.data.price) {
        currentPrice = parseFloat(response.data.price);
        console.log(`✅ Current price for ${binanceSymbol}: $${currentPrice}`);
      } else {
        throw new Error('Invalid response from Binance API');
      }
    } catch (err) {
      console.log(`❌ Cannot fetch current price for bot "${bot.name}" (pair: ${bot.pair}, symbol: ${binanceSymbol}):`, err.message);
      if (err.response) {
        console.log(`   API Response Status: ${err.response.status}, Data:`, err.response.data);
      }
    }
  }
  
  // ถ้า Exchange มี position แต่ DB เป็น none ให้ sync ทันที
  try {
    if (hasOpenPosition && bot.position === 'none') {
      botOps.update(botId, { position: currentPositionStr });
      bot.position = currentPositionStr;
    }
  } catch (_) {}

  // คำนวณ P&L พร้อมราคาปัจจุบัน
  const profitData = calculateBotProfit(botId, currentPrice);
  
  // อัปเดต position field ให้ sync กับ Binance จริง
  if (!hasOpenPosition && bot.position !== 'none') {
    console.log(`🔄 Sync position for ${bot.name}: ${bot.position} -> none (closed externally)`);
    
    // สร้าง CLOSE trade record อัตโนมัติถ้ามี open trades ที่ยังไม่ปิด
    const openTradesCount = openTrades.length;
    const closeTradesCount = closeTrades.length;
    
    if (openTradesCount > closeTradesCount) {
      console.log(`📝 Creating CLOSE trade record for externally closed position`);
      
      // หา open trade ล่าสุดที่ยังไม่ได้ปิด
      const lastOpenTrade = openTrades[openTradesCount - closeTradesCount - 1];
      
      if (lastOpenTrade && currentPrice) {
        // สร้าง CLOSE trade record
        const closeTradeRecord = {
          id: Date.now(),
          botId: bot.id,
          orderId: 'EXTERNAL_CLOSE_' + Date.now(),
          type: 'CLOSE',
          side: lastOpenTrade.side,
          price: currentPrice,
          quantity: lastOpenTrade.quantity,
          timestamp: new Date().toISOString(),
          symbol: lastOpenTrade.symbol
        };
        
        tradeOps.create(closeTradeRecord);
        console.log(`✅ Auto-created CLOSE trade: ${lastOpenTrade.side} @ $${currentPrice}`);
        
        // อัพเดต trades count
        botOps.update(botId, { 
          position: 'none', 
          entryPrice: 0,
          trades: bot.trades + 1 
        });
      } else {
        // ถ้าไม่มี currentPrice ให้อัพเดตแค่ position
        botOps.update(botId, { position: 'none', entryPrice: 0 });
      }
    } else {
      // ถ้า trade records sync แล้ว แค่อัพเดต position field
      botOps.update(botId, { position: 'none', entryPrice: 0 });
    }
    
    bot.position = 'none';
    bot.entryPrice = 0;
  }
  
  // กำหนดจำนวน openPositions สำหรับ UI โดยเชื่อ Exchange เป็นหลัก
  const openPositionsOut = hasOpenPosition ? 1 : 0;

  res.json({
    success: true,
    bot: {
      id: bot.id,
      name: bot.name,
      pair: bot.pair,
      startBalance: bot.startBalance,
      currentBalance: bot.startBalance + profitData.profitUSDT
    },
    profit: {
      percentage: profitData.profit,
      usd: profitData.profitUSDT,
      realizedPnL: profitData.realizedPnL,
      unrealizedPnL: profitData.unrealizedPnL,
      openPositions: openPositionsOut
    },
    currentPrice: currentPrice,
    currentPosition: currentPositionStr,
    stats: {
      totalTrades: bot.trades,
      openTrades: openTrades.length,
      closedTrades: closeTrades.length
    }
  });
});

// Get events for a specific bot
app.get('/api/bots/:id/events', (req, res) => {
  const botId = parseInt(req.params.id);
  const bot = botOps.getById(botId);
  
  if (!bot) {
    return res.status(404).json({ success: false, message: 'Bot not found' });
  }
  
  // ดึง trades ของบอทนี้และแปลงเป็น events
  const trades = tradeOps.getByBotId(botId);
  const signals = signalOps.getAll().filter(s => s.botId === botId);
  
  // สร้าง events จาก trades และ signals
  const events = [];
  
  // เพิ่ม events จาก trades
  trades.forEach(trade => {
    events.push({
      id: trade.id,
      botId: trade.botId,
      type: trade.type === 'OPEN' ? 'position' : 'trade',
      message: `${trade.type} ${trade.side} position @ $${trade.price.toFixed(2)}`,
      timestamp: trade.timestamp,
      price: trade.price,
      quantity: trade.quantity,
      orderId: trade.orderId,
      pair: trade.symbol
    });
  });
  
  // เพิ่ม events จาก signals (รวม payload จาก TradingView/ระบบ ถ้ามี)
  signals.forEach(signal => {
    let payload = null;
    try { payload = signal.payload ? JSON.parse(signal.payload) : null; } catch (_) {}
    const parts = [];
    parts.push(`type=${signal.type}`);
    if (payload?.pair || payload?.symbol) parts.push(`pair=${payload.pair || payload.symbol}`);
    if (signal.price) parts.push(`price=${Number(signal.price).toLocaleString()}`);
    if (payload?.orderId) parts.push(`orderId=${payload.orderId}`);
    if (payload?.reason) parts.push(`reason=${payload.reason}`);
    if (payload?.error) parts.push(`error=${payload.error}`);
    const msg = parts.join(' | ');
    
    events.push({
      id: signal.id,
      botId: signal.botId,
      type: 'log',
      message: msg,
      timestamp: signal.time,
      price: signal.price,
      pair: bot.pair,
      payload: payload || undefined
    });
  });
  
  // เรียงตาม timestamp จากใหม่ไปเก่า
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  res.json({
    success: true,
    events: events.slice(0, 50) // จำกัดแค่ 50 events ล่าสุด
  });
});

// Regenerate token for old bots (ต้องอยู่ก่อน generic :id route)
app.patch('/api/bots/:id/regenerate-token', (req, res) => {
  const botId = parseInt(req.params.id);
  const bot = botOps.getById(botId);
  
  if (!bot) {
    return res.status(404).json({ success: false, message: 'Bot not found' });
  }
  
  // Generate new token
  const newToken = generateBotToken();
  const webhookUrl = `http://5.223.66.33/api/webhook/${botId}?token=${newToken}`;
  
  const updatedBot = botOps.update(botId, { token: newToken, webhookUrl });
  
  console.log(`🔄 Regenerated token for bot: ${updatedBot.name}`);
  res.json({ success: true, bot: updatedBot });
});

// Update bot status (ต้องอยู่ก่อน generic :id route)
app.patch('/api/bots/:id/status', (req, res) => {
  const botId = parseInt(req.params.id);
  const { status } = req.body;
  
  const bot = botOps.getById(botId);
  if (!bot) {
    return res.status(404).json({ success: false, message: 'Bot not found' });
  }
  
  const updatedBot = botOps.update(botId, { status });
  console.log(`🔄 ${updatedBot.name}: ${status}`);
  
  res.json({ success: true, bot: updatedBot });
});

// Edit bot endpoint (generic route - ต้องอยู่หลังสุด)
app.patch('/api/bots/:id', (req, res) => {
  const botId = parseInt(req.params.id);
  const { name, leverageValue, leverageType, startBalance, entryOrderType, orderSizeType, orderSizeValue, stopLoss, stopLossEnabled } = req.body;
  
  const bot = botOps.getById(botId);
  if (!bot) {
    return res.status(404).json({ success: false, message: 'Bot not found' });
  }
  
  // Update bot properties
  const updates = {};
  if (name) updates.name = name;
  if (leverageValue !== undefined) updates.leverageValue = leverageValue;
  if (leverageType) updates.leverageType = leverageType;
  if (entryOrderType) updates.entryOrderType = entryOrderType;
  if (orderSizeType) updates.orderSizeType = orderSizeType;
  if (orderSizeValue !== undefined) updates.orderSizeValue = orderSizeValue;
  if (startBalance !== undefined) {
    updates.startBalance = startBalance;
    updates.currentBalance = startBalance; // Reset current balance to new start balance
  }
  if (stopLoss !== undefined) updates.stopLoss = stopLoss;
  if (stopLossEnabled !== undefined) updates.stopLossEnabled = stopLossEnabled ? 1 : 0;
  
  const updatedBot = botOps.update(botId, updates);
  console.log(`✏️ แก้ไขบอท: ${updatedBot.name}`, updatedBot.stopLossEnabled ? `(SL: ${updatedBot.stopLoss}%)` : '(No SL)');
  
  res.json({ success: true, bot: updatedBot });
});

// Delete bot
app.delete('/api/bots/:id', (req, res) => {
  const botId = parseInt(req.params.id);
  botOps.delete(botId);
  console.log(`🗑️ ลบบอท ID: ${botId}`);
  res.json({ success: true });
});

// ================== WEBHOOK ==================

app.post('/api/webhook/:botId', async (req, res) => {
  try {
    // Lightweight per-bot lock and cooldown
    if (!global.__processingBots) global.__processingBots = new Set();
    if (!global.__lastOrderTime) global.__lastOrderTime = Object.create(null);

    const botId = parseInt(req.params.botId);
    const providedToken = req.query.token || req.body.token;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📡 รับข้อมูลจาก TradingView | Bot:', botId);
    // Log: webhook received
    if (botOps.getById(botId)) {
      try { logSignal({ id: botId }, 'WEBHOOK_RECEIVED', { status: 'received', payload: req.body }); } catch (_) {}
    }
    console.log('Token provided:', providedToken ? 'Yes' : 'No');
    console.log('Body:', JSON.stringify(req.body));

    // Validate bot exists
    const bot = botOps.getById(botId);
    if (!bot) return res.status(404).json({ success:false, message:'Bot not found' });
    
    // Validate token
    if (!providedToken) {
      console.log('❌ No token provided');
      try { logSignal({ id: botId }, 'WEBHOOK_REJECTED', { status: 'error', payload: { reason: 'no_token' } }); } catch(_){}
      return res.status(401).json({ success:false, message:'Token required' });
    }
    
    if (providedToken !== bot.token) {
      console.log('❌ Invalid token provided');
      try { logSignal({ id: botId }, 'WEBHOOK_REJECTED', { status: 'error', payload: { reason: 'invalid_token' } }); } catch(_){}
      return res.status(401).json({ success:false, message:'Invalid token' });
    }

    const { action, pair, price, time } = req.body;
    if (!action) return res.status(400).json({ success:false, message:'Missing "action"' });
    if (!pair)   return res.status(400).json({ success:false, message:'Missing "pair"' });

    if (bot.status !== 'active') {
      try { logSignal(bot, 'ORDER_SKIPPED', { status: 'info', payload: { reason: 'paused' } }); } catch(_){}
      return res.json({ success:false, message:'Bot is paused', botStatus: bot.status });
    }

    const exchangeClient = exchangeClients[bot.exchange];
    if (!exchangeClient) return res.status(400).json({ success:false, message:'Exchange not connected' });

    const symbol = stripSymbol(pair);
    const client = exchangeClient;

    const wantMarket = !price || String(price).toLowerCase() === 'market';
    const mark = wantMarket ? Number((await client.futuresMarkPrice({ symbol })).markPrice) : Number(price);

    try { await client.futuresMarginType({ symbol, marginType: bot.leverageType === 'isolated' ? 'ISOLATED' : 'CROSSED' }); } catch(e) {}
    try { await client.futuresLeverage({ symbol, leverage: bot.leverageValue || 1 }); } catch(e) {}

    const info = await client.futuresExchangeInfo();
    const sym = (info.symbols || []).find(s => s.symbol === symbol);
    if (!sym) return res.status(400).json({ success:false, message:'Symbol not available on exchange' });
    const lot = sym.filters.find(f => f.filterType === 'LOT_SIZE');
    const minN = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
    const priceFilter = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
    const stepSize = Number(lot?.stepSize || '0.001');
    const minNotional = Number(minN?.notional || '5');
    const tickSize = Number(priceFilter?.tickSize || '0.01');

    const usdt = Number(bot.startBalance || bot.investment || 10);
    let qty = roundToStep(((bot.leverageValue || 1) * usdt) / mark, stepSize);
    if (qty * mark < minNotional) qty = roundToStep((minNotional + 1) / mark, stepSize);
    if (qty <= 0) return res.status(400).json({ success:false, message:'Qty too small' });

    const a = String(action).toUpperCase();
    const isClose = a === 'CLOSE';
    const isLong = a === 'BUY' || a === 'LONG';
    const isShort = a === 'SELL' || a === 'SHORT';

    console.log('📊 Signal received:', { action: a, isClose, isLong, isShort });

    // ตรวจสอบ Position Mode ของบัญชี
    let positionMode = 'ONE_WAY'; // default
    try {
      const posInfo = await client.futuresPositionMode();
      positionMode = posInfo.dualSidePosition ? 'HEDGE' : 'ONE_WAY';
      console.log('📊 Position Mode:', positionMode);
    } catch (e) {
      console.log('⚠️ Cannot detect position mode, using ONE_WAY');
    }

    // Lock check
    if (global.__processingBots.has(botId)) {
      console.log('⚠️ Bot is already processing a signal, skipping');
      return res.json({ success:false, message:'Bot is processing another signal, try again shortly' });
    }

    // Cooldown 3s between orders per bot
    const nowTs = Date.now();
    const lastTs = global.__lastOrderTime[botId] || 0;
    if (nowTs - lastTs < 3000) {
      const waitMs = 3000 - (nowTs - lastTs);
      console.log(`⏱️ Cooldown active ${waitMs}ms`);
      return res.json({ success:false, message:`Cooldown active ${Math.ceil(waitMs/1000)}s` });
    }

    global.__processingBots.add(botId);

    let orderParams;
    let closingSide = null; // เก็บ side ของ position ที่กำลังปิด (สำหรับบันทึก CLOSE trade)

    if (isClose) {
      // CLOSE signal - ปิด position ปัจจุบัน
      console.log('🔴 CLOSE signal - closing current position');

      // ตรวจสอบ position ปัจจุบัน
      const positions = await client.futuresPositionRisk({ symbol });
      const currentPosition = positions.find(p => parseFloat(p.positionAmt) !== 0);

      if (!currentPosition) {
        console.log('⚠️ No position to close');
        return res.json({ success: false, message: 'No position to close' });
      }

      const positionAmt = parseFloat(currentPosition.positionAmt);
      const isCurrentLong = positionAmt > 0;
      closingSide = isCurrentLong ? 'LONG' : 'SHORT'; // เก็บ side ของ position ที่ปิด
      
      orderParams = {
        symbol,
        side: isCurrentLong ? 'SELL' : 'BUY',
        type: 'MARKET',
        quantity: Math.abs(positionAmt)
      };

      if (positionMode === 'HEDGE') {
        orderParams.positionSide = isCurrentLong ? 'LONG' : 'SHORT';
        orderParams.reduceOnly = true;
      }

    } else {
      // BUY/SELL signal - เปิด position ใหม่
      const side = isLong ? 'BUY' : 'SELL';
      
      if (positionMode === 'HEDGE') {
        // In Hedge Mode, prevent duplicate same-side positions
        const positions = await client.futuresPositionRisk({ symbol });
        const targetSide = isLong ? 'LONG' : 'SHORT';
        const existing = positions.find(p => (p.positionSide === targetSide) && parseFloat(p.positionAmt) !== 0);
        if (existing) {
          console.log(`⚠️ Hedge Mode - ${targetSide} already open, skipping`);
      try { logSignal(bot, 'ORDER_SKIPPED', { status: 'info', payload: { reason: 'duplicate_same_side', mode: 'HEDGE' } }); } catch(_){}
      return res.json({ success:false, message:`${targetSide} position already open` });
        }
        orderParams = { symbol, side, type:'MARKET', quantity: qty, positionSide: targetSide };
        console.log('🔀 Hedge Mode - Opening:', orderParams.positionSide);
      } else {
        // One-Way Mode: ตรวจสอบ position ปัจจุบันก่อน
        const positions = await client.futuresPositionRisk({ symbol });
        const currentPosition = positions.find(p => parseFloat(p.positionAmt) !== 0);
        
        if (currentPosition) {
          const positionAmt = parseFloat(currentPosition.positionAmt);
          const isCurrentLong = positionAmt > 0;
          
          console.log('📍 One-Way Mode - Current position:', isCurrentLong ? 'LONG' : 'SHORT');
          
          // ถ้าสัญญาณเดียวกันกับ position ปัจจุบัน = ไม่ทำอะไร (ป้องกันการเปิดซ้ำ)
          if ((isLong && isCurrentLong) || (isShort && !isCurrentLong)) {
            console.log('⚠️ Same direction signal - Position already open, skipping');
          try { logSignal(bot, 'ORDER_SKIPPED', { status: 'info', payload: { reason: 'same_direction', mode: 'ONE_WAY' } }); } catch(_){}
          return res.json({ 
              success: false, 
              message: 'Position already open in same direction',
              botStatus: bot.status,
              currentPosition: isCurrentLong ? 'LONG' : 'SHORT'
            });
          }
          
          // ถ้าสัญญาณตรงข้ามกับ position ปัจจุบัน ให้ปิดก่อนแล้วเปิดใหม่
          if ((isLong && !isCurrentLong) || (isShort && isCurrentLong)) {
            console.log('🔄 Closing opposite position first');
            
            // ปิด position เก่า
            const closeOrder = await client.futuresOrder({
              symbol,
              side: isCurrentLong ? 'SELL' : 'BUY',
              type: 'MARKET',
              quantity: Math.abs(positionAmt)
            });
            
            console.log('✅ Closed position:', closeOrder.orderId);
            try { logSignal(bot, 'ORDER_CLOSE_SUCCESS', { status: 'success', price: mark, payload: { orderId: closeOrder.orderId } }); } catch(_){}
            
            // บันทึก CLOSE trade
            const closeTradeRecord = {
              id: Date.now(),
              botId: bot.id,
              orderId: closeOrder.orderId,
              type: 'CLOSE',
              side: isCurrentLong ? 'LONG' : 'SHORT',
              price: mark,
              quantity: Math.abs(positionAmt),
              timestamp: new Date().toISOString(),
              symbol: symbol
            };
            tradeOps.create(closeTradeRecord);
            console.log('💾 CLOSE trade recorded:', closeTradeRecord.side, '@', mark);
            
            // อัปเดต trades count สำหรับ CLOSE
            botOps.update(bot.id, { trades: bot.trades + 1 });
            
            // อัปเดตกำไร/ขาดทุนหลังปิด position
            updateBotProfit(bot.id, mark);
            
            // รอ 5ms เพื่อให้ timestamp ไม่ซ้ำกัน
            await new Promise(resolve => setTimeout(resolve, 5));
            
            // เปิด position ใหม่
            orderParams.quantity = qty; // ใช้ quantity ใหม่
          }
        }

        orderParams = { symbol, side, type:'MARKET', quantity: qty };
        console.log('📍 One-Way Mode - Opening:', side);
      }
    }

    console.log('📤 Sending order:', orderParams);
    try { logSignal(bot, 'ORDER_SENDING', { status: 'info', price: mark, payload: { order: orderParams } }); } catch(_){}
    const order = await client.futuresOrder(orderParams);

    const usedPrice = mark;
    const signal = {
      id: Date.now(),
      botId: bot.id,
      type: a,
      price: usedPrice,
      time: time || new Date().toISOString(),
      status: 'executed',
      payload: JSON.stringify(req.body || {})
    };
    signalOps.create(signal);
    signalOps.deleteOld(200);
    try { logSignal(bot, 'ORDER_SUCCESS', { status: 'success', price: usedPrice, payload: { orderId: order.orderId } }); } catch(_){}

    // ====== STOP LOSS LOGIC ======
    // วาง Stop Loss Order ถ้าเปิดใช้งาน
    if (!isClose && bot.stopLossEnabled && bot.stopLoss > 0) {
      try {
        let stopPrice;
        let stopSide;
        
        if (isLong) {
          // LONG: Stop Loss ต่ำกว่าราคา Entry
          stopPrice = usedPrice * (1 - bot.stopLoss / 100);
          stopSide = 'SELL'; // ปิด Long = ขาย
          console.log(`🛡️ Setting Stop Loss for LONG: ${stopPrice.toFixed(4)} (${bot.stopLoss}% below entry)`);
        } else if (isShort) {
          // SHORT: Stop Loss สูงกว่าราคา Entry
          stopPrice = usedPrice * (1 + bot.stopLoss / 100);
          stopSide = 'BUY'; // ปิด Short = ซื้อ
          console.log(`🛡️ Setting Stop Loss for SHORT: ${stopPrice.toFixed(4)} (${bot.stopLoss}% above entry)`);
        }
        
        if (stopPrice && stopSide) {
          // ปรับ stopPrice ให้เป็นทศนิยมที่ถูกต้องตาม price precision จาก exchange
          stopPrice = roundToStep(stopPrice, tickSize);
          
          const stopLossParams = {
            symbol,
            side: stopSide,
            type: 'STOP_MARKET',
            stopPrice: stopPrice,
            quantity: orderParams.quantity,
            closePosition: true
          };
          
          // สำหรับ Hedge Mode
          if (positionMode === 'HEDGE') {
            stopLossParams.positionSide = isLong ? 'LONG' : 'SHORT';
          }
          
          console.log('📤 Sending Stop Loss order:', stopLossParams);
          const stopLossOrder = await client.futuresOrder(stopLossParams);
          console.log(`✅ Stop Loss placed: Order ID ${stopLossOrder.orderId} @ ${stopPrice}`);
          try { logSignal(bot, 'SL_PLACED', { status: 'success', price: stopPrice, payload: { orderId: stopLossOrder.orderId } }); } catch(_){}
        }
      } catch (slError) {
        console.error('❌ Stop Loss placement failed:', slError?.body || slError?.message || slError);
        try { logSignal(bot, 'SL_ERROR', { status: 'error', payload: { error: slError?.body || slError?.message || String(slError) } }); } catch(_){}
        // ไม่ throw error เพื่อไม่ให้การเปิด position ล้มเหลว
      }
    }

    // บันทึกประวัติการเทรด
    const tradeRecord = {
      id: Date.now(),
      botId: bot.id,
      orderId: order.orderId,
      type: isClose ? 'CLOSE' : 'OPEN',
      side: isClose ? closingSide : (isLong ? 'LONG' : 'SHORT'), // ใช้ closingSide สำหรับ CLOSE
      price: usedPrice,
      quantity: orderParams.quantity,
      timestamp: new Date().toISOString(),
      symbol: symbol
    };

    tradeOps.create(tradeRecord);
    console.log('💾 Trade recorded:', tradeRecord.type, tradeRecord.side, '@', usedPrice);

    // อัปเดตบอทและยืนยันสถานะจาก Exchange หลังส่งคำสั่ง
    const botUpdates = {
      lastSignal: a,
      lastSignalTime: signal.time,
      trades: bot.trades + 1
    };

    try {
      const verify = await client.futuresPositionRisk({ symbol });
      const active = verify.find(p => parseFloat(p.positionAmt) !== 0);
      if (active) {
        const amt = parseFloat(active.positionAmt);
        botUpdates.position = amt > 0 ? 'long' : 'short';
        botUpdates.entryPrice = parseFloat(active.entryPrice || usedPrice);
        botUpdates.openPositions = 1;
        console.log(`📊 Verified from exchange: ${botUpdates.position.toUpperCase()} @ ${botUpdates.entryPrice}`);
      } else {
        botUpdates.position = 'none';
        botUpdates.entryPrice = 0;
        botUpdates.openPositions = 0;
        console.log('📊 Verified from exchange: NONE');
      }
    } catch (vErr) {
      console.log('⚠️ Verify position failed, falling back to signal logic:', vErr?.message || vErr);
      if (isClose) {
        botUpdates.position = 'none';
        botUpdates.entryPrice = 0;
        botUpdates.openPositions = 0;
      } else if (isLong || isShort) {
        botUpdates.position = isLong ? 'long' : 'short';
        botUpdates.entryPrice = usedPrice;
        botUpdates.openPositions = 1;
      }
    }

    botOps.update(bot.id, botUpdates);
    await updateBotProfit(bot.id, usedPrice);

    console.log('✅ futuresOrder', order.orderId, symbol, orderParams.side, 'qty=', orderParams.quantity);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    global.__lastOrderTime[botId] = Date.now();
    return res.json({ success:true, orderId: order.orderId, qty, price: usedPrice });
  } catch (error) {
    console.error('❌ webhook error:', error?.body || error?.message || error);
    try { const botId = parseInt(req.params.botId); const bot = botOps.getById(botId) || { id: botId }; logSignal(bot, 'ORDER_ERROR', { status: 'error', payload: { error: error?.body || error?.message || String(error) } }); } catch(_){}
    return res.status(500).json({ success:false, message: error?.body || error?.message || 'order failed' });
  } finally {
    if (global.__processingBots) {
      const id = parseInt(req.params.botId);
      global.__processingBots.delete(id);
    }
  }
});


app.get('/api/signals', (req, res) => {
  const signals = signalOps.getAll();
  res.json({ success: true, signals });
});

// Get trade history
app.get('/api/trades', (req, res) => {
  console.log('📊 API /api/trades called');
  const trades = tradeOps.getAll();
  res.json({ success: true, trades });
});

// Get trade history for specific bot
app.get('/api/trades/:botId', (req, res) => {
  const botId = parseInt(req.params.botId);
  const botTrades = tradeOps.getByBotId(botId);
  res.json({ success: true, trades: botTrades });
});

// ================== EXCHANGES API ==================
// ดึงรายชื่อสัญลักษณ์จาก Binance Futures (USDT-M)
app.get('/api/exchanges/:id/symbols', async (req, res) => {
  try {
    const exchangeId = parseInt(req.params.id);
    const exchange = exchangeOps.getById(exchangeId);
    if (!exchange) return res.status(404).json({ success:false, message:'Exchange not found' });
    
    const client = exchangeClients[exchange.name];
    if (!client) return res.status(400).json({ success:false, message:'Exchange not connected' });
    const info = await client.futuresExchangeInfo();
    const symbols = (info.symbols || [])
      .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING')
      .map(s => s.symbol);
    res.json({ success:true, symbols });
  } catch (e) {
    console.error('symbols error', e?.message || e);
    res.json({ success:false, symbols: [] });
  }
});
app.post('/api/exchanges', async (req, res) => {
  try {
    const { name, apiKey, apiSecret, testnet } = req.body;
    
    if (!name || !apiKey || !apiSecret) {
      return res.status(400).json({ 
        success: false, 
        message: 'กรุณากรอกข้อมูลให้ครบ' 
      });
    }
    
    console.log('🔗 กำลังเชื่อมต่อ Exchange:', name);
    
    const Binance = require('binance-api-node').default;
    const client = Binance({
      apiKey,
      apiSecret,
      useServerTime: true,
      ...(testnet && { 
        baseURL: 'https://testnet.binancefuture.com',
        futures: true 
      })
    });

    // ดึงข้อมูล Spot Account
    let spotBalances = [];
    try {
      const accountInfo = await client.accountInfo();
      spotBalances = accountInfo.balances
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => ({
          asset: b.asset,
          wallet: 'Spot',
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
          total: parseFloat(b.free) + parseFloat(b.locked)
        }));
      console.log('✅ Spot balances:', spotBalances.length);
    } catch (spotError) {
      console.log('⚠️ Spot wallet error:', spotError.message);
    }
    
    // ดึงข้อมูล Futures Account
    let futuresBalances = [];
    try {
      const futuresAccount = await client.futuresAccountBalance();
      futuresBalances = futuresAccount
        .filter(b => parseFloat(b.balance) > 0)
        .map(b => ({
          asset: b.asset,
          wallet: 'Futures',
          free: parseFloat(b.availableBalance || b.balance),
          locked: parseFloat(b.balance) - parseFloat(b.availableBalance || 0),
          total: parseFloat(b.balance)
        }));
      console.log('✅ Futures balances:', futuresBalances.length);
    } catch (futuresError) {
      console.log('⚠️ Futures wallet error:', futuresError.message);
    }
    
    // รวม Spot + Futures
    const allBalances = [...spotBalances, ...futuresBalances];
    
    // คำนวณ Total USDT
    let totalUSDT = 0;
    allBalances.forEach(b => {
      if (b.asset === 'USDT') {
        totalUSDT += b.total;
      }
    });
    
    const exchange = {
      id: Date.now(),
      name,
      type: 'Binance',
      apiKey: apiKey,  // เก็บเต็มรูปแบบ
      apiSecret: apiSecret,  // เก็บเต็มรูปแบบ
      status: 'connected',
      testnet: testnet || false,
      balances: allBalances,
      totalUSDT: totalUSDT.toFixed(2),
      lastUpdate: new Date().toISOString()
    };
    
    // เก็บ client ใน cache
    exchangeClients[name] = client;
    
    // เก็บลงฐานข้อมูล
    exchangeOps.create(exchange);
    
    console.log('✅ เชื่อมต่อสำเร็จ:', name);
    console.log('   Total USDT:', totalUSDT.toFixed(2));
    
    // Return masked API key for security
    const exchangeResponse = {
      ...exchange,
      apiKey: apiKey.slice(0, 8) + '...' + apiKey.slice(-4),
      apiSecret: '***' // ไม่ส่งกลับไปหน้าบ้าน
    };
    
    res.json({ success: true, exchange: exchangeResponse });
    
  } catch (error) {
    console.error('❌ เชื่อมต่อไม่สำเร็จ:', error.message);
    res.status(400).json({ 
      success: false, 
      message: 'เชื่อมต่อไม่สำเร็จ: ' + error.message 
    });
  }
});

app.get('/api/exchanges', (req, res) => {
  const exchanges = exchangeOps.getAll();
  
  // Mask sensitive data before sending to frontend
  const safeExchanges = exchanges.map(ex => ({
    ...ex,
    apiKey: ex.apiKey ? ex.apiKey.slice(0, 8) + '...' + ex.apiKey.slice(-4) : '',
    apiSecret: '***' // ไม่ส่ง secret กลับไป
  }));
  
  res.json({ success: true, exchanges: safeExchanges });
});

app.delete('/api/exchanges/:id', (req, res) => {
  const exchangeId = parseInt(req.params.id);
  const exchange = exchangeOps.getById(exchangeId);
  
  if (exchange) {
    // ลบ client จาก cache
    delete exchangeClients[exchange.name];
  }
  
  exchangeOps.delete(exchangeId);
  console.log('🗑️ ลบ Exchange ID:', exchangeId);
  res.json({ success: true });
});

app.post('/api/exchanges/:id/refresh', async (req, res) => {
  try {
    const exchangeId = parseInt(req.params.id);
    const exchange = exchangeOps.getById(exchangeId);
    
    if (!exchange) {
      return res.status(404).json({ success: false, message: 'Exchange not found' });
    }
    
    const client = exchangeClients[exchange.name];
    if (!client) {
      return res.status(400).json({ 
        success: false, 
        message: 'กรุณาเชื่อมต่อ Exchange ใหม่อีกครั้ง' 
      });
    }
    
    console.log('🔄 Refreshing balance:', exchange.name);
    
    // ดึงข้อมูล Spot
    let spotBalances = [];
    try {
      const accountInfo = await client.accountInfo();
      spotBalances = accountInfo.balances
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => ({
          asset: b.asset,
          wallet: 'Spot',
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
          total: parseFloat(b.free) + parseFloat(b.locked)
        }));
    } catch (spotError) {
      console.log('⚠️ Spot wallet error:', spotError.message);
    }
    
    // ดึงข้อมูล Futures
    let futuresBalances = [];
    try {
      const futuresAccount = await client.futuresAccountBalance();
      futuresBalances = futuresAccount
        .filter(b => parseFloat(b.balance) > 0)
        .map(b => ({
          asset: b.asset,
          wallet: 'Futures',
          free: parseFloat(b.availableBalance || b.balance),
          locked: parseFloat(b.balance) - parseFloat(b.availableBalance || 0),
          total: parseFloat(b.balance)
        }));
    } catch (futuresError) {
      console.log('⚠️ Futures wallet error:', futuresError.message);
    }
    
    const allBalances = [...spotBalances, ...futuresBalances];
    
    let totalUSDT = 0;
    allBalances.forEach(b => {
      if (b.asset === 'USDT') {
        totalUSDT += b.total;
      }
    });
    
    // อัปเดตลงฐานข้อมูล
    const updatedExchange = exchangeOps.update(exchangeId, {
      balances: allBalances,
      totalUSDT: totalUSDT.toFixed(2),
      lastUpdate: new Date().toISOString()
    });
    
    console.log('✅ Balance updated');
    console.log('   Spot:', spotBalances.length, 'assets');
    console.log('   Futures:', futuresBalances.length, 'assets');
    console.log('   Total USDT:', totalUSDT);
    
    res.json({ success: true, exchange: updatedExchange });
    
  } catch (error) {
    console.error('❌ Refresh failed:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
});

// ================== SERVE FRONTEND ==================
// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ 
    success: false, 
    message: err.message || 'Internal Server Error'
  });
});

// ================== DATABASE BACKUP API ==================
app.post('/api/backup', (req, res) => {
  try {
    const result = backupDatabase();
    if (result) {
      res.json({ success: true, message: 'Backup created successfully' });
    } else {
      res.status(500).json({ success: false, message: 'Backup failed' });
    }
  } catch (error) {
    console.error('❌ Backup API error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================== TRADING PAIRS API ==================
app.get('/api/trading-pairs/:exchangeId', async (req, res) => {
  try {
    const exchangeId = parseInt(req.params.exchangeId);
    const exchange = exchangeOps.getById(exchangeId);
    
    if (!exchange) {
      return res.status(404).json({ success: false, message: 'Exchange not found' });
    }
    
    console.log('📊 Fetching trading pairs using Public API');
    
    // ใช้ Public API ของ Binance (ไม่ต้อง authentication)
    const axios = require('axios');
    const response = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
    
    const pairs = response.data.symbols
      .filter(s => 
        s.symbol.endsWith('USDT') && 
        s.contractType === 'PERPETUAL' &&
        s.status === 'TRADING'
      )
      .map(s => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    
    console.log('✅ Found', pairs.length, 'trading pairs');
    res.json({ success: true, pairs });
    
  } catch (error) {
    console.error('❌ Failed to fetch trading pairs:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ================== MARKET EXPLORER API ==================
app.get('/api/market/trending', async (req, res) => {
  try {
    console.log('🔥 Fetching trending markets from Binance');
    
    const axios = require('axios');
    
    // ดึงข้อมูล 24hr ticker สำหรับทุกคู่เทรด
    const response = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr');
    
    // กรองเฉพาะ USDT pairs และมี volume สูง
    const markets = response.data
      .filter(ticker => 
        ticker.symbol.endsWith('USDT') && 
        parseFloat(ticker.quoteVolume) > 10000000 // Volume > 10M USDT
      )
      .map(ticker => ({
        symbol: ticker.symbol,
        lastPrice: ticker.lastPrice,
        priceChangePercent: ticker.priceChangePercent,
        volume: ticker.quoteVolume,
        high24h: ticker.highPrice,
        low24h: ticker.lowPrice,
        trades: ticker.count
      }))
      .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume)) // เรียงตาม volume
      .slice(0, 100); // เอาแค่ 100 อันดับแรก
    
    console.log(`✅ Found ${markets.length} trending markets`);
    res.json({ success: true, markets });
    
  } catch (error) {
    console.error('❌ Failed to fetch market data:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      markets: []
    });
  }
});

// Handle 404 และ serve frontend
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ 
      success: false, 
      message: 'API endpoint not found' 
    });
  } else {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Trading Bot API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Server: http://5.223.66.33');
  console.log('📡 Webhook: /api/webhook/:botId');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});


