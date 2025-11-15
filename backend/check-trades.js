const { initDatabase, tradeOps } = require('./database');

initDatabase();

console.log('🔍 ตรวจสอบข้อมูล Trade History...\n');

const allTrades = tradeOps.getAll();

console.log(`📊 จำนวน Trades ทั้งหมด: ${allTrades.length}`);

// นับตาม side
const sideCount = {
  'LONG': 0,
  'SHORT': 0,
  'CLOSE': 0,
  'other': 0
};

allTrades.forEach(trade => {
  if (sideCount[trade.side] !== undefined) {
    sideCount[trade.side]++;
  } else {
    sideCount['other']++;
  }
});

console.log('\n📈 สถิติตาม Side:');
console.log(`   LONG:  ${sideCount.LONG}`);
console.log(`   SHORT: ${sideCount.SHORT}`);
console.log(`   CLOSE: ${sideCount.CLOSE} ❌ (ผิด - ควรเป็น LONG/SHORT)`);
console.log(`   Other: ${sideCount.other}`);

// นับตาม type
const typeCount = {
  'OPEN': 0,
  'CLOSE': 0
};

allTrades.forEach(trade => {
  typeCount[trade.type]++;
});

console.log('\n📋 สถิติตาม Type:');
console.log(`   OPEN:  ${typeCount.OPEN}`);
console.log(`   CLOSE: ${typeCount.CLOSE}`);

// แสดง trades ล่าสุด 10 รายการ
console.log('\n🔍 Trades ล่าสุด 10 รายการ:');
console.log('─'.repeat(80));
console.log('ID\t\tType\tSide\tPrice\t\tQty\tTimestamp');
console.log('─'.repeat(80));

allTrades.slice(0, 10).forEach(trade => {
  console.log(`${trade.id}\t${trade.type}\t${trade.side}\t$${trade.price.toFixed(2)}\t${trade.quantity}\t${trade.timestamp}`);
});

// หา trades ที่มีปัญหา (type=CLOSE แต่ side=CLOSE)
const problematicTrades = allTrades.filter(t => t.type === 'CLOSE' && t.side === 'CLOSE');

console.log(`\n⚠️  Trades ที่มีปัญหา (type=CLOSE และ side=CLOSE): ${problematicTrades.length}`);

if (problematicTrades.length > 0) {
  console.log('\n❌ พบ Trades ที่ผิดพลาด:');
  problematicTrades.slice(0, 5).forEach(trade => {
    console.log(`   ID: ${trade.id}, BotId: ${trade.botId}, Side: ${trade.side} ← ควรเป็น LONG/SHORT`);
  });

  console.log('\n💡 แนะนำ: ต้องแก้ไขข้อมูลเก่าในฐานข้อมูล');
}

process.exit(0);
