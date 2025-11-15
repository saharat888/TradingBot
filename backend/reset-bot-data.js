const { initDatabase, botOps, tradeOps, db } = require('./database');

initDatabase();

// รับ botId จาก command line argument
const botId = process.argv[2];

if (!botId) {
  console.log('❌ กรุณาระบุ Bot ID');
  console.log('\n📋 รายการบอททั้งหมด:');
  console.log('─'.repeat(80));

  const allBots = botOps.getAll();

  if (allBots.length === 0) {
    console.log('ไม่พบบอทในระบบ');
    process.exit(1);
  }

  allBots.forEach(bot => {
    const trades = tradeOps.getByBotId(bot.id);
    const openTrades = trades.filter(t => t.type === 'OPEN').length;
    const closeTrades = trades.filter(t => t.type === 'CLOSE').length;

    console.log(`ID: ${bot.id}`);
    console.log(`  Name: ${bot.name}`);
    console.log(`  Pair: ${bot.pair}`);
    console.log(`  Profit: ${bot.profit.toFixed(2)}%`);
    console.log(`  Trades: ${trades.length} (OPEN: ${openTrades}, CLOSE: ${closeTrades})`);
    console.log(`  Position: ${bot.position}`);
    console.log('─'.repeat(80));
  });

  console.log('\n💡 วิธีใช้:');
  console.log('   node reset-bot-data.js <BOT_ID>');
  console.log('\n   ตัวอย่าง: node reset-bot-data.js 1762332635634');
  console.log('   หรือ reset ทุกบอท: node reset-bot-data.js all\n');

  process.exit(0);
}

// ฟังก์ชันสำหรับ reset bot
function resetBot(bot) {
  console.log(`\n🔄 กำลัง Reset Bot: ${bot.name} (ID: ${bot.id})`);

  // ดึงข้อมูลก่อน reset
  const trades = tradeOps.getByBotId(bot.id);
  const openTrades = trades.filter(t => t.type === 'OPEN');
  const closeTrades = trades.filter(t => t.type === 'CLOSE');

  console.log('\n📊 ข้อมูลก่อน Reset:');
  console.log(`   Total Trades: ${trades.length}`);
  console.log(`   OPEN: ${openTrades.length}`);
  console.log(`   CLOSE: ${closeTrades.length}`);
  console.log(`   Profit: ${bot.profit.toFixed(2)}%`);
  console.log(`   Position: ${bot.position}`);

  // ลบ trade history
  const deleteStmt = db.prepare('DELETE FROM trade_history WHERE botId = ?');
  const result = deleteStmt.run(bot.id);

  console.log(`\n🗑️  ลบ Trade History: ${result.changes} รายการ`);

  // รีเซ็ต bot stats
  botOps.update(bot.id, {
    profit: 0,
    trades: 0,
    currentBalance: bot.startBalance,
    position: 'none',
    entryPrice: 0,
    openPositions: 0,
    lastSignal: '-',
    lastSignalTime: '-'
  });

  console.log('✅ รีเซ็ต Bot Stats:');
  console.log('   - Profit = 0%');
  console.log('   - Trades = 0');
  console.log(`   - Current Balance = ${bot.startBalance}`);
  console.log('   - Position = none');
  console.log('   - Open Positions = 0');

  const updatedBot = botOps.getById(bot.id);

  console.log('\n📊 ข้อมูลหลัง Reset:');
  console.log(`   Name: ${updatedBot.name}`);
  console.log(`   Profit: ${updatedBot.profit}%`);
  console.log(`   Trades: ${updatedBot.trades}`);
  console.log(`   Position: ${updatedBot.position}`);
  console.log(`   Balance: ${updatedBot.currentBalance} USDT`);

  console.log('\n✅ Reset สำเร็จ!\n');
}

// Reset ทุกบอท
if (botId.toLowerCase() === 'all') {
  const allBots = botOps.getAll();

  console.log(`\n⚠️  คุณกำลังจะ Reset ทุกบอท (${allBots.length} บอท)`);
  console.log('━'.repeat(80));

  allBots.forEach(bot => {
    resetBot(bot);
  });

  console.log('━'.repeat(80));
  console.log(`✅ Reset ทั้งหมด ${allBots.length} บอทเสร็จสิ้น!`);

} else {
  // Reset บอทเดียว
  const bot = botOps.getById(parseInt(botId));

  if (!bot) {
    console.log(`❌ ไม่พบบอท ID: ${botId}`);
    console.log('\n💡 ใช้คำสั่ง: node reset-bot-data.js เพื่อดูรายการบอททั้งหมด');
    process.exit(1);
  }

  console.log('\n⚠️  คุณกำลังจะ Reset Bot:');
  console.log(`   ID: ${bot.id}`);
  console.log(`   Name: ${bot.name}`);
  console.log(`   Pair: ${bot.pair}`);

  resetBot(bot);
}

process.exit(0);
