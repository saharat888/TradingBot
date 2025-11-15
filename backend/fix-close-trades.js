const { initDatabase, tradeOps, db } = require('./database');

initDatabase();

console.log('🔧 กำลังแก้ไขข้อมูล CLOSE trades ที่ผิดพลาด...\n');

// หา trades ที่มีปัญหา (type=CLOSE และ side=CLOSE)
const allTrades = tradeOps.getAll();
const problematicTrades = allTrades.filter(t => t.type === 'CLOSE' && t.side === 'CLOSE');

console.log(`❌ พบ CLOSE trades ที่ผิด: ${problematicTrades.length} รายการ\n`);

if (problematicTrades.length === 0) {
  console.log('✅ ไม่มีข้อมูลที่ต้องแก้ไข');
  process.exit(0);
}

// แก้ไขแต่ละ trade โดยหา OPEN trade ที่ match กัน
let fixed = 0;
let failed = 0;

problematicTrades.forEach(closeTrade => {
  try {
    // หา OPEN trades ของ bot เดียวกันที่เกิดก่อนหน้า CLOSE trade นี้
    const botTrades = allTrades
      .filter(t => t.botId === closeTrade.botId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // หา OPEN trade ล่าสุดที่ยังไม่ปิด (ก่อน CLOSE trade นี้)
    let openTrade = null;
    let openCount = 0;
    let closeCount = 0;

    for (const trade of botTrades) {
      // ถึง CLOSE trade ที่เราต้องการแก้แล้ว
      if (trade.id === closeTrade.id) {
        break;
      }

      if (trade.type === 'OPEN') {
        openCount++;
        openTrade = trade; // เก็บ OPEN trade ล่าสุด
      } else if (trade.type === 'CLOSE') {
        closeCount++;
      }
    }

    if (openTrade && openCount > closeCount) {
      // มี OPEN trade ที่ยังไม่ปิด ใช้ side จาก OPEN trade นั้น
      const correctSide = openTrade.side;

      // อัพเดท database
      const stmt = db.prepare('UPDATE trade_history SET side = ? WHERE id = ?');
      stmt.run(correctSide, closeTrade.id);

      console.log(`✅ แก้ไข Trade ${closeTrade.id}: CLOSE → ${correctSide} (จาก OPEN ${openTrade.id})`);
      fixed++;
    } else {
      // ไม่เจอ OPEN trade ที่ match - อาจเป็นข้อมูลเสีย
      console.log(`⚠️  ไม่สามารถแก้ไข Trade ${closeTrade.id}: ไม่เจอ OPEN trade ที่ match`);
      failed++;
    }
  } catch (err) {
    console.error(`❌ Error แก้ไข Trade ${closeTrade.id}:`, err.message);
    failed++;
  }
});

console.log('\n' + '─'.repeat(60));
console.log('📊 สรุปผลการแก้ไข:');
console.log(`   ✅ แก้ไขสำเร็จ: ${fixed} รายการ`);
console.log(`   ❌ แก้ไขไม่สำเร็จ: ${failed} รายการ`);
console.log('─'.repeat(60));

if (failed > 0) {
  console.log('\n⚠️  มีข้อมูลที่แก้ไม่ได้ - พิจารณาลบออก หรือตรวจสอบด้วยตนเอง');
}

process.exit(0);
