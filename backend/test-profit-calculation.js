const { initDatabase, botOps, tradeOps, calculateBotProfit } = require('./database');

async function runTest() {
// Initialize database
initDatabase();

// สร้างบอททดสอบ
const testBot = {
  id: Date.now(),
  name: 'Test Bot - Profit Calculation',
  pair: 'BTCUSDT/USDT',
  exchange: 'Binance',
  strategy: 'Test',
  status: 'paused',
  profit: 0,
  trades: 0,
  startBalance: 100, // เริ่มต้น $100
  currentBalance: 100,
  token: 'test-token-' + Date.now(),
  webhookUrl: 'http://test.com/webhook',
  lastSignal: '-',
  lastSignalTime: '-',
  position: 'none',
  entryPrice: 0,
  leverageType: 'cross',
  leverageValue: 1,
  botType: 'single',
  orderType: 'market',
  direction: 'long',
  createdAt: new Date().toISOString()
};

console.log('🧪 Testing Profit Calculation System');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// สร้างบอท
botOps.create(testBot);
console.log(`✅ Created test bot: ${testBot.name}`);
console.log(`   Start Balance: $${testBot.startBalance}`);
console.log('');

// Scenario 1: LONG Trade - กำไร
console.log('📊 Scenario 1: LONG Trade (Profit)');
console.log('─────────────────────────────────');

// OPEN LONG @ $50,000, quantity = 0.002 BTC (ใช้เงิน $100)
const trade1_open = {
  id: Date.now(),
  botId: testBot.id,
  orderId: 'ORDER_001',
  type: 'OPEN',
  side: 'LONG',
  price: 50000,
  quantity: 0.002, // 0.002 BTC * $50,000 = $100
  timestamp: new Date().toISOString(),
  symbol: 'BTCUSDT'
};

tradeOps.create(trade1_open);
console.log(`   OPEN LONG @ $${trade1_open.price}`);
console.log(`   Quantity: ${trade1_open.quantity} BTC`);
console.log(`   Value: $${(trade1_open.price * trade1_open.quantity).toFixed(2)}`);
console.log('');

// รอ 1ms เพื่อให้ timestamp ต่างกัน
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
await delay(5);

// CLOSE LONG @ $52,000 (กำไร $4)
const trade1_close = {
  id: Date.now() + 1,
  botId: testBot.id,
  orderId: 'ORDER_002',
  type: 'CLOSE',
  side: 'LONG',
  price: 52000,
  quantity: 0.002,
  timestamp: new Date().toISOString(),
  symbol: 'BTCUSDT'
};

tradeOps.create(trade1_close);
console.log(`   CLOSE @ $${trade1_close.price}`);
console.log(`   Expected P&L: ($52,000 - $50,000) * 0.002 = $${((52000 - 50000) * 0.002).toFixed(2)}`);
console.log('');

// คำนวณกำไร
const result1 = calculateBotProfit(testBot.id);

console.log('   📈 Calculated Results:');
console.log(`   Realized P&L: $${result1.realizedPnL.toFixed(2)}`);
console.log(`   Profit %: ${result1.profit.toFixed(2)}%`);
console.log(`   New Balance: $${(testBot.startBalance + result1.profitUSDT).toFixed(2)}`);
console.log('');

// Scenario 2: SHORT Trade - กำไร
console.log('📊 Scenario 2: SHORT Trade (Profit)');
console.log('─────────────────────────────────');

await delay(5);

// OPEN SHORT @ $52,000, quantity = 0.002 BTC
const trade2_open = {
  id: Date.now() + 2,
  botId: testBot.id,
  orderId: 'ORDER_003',
  type: 'OPEN',
  side: 'SHORT',
  price: 52000,
  quantity: 0.002,
  timestamp: new Date().toISOString(),
  symbol: 'BTCUSDT'
};

tradeOps.create(trade2_open);
console.log(`   OPEN SHORT @ $${trade2_open.price}`);
console.log(`   Quantity: ${trade2_open.quantity} BTC`);
console.log('');

await delay(5);

// CLOSE SHORT @ $51,000 (กำไร $2)
const trade2_close = {
  id: Date.now() + 3,
  botId: testBot.id,
  orderId: 'ORDER_004',
  type: 'CLOSE',
  side: 'SHORT',
  price: 51000,
  quantity: 0.002,
  timestamp: new Date().toISOString(),
  symbol: 'BTCUSDT'
};

tradeOps.create(trade2_close);
console.log(`   CLOSE @ $${trade2_close.price}`);
console.log(`   Expected P&L: ($52,000 - $51,000) * 0.002 = $${((52000 - 51000) * 0.002).toFixed(2)}`);
console.log('');

const result2 = calculateBotProfit(testBot.id);

console.log('   📈 Calculated Results (Cumulative):');
console.log(`   Total Realized P&L: $${result2.realizedPnL.toFixed(2)}`);
console.log(`   Total Profit %: ${result2.profit.toFixed(2)}%`);
console.log(`   New Balance: $${(testBot.startBalance + result2.profitUSDT).toFixed(2)}`);
console.log('');

// Scenario 3: LONG Trade - ขาดทุน
console.log('📊 Scenario 3: LONG Trade (Loss)');
console.log('─────────────────────────────────');

await delay(5);

// OPEN LONG @ $51,000
const trade3_open = {
  id: Date.now() + 4,
  botId: testBot.id,
  orderId: 'ORDER_005',
  type: 'OPEN',
  side: 'LONG',
  price: 51000,
  quantity: 0.002,
  timestamp: new Date().toISOString(),
  symbol: 'BTCUSDT'
};

tradeOps.create(trade3_open);
console.log(`   OPEN LONG @ $${trade3_open.price}`);
console.log('');

await delay(5);

// CLOSE LONG @ $50,000 (ขาดทุน -$2)
const trade3_close = {
  id: Date.now() + 5,
  botId: testBot.id,
  orderId: 'ORDER_006',
  type: 'CLOSE',
  side: 'LONG',
  price: 50000,
  quantity: 0.002,
  timestamp: new Date().toISOString(),
  symbol: 'BTCUSDT'
};

tradeOps.create(trade3_close);
console.log(`   CLOSE @ $${trade3_close.price}`);
console.log(`   Expected P&L: ($50,000 - $51,000) * 0.002 = $${((50000 - 51000) * 0.002).toFixed(2)}`);
console.log('');

const result3 = calculateBotProfit(testBot.id);

console.log('   📈 Final Results:');
console.log(`   Total Realized P&L: $${result3.realizedPnL.toFixed(2)}`);
console.log(`   Total Profit %: ${result3.profit.toFixed(2)}%`);
console.log(`   Final Balance: $${(testBot.startBalance + result3.profitUSDT).toFixed(2)}`);
console.log('');

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Start Balance: $${testBot.startBalance.toFixed(2)}`);
console.log(`Trade 1 (LONG): +$${((52000 - 50000) * 0.002).toFixed(2)}`);
console.log(`Trade 2 (SHORT): +$${((52000 - 51000) * 0.002).toFixed(2)}`);
console.log(`Trade 3 (LONG): -$${Math.abs((50000 - 51000) * 0.002).toFixed(2)}`);
console.log(`Expected Total P&L: $${(((52000-50000)*0.002) + ((52000-51000)*0.002) + ((50000-51000)*0.002)).toFixed(2)}`);
console.log(`Calculated Total P&L: $${result3.profitUSDT.toFixed(2)}`);
console.log(`Expected Final Balance: $${(100 + 4 + 2 - 2).toFixed(2)}`);
console.log(`Calculated Final Balance: $${(testBot.startBalance + result3.profitUSDT).toFixed(2)}`);
console.log('');

if (Math.abs(result3.profitUSDT - 4) < 0.01) {
  console.log('✅ PROFIT CALCULATION TEST PASSED!');
} else {
  console.log('❌ PROFIT CALCULATION TEST FAILED!');
  console.log(`   Expected: $4.00, Got: $${result3.profitUSDT.toFixed(2)}`);
}

console.log('');
console.log('🧹 Cleaning up test data...');
// ลบข้อมูลทดสอบ
botOps.delete(testBot.id);
console.log('✅ Test completed and cleaned up');
}

// Run the test
runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

