const { initDatabase, botOps, tradeOps, calculateBotProfit } = require('./database');

/**
 * Script สำหรับแก้ไขประวัติ trades ที่บันทึกไว้ผิด
 * - ตรวจสอบ trades ที่เปลี่ยน direction (LONG → SHORT หรือ SHORT → LONG)
 * - แทรก CLOSE trade ที่ขาดหายไป
 */

async function fixTradesHistory() {
  console.log('🔧 Starting trades history fix...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Initialize database
  initDatabase();

  // Get all bots
  const bots = botOps.getAll();
  console.log(`📊 Found ${bots.length} bots\n`);

  let totalFixed = 0;
  let totalInserted = 0;

  for (const bot of bots) {
    console.log(`\n🤖 Processing Bot: ${bot.name} (ID: ${bot.id})`);
    console.log('─────────────────────────────────────');

    // Get all trades for this bot, sorted by timestamp
    const trades = tradeOps.getByBotId(bot.id);
    
    if (trades.length === 0) {
      console.log('  ⚠️  No trades found');
      continue;
    }

    // Sort by timestamp (oldest first)
    const sortedTrades = [...trades].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    console.log(`  📈 Total trades: ${sortedTrades.length}`);
    console.log('');

    // Process trades
    let lastOpenTrade = null;
    const closeTradesToInsert = [];
    let botFixed = 0;

    for (let i = 0; i < sortedTrades.length; i++) {
      const trade = sortedTrades[i];
      const timestamp = new Date(trade.timestamp).toLocaleString('th-TH');
      
      console.log(`  [${i + 1}] ${timestamp}`);
      console.log(`      Type: ${trade.type}, Side: ${trade.side}, Price: $${trade.price.toFixed(4)}`);

      if (trade.type === 'OPEN') {
        // ตรวจสอบว่ามี position เปิดอยู่แล้วหรือไม่
        if (lastOpenTrade) {
          // มี position เปิดอยู่ แล้วเปิดใหม่ = ต้องปิดก่อน
          if (lastOpenTrade.side !== trade.side) {
            // Direction เปลี่ยน = ควรปิด position เก่าก่อน
            console.log(`      ⚠️  Direction changed! Should CLOSE ${lastOpenTrade.side} first`);
            
            // สร้าง CLOSE trade
            const closeTrade = {
              id: trade.id - 1, // ใช้ ID ก่อนหน้าเล็กน้อย
              botId: bot.id,
              orderId: lastOpenTrade.orderId,
              type: 'CLOSE',
              side: lastOpenTrade.side,
              price: trade.price, // ใช้ราคาของ trade ใหม่
              quantity: lastOpenTrade.quantity,
              timestamp: new Date(new Date(trade.timestamp).getTime() - 1000).toISOString(), // 1 วินาทีก่อนหน้า
              symbol: trade.symbol
            };
            
            closeTradesToInsert.push(closeTrade);
            console.log(`      ✅ Will insert CLOSE ${lastOpenTrade.side} @ $${trade.price.toFixed(4)}`);
            botFixed++;
            totalInserted++;
          } else {
            // Same direction = duplicate OPEN (ไม่ควรเกิด แต่ถ้าเกิดให้เตือน)
            console.log(`      ⚠️  Duplicate OPEN ${trade.side} - keeping as is`);
          }
        }
        
        // Update lastOpenTrade
        lastOpenTrade = trade;
      } else if (trade.type === 'CLOSE') {
        // มี CLOSE trade แล้ว = ถูกต้อง
        console.log(`      ✅ Correct CLOSE trade`);
        lastOpenTrade = null; // Reset
      }
    }

    // Insert CLOSE trades
    if (closeTradesToInsert.length > 0) {
      console.log(`\n  💾 Inserting ${closeTradesToInsert.length} CLOSE trades...`);
      for (const closeTrade of closeTradesToInsert) {
        tradeOps.create(closeTrade);
        console.log(`      ✅ Inserted CLOSE ${closeTrade.side} @ $${closeTrade.price.toFixed(4)}`);
      }
      
      // Recalculate profit
      const profitData = calculateBotProfit(bot.id);
      botOps.update(bot.id, {
        profit: profitData.profit,
        currentBalance: bot.startBalance + profitData.profitUSDT,
        trades: bot.trades + closeTradesToInsert.length // อัปเดต trade count
      });
      
      console.log(`\n  📊 Updated Profit:`);
      console.log(`      Realized P&L: $${profitData.realizedPnL.toFixed(2)}`);
      console.log(`      Unrealized P&L: $${profitData.unrealizedPnL.toFixed(2)}`);
      console.log(`      Total: ${profitData.profit.toFixed(2)}% ($${profitData.profitUSDT.toFixed(2)})`);
      console.log(`      Open Positions: ${profitData.openPositions}`);
      
      totalFixed++;
    } else {
      console.log(`\n  ✅ No fixes needed - trades history is correct!`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Bots processed: ${bots.length}`);
  console.log(`Bots fixed: ${totalFixed}`);
  console.log(`CLOSE trades inserted: ${totalInserted}`);
  console.log('');
  
  if (totalInserted > 0) {
    console.log('✅ Trades history has been fixed successfully!');
    console.log('💡 Profit/Loss calculations should now be accurate.');
  } else {
    console.log('✅ No issues found - all trades are correct!');
  }
  
  console.log('');
}

// Run the fix
fixTradesHistory().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});

