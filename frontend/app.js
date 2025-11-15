const API_URL = window.location.origin + '/api';
let currentPage = 'dashboard';
let bots = [];
let signals = [];
let exchanges = [];
let events = [];
let loading = true;
let tradingPairs = [];
let autoRefreshInterval = null;
let marketData = []; // ข้อมูลตลาดสำหรับ Explorer

// Bot configuration state
window.botConfig = {
  direction: 'long',
  botType: 'single',
  orderType: 'market',
  entryOrderType: 'market', // ประเภท order เมื่อเปิด position
  leverageType: 'cross',
  leverageValue: 1,
  orderSizeType: 'usdt', // 'usdt' หรือ 'percent'
  orderSizeValue: 10
};

async function loadData() {
  try {
    const [botsRes, signalsRes, exchangesRes, eventsRes] = await Promise.all([
      fetch(API_URL + '/bots'),
      fetch(API_URL + '/signals'),
      fetch(API_URL + '/exchanges'),
      fetch(API_URL + '/events').catch(() => ({ json: () => ({ success: false, events: [] }) }))
    ]);
    const botsData = await botsRes.json();
    const signalsData = await signalsRes.json();
    const exchangesData = await exchangesRes.json();
    const eventsData = await eventsRes.json();
    
    if (botsData.success) {
      bots = botsData.bots;
      
      // ตั้งค่าเริ่มต้นให้กับบอททุกตัวก่อน
      bots.forEach(bot => {
        if (typeof bot.profit !== 'number') bot.profit = 0;
        if (typeof bot.profitUSDT !== 'number') bot.profitUSDT = 0;
        if (typeof bot.currentBalance !== 'number') bot.currentBalance = bot.startBalance || 0;
      });
      
      // โหลดข้อมูล profit แบบเรียลไทม์สำหรับแต่ละบอท
      await loadBotsProfit();
    }
    
    if (signalsData.success) signals = signalsData.signals;
    if (exchangesData.success) exchanges = exchangesData.exchanges;
    if (eventsData.success) events = eventsData.events || [];
    loading = false;
    render();
    
    // เริ่ม auto-refresh ถ้าอยู่หน้า dashboard
    startAutoRefresh();
  } catch (error) {
    console.error('Error:', error);
    loading = false;
    render();
  }
}

// โหลดข้อมูล profit สำหรับบอททั้งหมด
async function loadBotsProfit() {
  const profitPromises = bots.map(async bot => {
    try {
      const profitRes = await fetch(`${API_URL}/bots/${bot.id}/profit`);
      const profitData = await profitRes.json();
      if (profitData.success) {
        // อัปเดต profit ใน bot object
        bot.profit = profitData.profit.percentage || 0;
        bot.profitUSDT = profitData.profit.usd || 0;
        bot.currentBalance = profitData.bot.currentBalance || bot.startBalance;
        bot.realizedPnL = profitData.profit.realizedPnL || 0;
        bot.unrealizedPnL = profitData.profit.unrealizedPnL || 0;
        bot.currentPrice = profitData.currentPrice;
        bot.openPositions = profitData.profit.openPositions || 0;
        // อัปเดตสถานะ position จาก Exchange ถ้ามี
        if (profitData.currentPosition) {
          bot.position = profitData.currentPosition;
        }
        // ถ้าไม่มี position แล้ว บังคับให้ open = 0 เพื่อไม่ให้ UI แสดงค้าง
        if (bot.position === 'none') bot.openPositions = 0;
      }
    } catch (err) {
      console.error('❌ Error loading profit for bot', bot.id, err);
      // ตั้งค่าเริ่มต้นถ้า error
      bot.profit = 0;
      bot.profitUSDT = 0;
      bot.currentBalance = bot.startBalance || 0;
      bot.realizedPnL = 0;
      bot.unrealizedPnL = 0;
    }
  });
  
  await Promise.all(profitPromises);
}

// Auto-refresh profit ทุก 10 วินาที
function startAutoRefresh() {
  // Clear existing interval
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  // Start new interval (10 seconds)
  autoRefreshInterval = setInterval(async () => {
    if (currentPage === 'dashboard' || currentPage === 'bots') {
      await loadBotsProfit();
      updateBotProfitDisplay(); // Update เฉพาะตัวเลขที่เปลี่ยน ไม่ re-render ทั้งหน้า
    }
  }, 10000);
}

// Update เฉพาะส่วน profit display โดยไม่ re-render ทั้งหน้า
function updateBotProfitDisplay() {
  // Update แต่ละ bot card
  bots.forEach(bot => {
    const botCard = document.querySelector(`[data-bot-id="${bot.id}"]`);
    if (!botCard) return;
    
    // Update Total P&L
    const totalPnL = botCard.querySelector('[data-total-pnl]');
    if (totalPnL) {
      const pnlValue = totalPnL.querySelector('.font-bold');
      const pnlUSD = totalPnL.querySelector('.text-xs');
      if (pnlValue) {
        pnlValue.className = `font-bold ${bot.profit >= 0 ? 'text-green-600' : 'text-red-600'}`;
        pnlValue.textContent = `${bot.profit >= 0 ? '+' : ''}${bot.profit.toFixed(2)}%`;
      }
      if (pnlUSD) {
        pnlUSD.textContent = `${(bot.profitUSDT || 0) >= 0 ? '+' : ''}$${(bot.profitUSDT || 0).toFixed(2)}`;
      }
    }
    
    // Update Realized PnL
    const realizedPnL = botCard.querySelector('[data-realized-pnl]');
    if (realizedPnL) {
      const realizedValue = realizedPnL.querySelector('.font-bold');
      if (realizedValue) {
        realizedValue.className = `font-bold ${(bot.realizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`;
        realizedValue.textContent = `${(bot.realizedPnL || 0) >= 0 ? '+' : ''}$${(bot.realizedPnL || 0).toFixed(2)}`;
      }
    }
    
    // Update Unrealized PnL
    const unrealizedPnL = botCard.querySelector('[data-unrealized-pnl]');
    if (unrealizedPnL) {
      const unrealizedValue = unrealizedPnL.querySelector('.font-bold');
      const openPositions = unrealizedPnL.querySelector('.text-xs');
      if (unrealizedValue) {
        unrealizedValue.className = `font-bold ${(bot.unrealizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`;
        unrealizedValue.textContent = `${(bot.unrealizedPnL || 0) >= 0 ? '+' : ''}$${(bot.unrealizedPnL || 0).toFixed(2)}`;
      }
      if (openPositions) {
        openPositions.textContent = `${bot.openPositions || 0} open`;
      }
    }
    
    // Update Current Price
    const currentPrice = botCard.querySelector('[data-current-price]');
    if (currentPrice) {
      const priceValue = currentPrice.querySelector('.font-bold');
      if (priceValue) {
        priceValue.textContent = bot.currentPrice ? '$' + bot.currentPrice.toFixed(4) : '-';
      }
    }
  });
  
  // Update Sidebar Summary
  const exchangeBalance = exchanges.reduce((sum, ex) => sum + parseFloat(ex.totalUSDT || 0), 0);
  const botBalance = bots.reduce((sum, bot) => sum + (bot.currentBalance || bot.startBalance || 0), 0);
  const totalBalance = Math.max(exchangeBalance, botBalance);
  const totalProfitUSDT = bots.reduce((sum, bot) => sum + (bot.profitUSDT || 0), 0);
  const totalInvestment = bots.reduce((sum, bot) => sum + (bot.startBalance || 0), 0);
  const totalProfitPercent = totalInvestment > 0 ? (totalProfitUSDT / totalInvestment) * 100 : 0;
  
  // Update sidebar values
  const sidebarBalance = document.querySelector('[data-sidebar-balance]');
  const sidebarProfit = document.querySelector('[data-sidebar-profit]');
  const sidebarProfitUSD = document.querySelector('[data-sidebar-profit-usd]');
  
  if (sidebarBalance) {
    sidebarBalance.textContent = `$${totalBalance.toFixed(2)}`;
  }
  if (sidebarProfit) {
    sidebarProfit.className = `text-sm ${totalProfitPercent >= 0 ? 'text-green-600' : 'text-red-600'} font-semibold`;
    sidebarProfit.textContent = `${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}%`;
  }
  if (sidebarProfitUSD) {
    sidebarProfitUSD.textContent = `${totalProfitUSDT >= 0 ? '+' : ''}$${totalProfitUSDT.toFixed(2)} P&L`;
  }
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Load trading pairs from selected exchange
async function loadTradingPairs(exchangeId) {
  if (!exchangeId) return;
  
  try {
    const pairSelect = document.getElementById('botPair');
    if (!pairSelect) return;
    
    // Show loading
    pairSelect.innerHTML = '<option value="">กำลังโหลด...</option>';
    pairSelect.disabled = true;
    
    // ใช้ API endpoint ใหม่
    const res = await fetch(API_URL + '/trading-pairs/' + exchangeId);
    const data = await res.json();
    
    if (data.success && data.pairs) {
      const symbols = data.pairs.map(p => p.symbol);
      
      // Popular pairs
      const popularSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'];
      const popular = symbols.filter(s => popularSymbols.includes(s));
      const others = symbols.filter(s => !popularSymbols.includes(s));
      
      let optionsHtml = '<option value="">เลือกคู่เหรียญ...</option>';
      
      if (popular.length > 0) {
        optionsHtml += '<optgroup label="⭐ Popular">';
        popular.forEach(symbol => {
          const base = symbol.replace('USDT', '');
          optionsHtml += `<option value="${symbol}">${base}/USDT</option>`;
        });
        optionsHtml += '</optgroup>';
      }
      
      if (others.length > 0) {
        optionsHtml += '<optgroup label="📊 All Pairs">';
        others.forEach(symbol => {
          const base = symbol.replace('USDT', '');
          optionsHtml += `<option value="${symbol}">${base}/USDT</option>`;
        });
        optionsHtml += '</optgroup>';
      }
      
      pairSelect.innerHTML = optionsHtml;
      pairSelect.disabled = false;
      
      console.log('✅ Loaded', symbols.length, 'trading pairs');
    } else {
      pairSelect.innerHTML = '<option value="">❌ ไม่สามารถโหลดคู่เหรียญได้</option>';
      pairSelect.disabled = false;
    }
  } catch (error) {
    console.error('Error loading trading pairs:', error);
    const pairSelect = document.getElementById('botPair');
    if (pairSelect) {
      pairSelect.innerHTML = '<option value="">❌ เกิดข้อผิดพลาด</option>';
      pairSelect.disabled = false;
    }
  }
}

// Mobile state management
let isMobileMenuOpen = false;

function render() {
  document.getElementById('root').innerHTML = `
    <div class="flex mobile-vh bg-gray-50 relative">
      ${renderSidebar()}
      <div class="flex-1 flex flex-col overflow-hidden">
        ${renderHeader()}
        <main class="flex-1 overflow-auto mobile-scroll p-4 md:p-8">${renderContent()}</main>
      </div>
      ${isMobileMenuOpen ? '<div class="fixed inset-0 bg-black/50 z-40 md:hidden" onclick="toggleMobileMenu()"></div>' : ''}
    </div>
  `;
}

function toggleMobileMenu() {
  isMobileMenuOpen = !isMobileMenuOpen;
  render();
}

function renderSidebar() {
  // คำนวณ Total Balance จาก Exchange + Bot Balance
  const exchangeBalance = exchanges.reduce((sum, ex) => sum + parseFloat(ex.totalUSDT || 0), 0);
  const botBalance = bots.reduce((sum, bot) => sum + (bot.currentBalance || bot.startBalance || 0), 0);
  
  // ใช้ยอดสูงสุดระหว่าง Exchange กับ Bot (เพื่อแสดงยอดจริง)
  const totalBalance = Math.max(exchangeBalance, botBalance);
  
  const totalProfitUSDT = bots.reduce((sum, bot) => sum + (bot.profitUSDT || 0), 0);
  
  const totalInvestment = bots.reduce((sum, bot) => sum + (bot.startBalance || 0), 0);
  const totalProfitPercent = totalInvestment > 0 ? (totalProfitUSDT / totalInvestment) * 100 : 0;
  
  const activeBots = bots.filter(b => b.status === 'active').length;
  
  return `
    <div class="fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:inset-0">
      <div class="p-4 md:p-6 border-b border-gray-200">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-xl flex items-center justify-center text-white text-lg md:text-xl">📊</div>
            <div><h1 class="text-base md:text-lg font-bold text-gray-800">TradingBot</h1><p class="text-xs text-gray-500">Manager</p></div>
          </div>
          <button onclick="toggleMobileMenu()" class="md:hidden p-2 text-gray-500 hover:text-gray-700">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="p-3 md:p-4 bg-gradient-to-br from-teal-50 to-teal-100 border-b border-teal-200">
        <div class="text-xs text-gray-600 mb-1">Total Balance</div>
        <div class="text-xl md:text-2xl font-bold text-gray-800" data-sidebar-balance>$${totalBalance.toFixed(2)}</div>
        <div class="text-sm ${totalProfitPercent >= 0 ? 'text-green-600' : 'text-red-600'} font-semibold" data-sidebar-profit>${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}%</div>
        <div class="text-xs text-gray-500" data-sidebar-profit-usd>${totalProfitUSDT >= 0 ? '+' : ''}$${totalProfitUSDT.toFixed(2)} P&L</div>
      </div>
      <nav class="flex-1 p-3 md:p-4 space-y-1 overflow-y-auto mobile-scroll">
        <button onclick="changePage('dashboard'); isMobileMenuOpen && toggleMobileMenu()" class="${currentPage === 'dashboard' ? 'bg-teal-50 text-teal-600' : 'text-gray-700 hover:bg-gray-100'} w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg text-sm font-medium transition mobile-tap">🏠 Dashboard</button>
        <button onclick="changePage('portfolio'); isMobileMenuOpen && toggleMobileMenu()" class="${currentPage === 'portfolio' ? 'bg-teal-50 text-teal-600' : 'text-gray-700 hover:bg-gray-100'} w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg text-sm font-medium transition mobile-tap">💼 Portfolio</button>
        <button onclick="changePage('bots'); isMobileMenuOpen && toggleMobileMenu()" class="${currentPage === 'bots' ? 'bg-teal-50 text-teal-600' : 'text-gray-700 hover:bg-gray-100'} w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg text-sm font-medium transition mobile-tap">🤖 Bots ${activeBots > 0 ? '<span class="ml-auto bg-teal-500 text-white text-xs px-2 py-0.5 rounded-full">' + activeBots + '</span>' : ''}</button>
        <button onclick="changePage('signals'); isMobileMenuOpen && toggleMobileMenu()" class="${currentPage === 'signals' ? 'bg-teal-50 text-teal-600' : 'text-gray-700 hover:bg-gray-100'} w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg text-sm font-medium transition mobile-tap">📡 Signals ${signals.length > 0 ? '<span class="ml-auto bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">' + signals.length + '</span>' : ''}</button>
        <button onclick="changePage('explorer'); isMobileMenuOpen && toggleMobileMenu()" class="${currentPage === 'explorer' ? 'bg-teal-50 text-teal-600' : 'text-gray-700 hover:bg-gray-100'} w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg text-sm font-medium transition mobile-tap">🔍 Explorer</button>
      </nav>
    </div>
  `;
}

function renderHeader() {
  const showLiveIndicator = (currentPage === 'dashboard' || currentPage === 'bots') && autoRefreshInterval;
  return `
    <header class="bg-white border-b border-gray-200 px-4 md:px-8 py-3 md:py-4 sticky top-0 z-10">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button onclick="toggleMobileMenu()" class="md:hidden p-2 text-gray-500 hover:text-gray-700 mobile-tap">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl md:text-2xl font-bold text-gray-800">${currentPage.charAt(0).toUpperCase() + currentPage.slice(1)}</h2>
              ${showLiveIndicator ? `
                <span class="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  LIVE
                </span>
              ` : ''}
            </div>
            <p class="text-xs md:text-sm text-gray-500 mt-1 hidden sm:block">รับสัญญาณจาก TradingView Webhook</p>
          </div>
        </div>
        <button onclick="showCreateModal()" class="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white px-3 md:px-5 py-2 md:py-2.5 rounded-lg flex items-center gap-1 md:gap-2 font-medium shadow-lg transition text-sm md:text-base mobile-tap">
          <span>+</span> <span class="hidden sm:inline">Start new bot</span><span class="sm:hidden">New</span>
        </button>
      </div>
    </header>
  `;
}

function renderContent() {
  if (loading) return '<div class="flex items-center justify-center h-64"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div></div>';
  if (currentPage === 'dashboard') return renderDashboard();
  if (currentPage === 'portfolio') return renderPortfolio();
  if (currentPage === 'bots') return renderBots();
  if (currentPage === 'signals') return renderSignals();
  if (currentPage === 'explorer') return renderExplorer();
}

function renderDashboard() {
  // คำนวณ Total Balance จาก Exchange + Bot Balance
  const exchangeBalance = exchanges.reduce((sum, ex) => sum + parseFloat(ex.totalUSDT || 0), 0);
  const botBalance = bots.reduce((sum, bot) => sum + (bot.currentBalance || bot.startBalance || 0), 0);
  
  // ใช้ยอดสูงสุดระหว่าง Exchange กับ Bot (เพื่อแสดงยอดจริง)
  const totalBalance = Math.max(exchangeBalance, botBalance);
  
  const totalProfitUSDT = bots.reduce((sum, bot) => sum + (bot.profitUSDT || 0), 0);
  
  // คำนวณ Total Profit เป็นเปอร์เซ็นต์เฉลี่ย
  const totalInvestment = bots.reduce((sum, bot) => sum + (bot.startBalance || 0), 0);
  const totalProfitPercent = totalInvestment > 0 ? (totalProfitUSDT / totalInvestment) * 100 : 0;
  
  const activeBots = bots.filter(b => b.status === 'active').length;
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  
  return `
    <div class="space-y-4 md:space-y-6">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        <div class="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm">
          <div class="text-xs md:text-sm text-gray-600 mb-1 md:mb-2">Total Balance</div>
          <div class="text-lg md:text-3xl font-bold text-gray-800">$${totalBalance.toFixed(2)}</div>
        </div>
        <div class="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm">
          <div class="text-xs md:text-sm text-gray-600 mb-1 md:mb-2">Total Profit</div>
          <div class="text-lg md:text-3xl font-bold ${totalProfitPercent >= 0 ? 'text-green-600' : 'text-red-600'}">${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}%</div>
          <div class="text-xs text-gray-500 mt-1">${totalProfitUSDT >= 0 ? '+' : ''}$${totalProfitUSDT.toFixed(2)} USDT</div>
        </div>
        <div class="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm">
          <div class="text-xs md:text-sm text-gray-600 mb-1 md:mb-2">Active Bots</div>
          <div class="text-lg md:text-3xl font-bold text-teal-600">${activeBots}</div>
        </div>
        <div class="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm">
          <div class="text-xs md:text-sm text-gray-600 mb-1 md:mb-2">Total Trades</div>
          <div class="text-lg md:text-3xl font-bold text-purple-600">${totalTrades}</div>
        </div>
      </div>
      ${renderBots()}
    </div>
  `;
}

function renderPortfolio() {
  if (exchanges.length === 0) {
    return `
      <div class="bg-gradient-to-br from-teal-50 to-blue-50 p-12 md:p-16 rounded-2xl border-2 border-dashed border-teal-300 text-center">
        <div class="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-teal-400 to-blue-500 rounded-full mb-6 shadow-lg">
          <span class="text-4xl">🔗</span>
        </div>
        <h3 class="text-2xl md:text-3xl font-bold text-gray-800 mb-3">Connect Your First Exchange</h3>
        <p class="text-gray-600 mb-8 max-w-md mx-auto">เพิ่ม Exchange API เพื่อเริ่มต้นจัดการ Portfolio และเทรดอัตโนมัติ</p>
        <button onclick="showExchangeModal()" class="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white px-8 py-4 rounded-xl font-semibold shadow-xl hover:shadow-2xl transform hover:scale-105 transition duration-200">
          <span class="flex items-center gap-2">
            <span>⚡</span>
            <span>Connect Exchange Now</span>
          </span>
        </button>
      </div>
    `;
  }
  
  // คำนวณสถิติ
  const totalExchanges = exchanges.length;
  const totalAssets = exchanges.reduce((sum, ex) => {
    const uniqueAssets = new Set((ex.balances || []).map(b => b.asset));
    return sum + uniqueAssets.size;
  }, 0);
  const totalBots = bots.length;
  const totalUSDT = exchanges.reduce((sum, ex) => sum + parseFloat(ex.totalUSDT || 0), 0);
  const totalBTC = exchanges.reduce((sum, ex) => {
    const btcBalance = ex.balances?.find(b => b.asset === 'BTC');
    return sum + (btcBalance ? btcBalance.total : 0);
  }, 0);
  
  // คำนวณ Total P&L จากบอท
  const totalProfitUSDT = bots.reduce((sum, bot) => sum + (bot.profitUSDT || 0), 0);
  const totalInvestment = bots.reduce((sum, bot) => sum + (bot.startBalance || 0), 0);
  const totalProfitPercent = totalInvestment > 0 ? (totalProfitUSDT / totalInvestment) * 100 : 0;
  
  return `
    <div class="space-y-6">
      <!-- Portfolio Overview Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Total Balance Card -->
        <div class="bg-gradient-to-br from-teal-500 to-teal-600 rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <span class="text-2xl">💰</span>
            </div>
            <button onclick="loadData()" class="p-2 hover:bg-white/20 rounded-lg transition mobile-tap">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
            </button>
          </div>
          <div class="text-sm opacity-90 mb-1">Total Balance</div>
          <div class="text-3xl font-bold mb-1">$${totalUSDT.toFixed(2)}</div>
          <div class="text-xs opacity-75">≈ ${totalBTC.toFixed(6)} BTC</div>
        </div>

        <!-- Total Profit Card -->
        <div class="bg-gradient-to-br ${totalProfitPercent >= 0 ? 'from-green-500 to-green-600' : 'from-red-500 to-red-600'} rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
          <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm mb-4">
            <span class="text-2xl">${totalProfitPercent >= 0 ? '📈' : '📉'}</span>
          </div>
          <div class="text-sm opacity-90 mb-1">Total P&L</div>
          <div class="text-3xl font-bold mb-1">${totalProfitPercent >= 0 ? '+' : ''}${totalProfitPercent.toFixed(2)}%</div>
          <div class="text-xs opacity-75">${totalProfitUSDT >= 0 ? '+' : ''}$${totalProfitUSDT.toFixed(2)} USDT</div>
        </div>

        <!-- Exchanges Card -->
        <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
          <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm mb-4">
            <span class="text-2xl">🏦</span>
          </div>
          <div class="text-sm opacity-90 mb-1">Exchanges</div>
          <div class="text-3xl font-bold mb-1">${totalExchanges}</div>
          <div class="text-xs opacity-75">${totalAssets} Assets</div>
        </div>

        <!-- Trading Bots Card -->
        <div class="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
          <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm mb-4">
            <span class="text-2xl">🤖</span>
          </div>
          <div class="text-sm opacity-90 mb-1">Trading Bots</div>
          <div class="text-3xl font-bold mb-1">${totalBots}</div>
          <div class="text-xs opacity-75">${bots.filter(b => b.status === 'active').length} Active</div>
        </div>
      </div>
      
      <!-- Exchange List Section -->
      <div>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span>💼</span>
            <span>Your Exchanges</span>
            <span class="px-2 py-1 bg-teal-100 text-teal-700 text-xs font-semibold rounded-full">${totalExchanges}</span>
          </h3>
          <button onclick="showExchangeModal()" class="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white px-4 py-2 rounded-xl font-medium shadow-md hover:shadow-lg transition transform hover:scale-105 mobile-tap text-sm">
            <span class="flex items-center gap-2">
              <span>+</span>
              <span>Add Exchange</span>
            </span>
          </button>
        </div>
        <div class="grid gap-4">
          ${exchanges.map(ex => renderExchangeCard(ex)).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderExchangeCard(ex) {
  // คำนวณ total และ percentage ของแต่ละเหรียญ
  const totalValue = parseFloat(ex.totalUSDT || 0);
  const balancesWithPercentage = (ex.balances || []).map(b => {
    const value = b.total * (b.usdPrice || 1); // ถ้ามีราคา USD
    const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;
    return { ...b, value, percentage };
  }).sort((a, b) => b.value - a.value);
  
  // สร้าง gradient color สำหรับ exchange
  const gradients = {
    'H': 'from-purple-500 to-pink-500',
    'shift': 'from-blue-500 to-cyan-500',
    'default': 'from-yellow-400 to-orange-500'
  };
  const gradient = gradients[ex.name] || gradients['default'];
  
  return `
    <div class="bg-white rounded-2xl border-2 border-gray-100 shadow-lg hover:shadow-2xl hover:border-teal-200 transition-all duration-300 overflow-hidden">
      <!-- Header with Gradient -->
      <div class="bg-gradient-to-br ${gradient} p-6 text-white relative overflow-hidden">
        <div class="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
        <div class="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full -ml-12 -mb-12"></div>
        
        <div class="relative flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center text-2xl shadow-lg">
              ${ex.type === 'Binance' ? '⚡' : '⭐'}
            </div>
            <div>
              <h3 class="font-bold text-xl">${ex.name}</h3>
              <div class="text-sm opacity-90 flex items-center gap-2">
                <span>${ex.type}</span>
                <span>•</span>
                <span>${ex.testnet ? 'Testnet USDT-M' : 'Futures'}</span>
              </div>
            </div>
          </div>
          <button onclick="refreshExchange(${ex.id})" class="p-3 hover:bg-white/20 rounded-xl transition mobile-tap backdrop-blur-sm">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
        </div>
        
        <div class="relative">
          <div class="text-sm opacity-90 mb-1">Total Balance</div>
          <div class="text-4xl font-bold mb-2">$${totalValue.toFixed(2)}</div>
          ${totalValue < 10 ? `
            <div class="flex items-center gap-2 px-3 py-2 bg-white/20 backdrop-blur-sm rounded-lg">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
              <span class="text-xs">Low balance - Deposit to trade</span>
            </div>
          ` : ''}
        </div>
      </div>
      
      <!-- Asset Balances -->
      <div class="p-6">
        ${balancesWithPercentage.length === 0 ? `
          <div class="text-center py-8 text-gray-400">
            <div class="text-4xl mb-2">💼</div>
            <div class="text-sm">No assets found</div>
          </div>
        ` : `
          <div class="mb-6">
            <div class="text-sm font-semibold text-gray-600 mb-3">Asset Distribution</div>
            <div class="space-y-3">
              ${balancesWithPercentage.slice(0, 5).map(b => {
                const colors = {
                  'USDT': { bg: 'bg-teal-500', text: 'text-teal-600', light: 'bg-teal-50' },
                  'BTC': { bg: 'bg-orange-500', text: 'text-orange-600', light: 'bg-orange-50' },
                  'ETH': { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-50' },
                  'BNB': { bg: 'bg-yellow-500', text: 'text-yellow-600', light: 'bg-yellow-50' },
                  'USDC': { bg: 'bg-cyan-500', text: 'text-cyan-600', light: 'bg-cyan-50' }
                };
                const color = colors[b.asset] || { bg: 'bg-purple-500', text: 'text-purple-600', light: 'bg-purple-50' };
                
                return `
                  <div class="${color.light} rounded-xl p-3 hover:shadow-md transition">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <div class="w-8 h-8 ${color.bg} rounded-lg flex items-center justify-center text-white text-xs font-bold">
                          ${b.asset.substring(0, 2)}
                        </div>
                        <div>
                          <div class="font-semibold text-sm ${color.text}">${b.asset}</div>
                          <div class="text-xs text-gray-500">${b.wallet}</div>
                        </div>
                      </div>
                      <div class="text-right">
                        <div class="font-bold text-sm text-gray-800">${b.total.toFixed(4)}</div>
                        <div class="text-xs ${color.text} font-semibold">${b.percentage.toFixed(1)}%</div>
                      </div>
                    </div>
                    <div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div class="${color.bg} h-full rounded-full transition-all duration-500" style="width: ${b.percentage}%"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `}
        
        <!-- Action Buttons -->
        <div class="grid grid-cols-2 gap-3">
          <button onclick="refreshExchange(${ex.id})" class="flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white rounded-xl font-medium text-sm transition transform hover:scale-105 shadow-md hover:shadow-lg mobile-tap">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            <span>Refresh</span>
          </button>
          <button onclick="deleteExchange(${ex.id})" class="flex items-center justify-center gap-2 py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-medium text-sm transition transform hover:scale-105 border-2 border-red-200 mobile-tap">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
            <span>Remove</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function showDepositModal(exchangeId) {
  const exchange = exchanges.find(ex => ex.id === exchangeId);
  if (!exchange) return;
  
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl">
      <div class="p-6 border-b">
        <h2 class="text-xl font-bold">Deposit to ${exchange.name}</h2>
      </div>
      <div class="p-6 text-center">
        <div class="text-6xl mb-4">💰</div>
        <h3 class="text-lg font-bold text-gray-800 mb-2">Deposit Funds</h3>
        <p class="text-gray-600 mb-4">เติมเงินผ่าน Exchange โดยตรง</p>
        <p class="text-sm text-gray-500">ระบบจะดึงข้อมูลอัตโนมัติเมื่อมียอดเพิ่ม</p>
      </div>
      <div class="p-6 border-t flex gap-3">
        <button onclick="document.getElementById('modal').remove()" 
          class="flex-1 bg-gray-100 px-4 py-3 rounded-lg hover:bg-gray-200 mobile-tap">
          Close
        </button>
        <button onclick="refreshExchange(${exchangeId}); document.getElementById('modal').remove()" 
          class="flex-1 bg-teal-500 text-white px-4 py-3 rounded-lg hover:bg-teal-600 mobile-tap">
          Refresh Balance
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function renderBots() {
  return '<div class="space-y-3 md:space-y-4">' + (
    bots.length === 0 
      ? '<div class="bg-white p-8 md:p-12 rounded-xl border border-gray-200 text-center"><div class="text-4xl md:text-6xl mb-4">🤖</div><h3 class="text-lg md:text-xl font-bold text-gray-800 mb-2">ยังไม่มีบอท</h3><p class="text-sm md:text-base text-gray-600">สร้างบอทเพื่อเริ่มเทรดอัตโนมัติ</p></div>'
      : bots.map(bot => `
      <div class="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition p-4 md:p-6" data-bot-id="${bot.id}">
        <div class="flex flex-col sm:flex-row sm:items-start justify-between mb-4 gap-4">
          <div class="flex items-center gap-3 md:gap-4">
            <div class="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center text-white text-xl md:text-2xl">🤖</div>
            <div>
              <h3 class="font-bold text-base md:text-lg text-gray-800">${bot.name}</h3>
              <div class="text-xs md:text-sm text-gray-500">${bot.pair} • ${bot.exchange}</div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 text-xs md:text-sm">
            <button onclick="toggleBot(${bot.id})" class="px-3 py-2 rounded-lg font-medium mobile-tap ${bot.status === 'active' ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}">${bot.status === 'active' ? '⏸️ Pause' : '▶️ Start'}</button>
            ${bot.openPositions > 0 ? `<button onclick="closePosition(${bot.id})" class="px-3 py-2 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 font-medium mobile-tap">🔴 Close</button>` : ''}
            <button onclick="openEditBotModal(${bot.id})" class="px-3 py-2 bg-orange-100 text-orange-600 rounded-lg hover:bg-orange-200 font-medium mobile-tap">✏️ Edit</button>
            <button onclick="openManualTradeModal(${bot.id})" class="px-3 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 font-medium mobile-tap">📈 Trade</button>
            <button onclick="openWebhookModal(${bot.id})" class="px-3 py-2 bg-purple-100 text-purple-600 rounded-lg hover:bg-purple-200 mobile-tap">🔗 Hook</button>
            <button onclick="openBotEventsModal(${bot.id})" class="px-3 py-2 bg-teal-100 text-teal-600 rounded-lg hover:bg-teal-200 mobile-tap">📋 Events</button>
            <button onclick="deleteBot(${bot.id})" class="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 mobile-tap">🗑️</button>
          </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-3 md:gap-4 text-xs md:text-sm">
          <div data-total-pnl>
            <div class="text-gray-500 mb-1">Total P&L</div>
            <div class="font-bold ${bot.profit >= 0 ? 'text-green-600' : 'text-red-600'}">${bot.profit >= 0 ? '+' : ''}${bot.profit.toFixed(2)}%</div>
            <div class="text-xs text-gray-400">${(bot.profitUSDT || 0) >= 0 ? '+' : ''}$${(bot.profitUSDT || 0).toFixed(2)}</div>
          </div>
          <div data-realized-pnl>
            <div class="text-gray-500 mb-1">Realized</div>
            <div class="font-bold ${(bot.realizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}">${(bot.realizedPnL || 0) >= 0 ? '+' : ''}$${(bot.realizedPnL || 0).toFixed(2)}</div>
            <div class="text-xs text-gray-400">Closed</div>
          </div>
          <div data-unrealized-pnl>
            <div class="text-gray-500 mb-1">Unrealized</div>
            <div class="font-bold ${(bot.unrealizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}">${(bot.unrealizedPnL || 0) >= 0 ? '+' : ''}$${(bot.unrealizedPnL || 0).toFixed(2)}</div>
            <div class="text-xs text-gray-400">${bot.openPositions || 0} open</div>
          </div>
          <div data-current-price>
            <div class="text-gray-500 mb-1">Current Price</div>
            <div class="font-bold text-gray-800">${bot.currentPrice ? '$' + bot.currentPrice.toFixed(4) : '-'}</div>
            <div class="text-xs text-gray-400">Live</div>
          </div>
          <div><div class="text-gray-500 mb-1">Position</div><div class="font-bold ${bot.position === 'long' ? 'text-green-600' : bot.position === 'short' ? 'text-red-600' : 'text-gray-600'}">${bot.position === 'none' ? 'NONE' : bot.position.toUpperCase()}</div></div>
          <div><div class="text-gray-500 mb-1">Mode</div><div class="font-bold text-teal-600">AUTO</div></div>
        </div>
      </div>
    `).join('')
  ) + '</div>';
}

function renderSignals() {
  return `
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
      <!-- Mobile Card View -->
      <div class="md:hidden">
        ${signals.length === 0 ? 
          '<div class="p-8 text-center text-gray-500">ยังไม่มีสัญญาณ</div>' :
          signals.map(signal => {
            const bot = bots.find(b => b.id === signal.botId);
            return `
              <div class="p-4 border-b border-gray-200 last:border-b-0">
                <div class="flex items-center justify-between mb-2">
                  <div class="font-medium text-gray-800">${bot?.name || 'Unknown'}</div>
                  <span class="px-2 py-1 rounded-full text-xs font-bold ${signal.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${signal.type}</span>
                </div>
                <div class="text-xs text-gray-500 mb-2">${bot?.pair || '-'}</div>
                <div class="flex items-center justify-between text-sm">
                  <div class="text-gray-600">${new Date(signal.time).toLocaleString('th-TH')}</div>
                  <div class="font-mono text-gray-800">$${signal.price.toLocaleString()}</div>
                </div>
                <div class="mt-2">
                  <span class="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">${signal.status}</span>
                </div>
              </div>
            `;
          }).join('')
        }
      </div>
      
      <!-- Desktop Table View -->
      <div class="hidden md:block overflow-x-auto mobile-scroll">
        <table class="w-full">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="text-left py-4 px-6 text-sm font-semibold text-gray-700">เวลา</th>
              <th class="text-left py-4 px-6 text-sm font-semibold text-gray-700">บอท</th>
              <th class="text-left py-4 px-6 text-sm font-semibold text-gray-700">คำสั่ง</th>
              <th class="text-right py-4 px-6 text-sm font-semibold text-gray-700">ราคา</th>
              <th class="text-center py-4 px-6 text-sm font-semibold text-gray-700">สถานะ</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            ${signals.length === 0 ? '<tr><td colspan="5" class="py-12 text-center text-gray-500">ยังไม่มีสัญญาณ</td></tr>' :
              signals.map(signal => {
                const bot = bots.find(b => b.id === signal.botId);
                return `
                  <tr class="hover:bg-gray-50">
                    <td class="py-4 px-6 text-sm text-gray-800">${new Date(signal.time).toLocaleString('th-TH')}</td>
                    <td class="py-4 px-6"><div class="font-medium text-gray-800">${bot?.name || 'Unknown'}</div><div class="text-xs text-gray-500">${bot?.pair || '-'}</div></td>
                    <td class="py-4 px-6"><span class="px-3 py-1 rounded-full text-xs font-bold ${signal.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${signal.type}</span></td>
                    <td class="py-4 px-6 text-right font-mono text-sm text-gray-800">$${signal.price.toLocaleString()}</td>
                    <td class="py-4 px-6 text-center"><span class="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">${signal.status}</span></td>
                  </tr>
                `;
              }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Load market data from Binance
async function loadMarketData() {
  try {
    const response = await fetch(`${API_URL}/market/trending`);
    const data = await response.json();
    if (data.success) {
      marketData = data.markets || [];
    }
  } catch (error) {
    console.error('Error loading market data:', error);
  }
}

function renderExplorer() {
  // เรียงตาม volume หรือ change
  const sortedMarkets = [...marketData].sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume));
  const topGainers = [...marketData].filter(m => parseFloat(m.priceChangePercent) > 0).sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)).slice(0, 10);
  const topLosers = [...marketData].filter(m => parseFloat(m.priceChangePercent) < 0).sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent)).slice(0, 10);
  
  return `
    <div class="space-y-6">
      <!-- Header with Refresh -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <span>🔥</span>
            <span>Market Explorer</span>
          </h2>
          <p class="text-sm text-gray-500 mt-1">Discover trending cryptocurrencies with high volume</p>
        </div>
        <button onclick="loadMarketData(); render()" class="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white px-4 py-2 rounded-xl font-medium shadow-md hover:shadow-lg transition transform hover:scale-105 mobile-tap text-sm">
          <span class="flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            <span>Refresh</span>
          </span>
        </button>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-lg">
          <div class="text-sm opacity-90 mb-1">Top Gainer</div>
          <div class="text-2xl font-bold mb-1">${topGainers[0]?.symbol.replace('USDT', '') || '-'}</div>
          <div class="text-lg font-semibold">${topGainers[0] ? '+' + parseFloat(topGainers[0].priceChangePercent).toFixed(2) + '%' : '-'}</div>
        </div>
        
        <div class="bg-gradient-to-br from-red-500 to-red-600 rounded-2xl p-6 text-white shadow-lg">
          <div class="text-sm opacity-90 mb-1">Top Loser</div>
          <div class="text-2xl font-bold mb-1">${topLosers[0]?.symbol.replace('USDT', '') || '-'}</div>
          <div class="text-lg font-semibold">${topLosers[0] ? parseFloat(topLosers[0].priceChangePercent).toFixed(2) + '%' : '-'}</div>
        </div>
        
        <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg">
          <div class="text-sm opacity-90 mb-1">Total Pairs</div>
          <div class="text-3xl font-bold">${marketData.length}</div>
        </div>
        
        <div class="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
          <div class="text-sm opacity-90 mb-1">High Volume</div>
          <div class="text-2xl font-bold mb-1">${sortedMarkets[0]?.symbol.replace('USDT', '') || '-'}</div>
          <div class="text-xs opacity-75">${sortedMarkets[0] ? '$' + (parseFloat(sortedMarkets[0].volume) / 1000000).toFixed(1) + 'M' : '-'}</div>
        </div>
      </div>

      <!-- Market Table -->
      <div class="bg-white rounded-2xl border-2 border-gray-100 shadow-lg overflow-hidden">
        <div class="p-4 bg-gradient-to-r from-teal-50 to-blue-50 border-b-2 border-gray-100">
          <h3 class="font-bold text-lg text-gray-800">🚀 Trending Markets</h3>
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-gray-50 border-b border-gray-200">
              <tr>
                <th class="text-left py-4 px-6 text-sm font-semibold text-gray-700">#</th>
                <th class="text-left py-4 px-6 text-sm font-semibold text-gray-700">Symbol</th>
                <th class="text-right py-4 px-6 text-sm font-semibold text-gray-700">Price</th>
                <th class="text-right py-4 px-6 text-sm font-semibold text-gray-700">24h Change</th>
                <th class="text-right py-4 px-6 text-sm font-semibold text-gray-700">24h Volume</th>
                <th class="text-center py-4 px-6 text-sm font-semibold text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              ${marketData.length === 0 ? 
                '<tr><td colspan="6" class="py-12 text-center text-gray-500"><div class="text-4xl mb-2">📊</div><div>Loading market data...</div></td></tr>' :
                sortedMarkets.slice(0, 50).map((market, index) => {
                  const change = parseFloat(market.priceChangePercent);
                  const changeColor = change >= 0 ? 'text-green-600' : 'text-red-600';
                  const changeBg = change >= 0 ? 'bg-green-50' : 'bg-red-50';
                  const volume = (parseFloat(market.volume) / 1000000).toFixed(2);
                  
                  return `
                    <tr class="hover:bg-teal-50 transition">
                      <td class="py-4 px-6 text-sm font-semibold text-gray-500">${index + 1}</td>
                      <td class="py-4 px-6">
                        <div class="flex items-center gap-2">
                          <div class="w-8 h-8 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                            ${market.symbol.substring(0, 2)}
                          </div>
                          <div>
                            <div class="font-bold text-gray-800">${market.symbol.replace('USDT', '')}</div>
                            <div class="text-xs text-gray-500">USDT</div>
                          </div>
                        </div>
                      </td>
                      <td class="py-4 px-6 text-right">
                        <div class="font-mono font-semibold text-gray-800">$${parseFloat(market.lastPrice).toFixed(4)}</div>
                      </td>
                      <td class="py-4 px-6 text-right">
                        <div class="inline-flex px-3 py-1 rounded-full ${changeBg}">
                          <span class="font-bold ${changeColor}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>
                        </div>
                      </td>
                      <td class="py-4 px-6 text-right">
                        <div class="font-semibold text-gray-700">$${volume}M</div>
                      </td>
                      <td class="py-4 px-6 text-center">
                        <button onclick="alert('Create bot for ${market.symbol}')" class="px-4 py-2 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white rounded-lg text-sm font-medium transition transform hover:scale-105">
                          Trade
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function changePage(page) { 
  currentPage = page; 
  
  // โหลดข้อมูลเพิ่มเติมตาม page
  if (page === 'explorer' && marketData.length === 0) {
    loadMarketData().then(() => render());
  } else {
    render();
  }
  
  // Restart auto-refresh when changing page
  if (page === 'dashboard' || page === 'bots') {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

// Toggle Functions for Bot Configuration
function toggleDirection(dir) {
  window.botConfig.direction = dir;
  // ตอนนี้มีปุ่มเดียว ไม่ต้อง toggle
  console.log('Bot direction set to:', dir);
}

function toggleBotType(type) {
  window.botConfig.botType = type;
  document.querySelectorAll('.bottype-btn').forEach(btn => {
    btn.classList.remove('bg-teal-500', 'text-white', 'border-teal-500');
    btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
  });
  const selectedBtn = document.getElementById(type === 'single' ? 'typeSingle' : 'typeMulti');
  selectedBtn.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
  selectedBtn.classList.add('bg-teal-500', 'text-white', 'border-teal-500');
}

function toggleOrderType(type) {
  window.botConfig.orderType = type;
  document.querySelectorAll('.ordertype-btn').forEach(btn => {
    btn.classList.remove('bg-teal-500', 'text-white', 'border-teal-500');
    btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
  });
  const selectedBtn = document.getElementById(type === 'market' ? 'orderMarket' : 'orderLimit');
  selectedBtn.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
  selectedBtn.classList.add('bg-teal-500', 'text-white', 'border-teal-500');
}

function toggleEntryOrderType(type) {
  window.botConfig.entryOrderType = type;
  document.querySelectorAll('.entryorder-btn').forEach(btn => {
    btn.classList.remove('bg-teal-500', 'text-white', 'border-teal-500');
    btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
  });
  const btnIds = {
    'market': 'entryMarket',
    'limit': 'entryLimit',
    'stop_market': 'entryStopMarket',
    'stop_limit': 'entryStopLimit'
  };
  const selectedBtn = document.getElementById(btnIds[type]);
  if (selectedBtn) {
    selectedBtn.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
    selectedBtn.classList.add('bg-teal-500', 'text-white', 'border-teal-500');
  }
}

function toggleLeverageType(type) {
  window.botConfig.leverageType = type;
  document.querySelectorAll('.leverage-btn').forEach(btn => {
    btn.classList.remove('bg-teal-500', 'text-white', 'border-teal-500');
    btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
  });
  const selectedBtn = document.getElementById(type === 'cross' ? 'levCross' : 'levIsolated');
  selectedBtn.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
  selectedBtn.classList.add('bg-teal-500', 'text-white', 'border-teal-500');
}

function changeLeverage(delta) {
  const input = document.getElementById('leverageValue');
  const slider = document.getElementById('leverageSlider');
  let value = parseInt(input.value) + delta;
  value = Math.max(1, Math.min(125, value));
  input.value = value;
  slider.value = value;
  window.botConfig.leverageValue = value;
}

function toggleOrderSizeType(type) {
  window.botConfig.orderSizeType = type;
  document.querySelectorAll('.ordersize-btn').forEach(btn => {
    btn.classList.remove('bg-teal-500', 'text-white', 'border-teal-500');
    btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
  });
  const selectedBtn = document.getElementById(type === 'usdt' ? 'sizeUSDT' : 'sizePercent');
  if (selectedBtn) {
    selectedBtn.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
    selectedBtn.classList.add('bg-teal-500', 'text-white', 'border-teal-500');
  }
  
  // อัพเดท placeholder และ label
  const input = document.getElementById('baseOrderSize');
  const unit = document.getElementById('orderSizeUnit');
  if (type === 'percent') {
    input.placeholder = '100';
    input.max = '100';
    input.value = '100';
    unit.innerHTML = '<span class="text-teal-600">📊</span><span class="text-sm font-medium">%</span>';
  } else {
    input.placeholder = '10';
    input.max = '';
    input.value = '10';
    unit.innerHTML = '<span class="text-teal-600">💵</span><span class="text-sm font-medium">USDT</span>';
  }
}

// Advanced Create Bot Modal
function showCreateModal() {
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-start md:items-center justify-center z-50 p-0 md:p-4 overflow-y-auto mobile-scroll';
  modal.innerHTML = `
    <div class="bg-white rounded-none md:rounded-2xl w-full max-w-4xl shadow-2xl min-h-screen md:min-h-0 md:my-8 md:max-h-[95vh] flex flex-col">
      <div class="p-4 md:p-6 border-b bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-none md:rounded-t-2xl flex-shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg md:text-2xl font-bold">Create DCA Bot</h2>
            <p class="text-xs md:text-sm text-teal-100 mt-1">Configure your automated trading bot</p>
          </div>
          <button onclick="document.getElementById('modal').remove()" class="md:hidden p-2 text-white hover:text-teal-200 mobile-tap">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="p-3 md:p-6 space-y-4 md:space-y-6 overflow-y-auto mobile-scroll flex-1">
        
        <!-- Main Section -->
        <div class="bg-gray-50 rounded-xl p-3 md:p-5 border border-gray-200">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
            <h3 class="font-semibold text-base md:text-lg text-gray-800">📋 Main</h3>
            <a href="#" class="text-xs md:text-sm text-teal-600 hover:underline">Video tutorial</a>
          </div>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Name</label>
              <input type="text" id="botName" placeholder="ETHUSDT/USDT Super power" 
                class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-teal-500 focus:border-transparent">
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Exchange</label>
              <select id="botExchange" onchange="loadTradingPairs(this.value)" class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-teal-500">
                ${exchanges.length === 0 ? '<option value="">⚠️ กรุณาเชื่อมต่อ Exchange ก่อน</option>' :
                  '<option value="">เลือก Exchange...</option>' +
                  exchanges.map(ex => `<option value="${ex.id}">⭐ ${ex.name} | $${ex.totalUSDT}</option>`).join('')
                }
              </select>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Signal Processing</label>
              <button type="button" onclick="toggleDirection('both')" id="dirBoth" 
                class="direction-btn w-full px-3 md:px-4 py-3 border-2 border-teal-500 bg-teal-500 text-white rounded-lg font-medium transition hover:bg-teal-600 text-sm md:text-base mobile-tap">
                🔄 Auto Trading (รับสัญญาณทั้ง Long & Short)
              </button>
              <div class="mt-3 p-3 bg-blue-50 rounded-lg">
                <div class="flex items-start gap-2">
                  <span class="text-base md:text-lg">ℹ️</span>
                  <div class="text-xs md:text-sm text-blue-800">
                    <div class="font-semibold mb-1">บอทจะทำงานอย่างไร:</div>
                    <div>• รับสัญญาณ <strong>BUY/LONG</strong> → เปิด Long position</div>
                    <div>• รับสัญญาณ <strong>SELL/SHORT</strong> → เปิด Short position</div>
                    <div>• รับสัญญาณ <strong>CLOSE</strong> → ปิด position ปัจจุบัน</div>
                    <div class="mt-2 text-teal-700 font-semibold">✨ บอท 1 ตัวเทรดได้ครบทุกทิศทาง!</div>
                  </div>
                </div>
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Bot type</label>
              <div class="grid grid-cols-2 gap-3">
                <button type="button" onclick="toggleBotType('single')" id="typeSingle" 
                  class="bottype-btn px-3 md:px-4 py-3 border-2 border-teal-500 bg-teal-500 text-white rounded-lg font-medium transition hover:bg-teal-600 text-sm md:text-base mobile-tap">
                  Single-pair
                </button>
                <button type="button" onclick="toggleBotType('multi')" id="typeMulti" 
                  class="bottype-btn px-3 md:px-4 py-3 border-2 border-gray-300 bg-white text-gray-700 rounded-lg font-medium transition hover:border-gray-400 text-sm md:text-base mobile-tap">
                  Multi-pair
                </button>
              </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Pair</label>
                <select id="botPair" class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-teal-500">
                  <option value="">กรุณาเลือก Exchange ก่อน</option>
                </select>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Profit currency</label>
                <input type="text" value="Quote (USDT)" readonly 
                  class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 bg-gray-50 text-gray-600">
              </div>
            </div>
          </div>
          
          <div class="mt-4">
            <button type="button" class="text-sm text-teal-600 hover:text-teal-700 flex items-center gap-2">
              🔍 <span class="underline">Market data insight</span>
            </button>
          </div>
        </div>
        
        <!-- Entry Orders Section -->
        <div class="bg-gray-50 rounded-xl p-3 md:p-5 border border-gray-200">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
            <h3 class="font-semibold text-base md:text-lg text-gray-800">📊 Entry orders</h3>
            <a href="#" class="text-xs md:text-sm text-teal-600 hover:underline">Video tutorial</a>
          </div>
          
          <div class="bg-blue-50 border-l-4 border-blue-500 p-3 md:p-4 mb-4">
            <div class="text-sm font-medium text-blue-900">Base order</div>
          </div>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Base order size</label>
              <div class="grid grid-cols-2 gap-2 mb-2">
                <button type="button" onclick="toggleOrderSizeType('usdt')" id="sizeUSDT" 
                  class="ordersize-btn px-3 py-2 border-2 border-teal-500 bg-teal-500 text-white rounded-lg font-medium transition mobile-tap text-xs md:text-sm">
                  💵 USDT
                </button>
                <button type="button" onclick="toggleOrderSizeType('percent')" id="sizePercent" 
                  class="ordersize-btn px-3 py-2 border-2 border-gray-300 bg-white text-gray-700 rounded-lg font-medium transition mobile-tap text-xs md:text-sm">
                  📊 Percent (%)
                </button>
              </div>
              <div class="flex items-center gap-2">
                <input type="number" id="baseOrderSize" value="10" step="0.01" min="5" placeholder="10"
                  class="flex-1 px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-teal-500"
                  oninput="window.botConfig.orderSizeValue = parseFloat(this.value)">
                <div id="orderSizeUnit" class="flex items-center gap-2 px-3 py-3 bg-white border border-gray-300 rounded-lg">
                  <span class="text-teal-600">💵</span>
                  <span class="text-sm font-medium">USDT</span>
                </div>
              </div>
              <p class="text-xs text-gray-500 mt-1">
                <strong>USDT:</strong> จำนวนคงที่ | <strong>Percent:</strong> % ของเงินทุนทั้งหมด
              </p>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Entry order type</label>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" onclick="toggleEntryOrderType('market')" id="entryMarket" 
                  class="entryorder-btn px-2 md:px-3 py-2.5 border-2 border-teal-500 bg-teal-500 text-white rounded-lg font-medium transition mobile-tap text-xs md:text-sm">
                  🚀 Market
                </button>
                <button type="button" onclick="toggleEntryOrderType('limit')" id="entryLimit" 
                  class="entryorder-btn px-2 md:px-3 py-2.5 border-2 border-gray-300 bg-white text-gray-700 rounded-lg font-medium transition mobile-tap text-xs md:text-sm">
                  📌 Limit
                </button>
                <button type="button" onclick="toggleEntryOrderType('stop_market')" id="entryStopMarket" 
                  class="entryorder-btn px-2 md:px-3 py-2.5 border-2 border-gray-300 bg-white text-gray-700 rounded-lg font-medium transition mobile-tap text-xs md:text-sm">
                  🛑 Stop Market
                </button>
                <button type="button" onclick="toggleEntryOrderType('stop_limit')" id="entryStopLimit" 
                  class="entryorder-btn px-2 md:px-3 py-2.5 border-2 border-gray-300 bg-white text-gray-700 rounded-lg font-medium transition mobile-tap text-xs md:text-sm">
                  ⚠️ Stop Limit
                </button>
              </div>
              <div class="mt-2 p-2 bg-blue-50 rounded-lg text-xs text-blue-700">
                <strong>Market:</strong> ซื้อ/ขายทันทีที่ราคาตลาด | 
                <strong>Limit:</strong> ตั้งราคาที่ต้องการ | 
                <strong>Stop:</strong> ใช้เมื่อราคาถึงจุดที่กำหนด
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Leverage type</label>
              <div class="grid grid-cols-2 gap-3">
                <button type="button" onclick="toggleLeverageType('cross')" id="levCross" 
                  class="leverage-btn px-3 md:px-4 py-3 border-2 border-teal-500 bg-teal-500 text-white rounded-lg font-medium transition mobile-tap text-sm md:text-base">
                  Cross
                </button>
                <button type="button" onclick="toggleLeverageType('isolated')" id="levIsolated" 
                  class="leverage-btn px-3 md:px-4 py-3 border-2 border-gray-300 bg-white text-gray-700 rounded-lg font-medium transition mobile-tap text-sm md:text-base">
                  Isolated
                </button>
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Leverage value</label>
              <div class="flex items-center gap-2">
                <input type="number" id="leverageValue" value="1" min="1" max="125" 
                  class="flex-1 px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-teal-500"
                  oninput="document.getElementById('leverageSlider').value = this.value; window.botConfig.leverageValue = parseInt(this.value)">
                <button type="button" onclick="changeLeverage(-1)" 
                  class="w-10 h-10 bg-teal-500 text-white rounded-lg font-bold hover:bg-teal-600 transition mobile-tap">−</button>
                <button type="button" onclick="changeLeverage(1)" 
                  class="w-10 h-10 bg-teal-500 text-white rounded-lg font-bold hover:bg-teal-600 transition mobile-tap">+</button>
              </div>
              <input type="range" id="leverageSlider" min="1" max="125" value="1" 
                class="w-full mt-2" oninput="document.getElementById('leverageValue').value = this.value; window.botConfig.leverageValue = parseInt(this.value)">
            </div>
            
            <!-- Stop Loss Section -->
            <div class="border-t pt-4">
              <div class="flex items-center gap-2 mb-3">
                <input type="checkbox" id="stopLossEnabled" class="w-4 h-4 text-red-600 rounded" 
                  onchange="document.getElementById('stopLossValue').disabled = !this.checked; window.botConfig.stopLossEnabled = this.checked">
                <label for="stopLossEnabled" class="text-sm font-medium text-gray-700">🛡️ Enable Stop Loss</label>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Stop Loss (%)</label>
                <div class="flex items-center gap-2">
                  <input type="number" id="stopLossValue" value="2" min="0.1" max="100" step="0.1" disabled
                    class="flex-1 px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-red-500 disabled:bg-gray-100"
                    oninput="window.botConfig.stopLoss = parseFloat(this.value)">
                  <div class="flex items-center gap-2 px-3 py-3 bg-white border border-gray-300 rounded-lg">
                    <span class="text-red-600">📉</span>
                    <span class="text-sm font-medium">%</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-2">
                  ตั้งค่าเปอร์เซ็นต์การขาดทุนสูงสุดที่ยอมรับได้ ระบบจะปิด Position อัตโนมัติเมื่อขาดทุนถึงระดับที่กำหนด
                </p>
              </div>
            </div>
            
            <div>
              <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                <div class="flex items-center gap-2">
                  <input type="checkbox" id="tradeCondition" class="w-4 h-4 text-teal-600 rounded">
                  <label for="tradeCondition" class="text-sm font-medium text-gray-700">📈 Trade start condition</label>
                </div>
                <span class="text-xs md:text-sm text-gray-500">For example: RSI, QFL, MACD, TradingView custom signals, etc.</span>
              </div>
            </div>
          </div>
        </div>
        
      </div>
      <div class="p-3 md:p-6 border-t bg-gray-50 rounded-none md:rounded-b-2xl flex gap-3 flex-shrink-0 sticky bottom-0 md:static">
        <button onclick="document.getElementById('modal').remove()" 
          class="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-4 md:px-6 py-3 md:py-3 rounded-lg font-medium hover:bg-gray-50 transition text-sm md:text-base mobile-tap">
          Cancel
        </button>
        <button onclick="createBot()" 
          class="flex-1 bg-gradient-to-r from-teal-500 to-teal-600 text-white px-4 md:px-6 py-3 md:py-3 rounded-lg font-medium hover:from-teal-600 hover:to-teal-700 transition shadow-lg text-sm md:text-base mobile-tap">
          Create Bot
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Initialize default states
  window.botConfig = {
    direction: 'both',
    botType: 'single',
    orderType: 'market',
    leverageType: 'cross',
    leverageValue: 1,
    stopLoss: 2,
    stopLossEnabled: false
  };
}

async function createBot() {
  const name = document.getElementById('botName').value;
  const exchangeId = document.getElementById('botExchange').value;
  const pair = document.getElementById('botPair').value;
  const baseOrderSize = parseFloat(document.getElementById('baseOrderSize').value);
  const tradeCondition = document.getElementById('tradeCondition').checked;
  const stopLossEnabled = document.getElementById('stopLossEnabled').checked;
  const stopLoss = parseFloat(document.getElementById('stopLossValue').value);
  const orderSizeType = window.botConfig.orderSizeType;
  
  if (!name) return alert('กรุณาใส่ชื่อบอท');
  if (!exchangeId) return alert('กรุณาเลือก Exchange');
  if (!pair) return alert('กรุณาเลือกคู่เหรียญ');
  
  // Validate order size based on type
  if (orderSizeType === 'percent') {
    if (!baseOrderSize || baseOrderSize <= 0 || baseOrderSize > 100) {
      return alert('กรุณาระบุ % ระหว่าง 0.1% - 100%');
    }
  } else {
    if (!baseOrderSize || baseOrderSize < 5) {
      return alert('Base order size ต้องมากกว่า 5 USDT');
    }
  }
  
  if (stopLossEnabled && (!stopLoss || stopLoss <= 0 || stopLoss > 100)) {
    return alert('กรุณาตั้งค่า Stop Loss ระหว่าง 0.1% - 100%');
  }
  
  const exchange = exchanges.find(ex => ex.id == exchangeId);
  
  const data = { 
    name, 
    exchange: exchange?.name || 'Binance',
    pair: pair + '/USDT',
    investment: baseOrderSize,
    orderSizeType: orderSizeType,
    orderSizeValue: baseOrderSize,
    direction: window.botConfig.direction,
    botType: window.botConfig.botType,
    orderType: window.botConfig.orderType,
    entryOrderType: window.botConfig.entryOrderType,
    leverageType: window.botConfig.leverageType,
    leverageValue: window.botConfig.leverageValue,
    tradeCondition: tradeCondition,
    stopLoss: stopLoss,
    stopLossEnabled: stopLossEnabled
  };
  
  try {
    const res = await fetch(API_URL + '/bots', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(data) 
    });
    
    if (res.ok) { 
      document.getElementById('modal').remove(); 
      await loadData();
      alert('✅ สร้างบอทสำเร็จ!' + (stopLossEnabled ? ` (Stop Loss: ${stopLoss}%)` : ''));
    } else {
      const error = await res.json();
      alert('❌ Error: ' + (error.message || 'Failed to create bot'));
    }
  } catch (error) {
    console.error('Error creating bot:', error);
    alert('❌ Error: ' + error.message);
  }
}

async function toggleBot(botId) {
  const bot = bots.find(b => b.id === botId);
  const newStatus = bot.status === 'active' ? 'paused' : 'active';
  await fetch(API_URL + '/bots/' + botId + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
  loadData();
}

async function deleteBot(botId) {
  if (!confirm('ต้องการลบบอทนี้?')) return;
  await fetch(API_URL + '/bots/' + botId, { method: 'DELETE' });
  loadData();
}

function openWebhookModal(botId) {
  const bot = bots.find(b => b.id === botId);
  
  // ตรวจสอบว่าบอทมี token หรือไม่ (สำหรับบอทเก่าที่ยังไม่มี token)
  if (!bot.token) {
    const modal = document.createElement('div');
    modal.id = 'modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div class="p-6 border-b bg-gradient-to-r from-red-500 to-red-600 text-white rounded-t-2xl">
          <h2 class="text-xl font-bold">⚠️ บอทเวอร์ชันเก่า</h2>
        </div>
        <div class="p-6 text-center">
          <div class="text-6xl mb-4">🔄</div>
          <h3 class="text-lg font-bold text-gray-800 mb-2">บอทเวอร์ชันเก่า</h3>
          <p class="text-gray-600 mb-6">บอทนี้สร้างก่อนมีระบบ Token<br>เลือกวิธีการแก้ไข:</p>
          <div class="space-y-3">
            <button onclick="regenerateToken(${bot.id})" 
              class="w-full bg-teal-500 text-white px-4 py-3 rounded-lg hover:bg-teal-600 transition">
              🔑 สร้าง Token ใหม่ (แนะนำ)
            </button>
            <button onclick="deleteBot(${bot.id}); document.getElementById('modal').remove()" 
              class="w-full bg-red-500 text-white px-4 py-3 rounded-lg hover:bg-red-600 transition">
              🗑️ ลบบอทแล้วสร้างใหม่
            </button>
            <button onclick="document.getElementById('modal').remove()" 
              class="w-full bg-gray-100 px-4 py-3 rounded-lg hover:bg-gray-200 transition">
              ปิด
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return;
  }
  
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
      <div class="p-4 md:p-6 border-b bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-t-2xl flex-shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xl md:text-2xl font-bold">🔗 Webhook Configuration</h2>
            <p class="text-sm text-purple-100 mt-1">${bot.name} • ${bot.pair}</p>
          </div>
          <button onclick="document.getElementById('modal').remove()" class="p-2 text-white hover:text-purple-200 mobile-tap">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="p-4 md:p-6 space-y-6 overflow-y-auto flex-1">
        
        <!-- Webhook URL Section -->
        <div>
          <label class="block text-sm font-semibold text-teal-600 mb-2">🌐 Webhook URL</label>
          <div class="flex gap-2">
            <input type="text" value="${bot.webhookUrl}" readonly 
              class="flex-1 px-3 md:px-4 py-2 md:py-3 bg-gray-50 border rounded-lg font-mono text-xs md:text-sm">
            <button onclick="navigator.clipboard.writeText('${bot.webhookUrl}'); alert('คัดลอก URL แล้ว!')" 
              class="px-3 md:px-4 py-2 md:py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition mobile-tap">📋</button>
          </div>
        </div>

        <!-- Bot Token Section -->
        <div>
          <label class="block text-sm font-semibold text-orange-600 mb-2">🔑 Bot Token (สำคัญ!)</label>
          <div class="flex gap-2">
            <input type="text" value="${bot.token}" readonly 
              class="flex-1 px-3 md:px-4 py-2 md:py-3 bg-orange-50 border border-orange-200 rounded-lg font-mono text-sm font-bold text-orange-800">
            <button onclick="navigator.clipboard.writeText('${bot.token}'); alert('คัดลอก Token แล้ว!')" 
              class="px-3 md:px-4 py-2 md:py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition mobile-tap">📋</button>
          </div>
          <p class="text-xs text-orange-600 mt-1">⚠️ Token นี้ใช้สำหรับยืนยันตัวตน ห้ามแชร์ให้ใคร</p>
        </div>

        <!-- JSON Format Section -->
        <div>
          <label class="block text-sm font-semibold text-purple-600 mb-2">📝 JSON Message Format</label>
          <div class="bg-gray-900 text-green-400 rounded-lg p-4 text-xs md:text-sm overflow-x-auto">
            <pre>{
  "action": "{{strategy.order.action}}",
  "pair": "{{ticker}}",
  "price": "{{close}}",
  "token": "${bot.token}"
}</pre>
          </div>
          <button onclick="navigator.clipboard.writeText('{\n  \"action\": \"{{strategy.order.action}}\",\n  \"pair\": \"{{ticker}}\",\n  \"price\": \"{{close}}\",\n  \"token\": \"${bot.token}\"\n}'); alert('คัดลอก JSON แล้ว!')" 
            class="mt-2 px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition text-sm mobile-tap">📋 Copy JSON</button>
          
          <!-- Signal Examples -->
          <div class="mt-4 p-3 bg-blue-50 rounded-lg">
            <h4 class="text-sm font-semibold text-blue-800 mb-2">📋 ตัวอย่างสัญญาณที่รองรับ:</h4>
            <div class="text-xs text-blue-700 space-y-1">
              <div><strong>Long:</strong> "BUY", "LONG", "buy", "long"</div>
              <div><strong>Short:</strong> "SELL", "SHORT", "sell", "short"</div>
              <div><strong>Close:</strong> "CLOSE", "close" (ปิด position)</div>
            </div>
          </div>
        </div>

        <!-- Instructions Section -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div class="flex items-start gap-3">
            <span class="text-2xl">📚</span>
            <div>
              <h3 class="font-bold text-blue-900 mb-2">วิธีตั้งค่า TradingView Alert:</h3>
              <ol class="list-decimal list-inside text-sm text-blue-800 space-y-1">
                <li>เปิด Chart ใน TradingView</li>
                <li>คลิกขวาที่ Strategy → Create Alert</li>
                <li>เลือก "Webhook URL" ในส่วน Notifications</li>
                <li>วาง <strong>Webhook URL</strong> ด้านบน</li>
                <li>วาง <strong>JSON Message</strong> ในช่อง Message</li>
                <li>ตรวจสอบ Token ให้ถูกต้อง</li>
                <li>กด "Create" เพื่อสร้าง Alert</li>
              </ol>
            </div>
          </div>
        </div>

        <!-- Security Warning -->
        <div class="bg-red-50 border border-red-200 rounded-lg p-4">
          <div class="flex items-start gap-3">
            <span class="text-2xl">🔒</span>
            <div>
              <h3 class="font-bold text-red-900 mb-2">ข้อควรระวัง:</h3>
              <ul class="text-sm text-red-800 space-y-1">
                <li>• <strong>Token</strong> เป็นรหัสลับ ห้ามแชร์ให้ใครฟัง</li>
                <li>• ใช้ Token นี้เฉพาะใน TradingView Alert เท่านั้น</li>
                <li>• หาก Token หลุด ให้ลบบอทแล้วสร้างใหม่</li>
                <li>• ตรวจสอบ JSON Format ให้ถูกต้องก่อนสร้าง Alert</li>
              </ul>
            </div>
          </div>
        </div>

      </div>
      <div class="p-4 md:p-6 border-t bg-gray-50 rounded-b-2xl flex justify-end flex-shrink-0">
        <button onclick="document.getElementById('modal').remove()" 
          class="bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-lg font-medium transition mobile-tap">
          ปิด
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function showExchangeModal() {
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl">
      <div class="p-4 md:p-6 border-b"><h2 class="text-xl md:text-2xl font-bold">เชื่อมต่อ Exchange</h2></div>
      <div class="p-4 md:p-6 space-y-4">
        <input type="text" id="exName" placeholder="ชื่อ (เช่น My Binance)" class="w-full px-3 md:px-4 py-2 md:py-3 text-sm md:text-base rounded-lg border">
        <input type="text" id="exApiKey" placeholder="API Key" class="w-full px-3 md:px-4 py-2 md:py-3 text-sm md:text-base rounded-lg border">
        <input type="password" id="exApiSecret" placeholder="API Secret" class="w-full px-3 md:px-4 py-2 md:py-3 text-sm md:text-base rounded-lg border">
        <label class="flex items-center gap-2"><input type="checkbox" id="exTestnet" class="w-4 h-4 text-teal-600 rounded"><span class="text-sm">Testnet</span></label>
      </div>
      <div class="p-4 md:p-6 border-t flex gap-3">
        <button onclick="document.getElementById('modal').remove()" class="flex-1 bg-gray-100 px-3 md:px-4 py-2 md:py-3 text-sm md:text-base rounded-lg mobile-tap">ยกเลิก</button>
        <button onclick="connectExchange()" class="flex-1 bg-teal-500 text-white px-3 md:px-4 py-2 md:py-3 text-sm md:text-base rounded-lg mobile-tap">เชื่อมต่อ</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function connectExchange() {
  const name = document.getElementById('exName').value;
  const apiKey = document.getElementById('exApiKey').value;
  const apiSecret = document.getElementById('exApiSecret').value;
  const testnet = document.getElementById('exTestnet').checked;
  if (!name || !apiKey || !apiSecret) return alert('กรุณากรอกข้อมูลให้ครบ');
  const res = await fetch(API_URL + '/exchanges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, apiKey, apiSecret, testnet }) });
  const data = await res.json();
  if (data.success) { document.getElementById('modal').remove(); loadData(); alert('✅ เชื่อมต่อสำเร็จ!'); } else { alert('❌ ' + data.message); }
}

async function refreshExchange(exchangeId) {
  const res = await fetch(API_URL + '/exchanges/' + exchangeId + '/refresh', { method: 'POST' });
  const data = await res.json();
  if (data.success) { loadData(); alert('✅ อัพเดทสำเร็จ!'); } else { alert('❌ ' + data.message); }
}

async function deleteExchange(exchangeId) {
  if (!confirm('ต้องการลบ Exchange นี้?')) return;
  await fetch(API_URL + '/exchanges/' + exchangeId, { method: 'DELETE' });
  loadData();
}

async function regenerateToken(botId) {
  try {
    const res = await fetch(API_URL + '/bots/' + botId + '/regenerate-token', { method: 'PATCH' });
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('modal').remove();
      await loadData();
      alert('✅ สร้าง Token ใหม่สำเร็จ!\nตอนนี้สามารถใช้งาน Webhook ได้แล้ว');
    } else {
      alert('❌ ' + data.message);
    }
  } catch (error) {
    console.error('Error regenerating token:', error);
    alert('❌ เกิดข้อผิดพลาดในการสร้าง Token');
  }
}

loadData();

// ================== MANUAL TRADE FEATURE ==================
function openManualTradeModal(botId) {
  const bot = bots.find(b => b.id === botId);
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-start md:items-center justify-center z-50 p-0 md:p-4 overflow-y-auto mobile-scroll';
  modal.innerHTML = `
    <div class="bg-white rounded-none md:rounded-2xl w-full max-w-md shadow-2xl min-h-screen md:min-h-0 md:my-8 flex flex-col">
      <div class="p-4 md:p-6 border-b bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-none md:rounded-t-2xl flex-shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg md:text-2xl font-bold">📈 Manual Trade</h2>
            <p class="text-xs md:text-sm text-blue-100 mt-1">${bot.name} • ${bot.pair}</p>
          </div>
          <button onclick="document.getElementById('modal').remove()" class="md:hidden p-2 text-white hover:text-blue-200 mobile-tap">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="p-6 space-y-4">
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="text-sm text-gray-600 mb-2">Bot Status</div>
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${bot.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}"></span>
            <span class="font-medium">${bot.status === 'active' ? '🟢 Active' : '⚫ Paused'}</span>
          </div>
        </div>
        
        <div class="bg-blue-50 rounded-lg p-4">
          <div class="text-sm text-blue-600 mb-2">Current Position</div>
          <div class="font-bold text-lg">${bot.position.toUpperCase()}</div>
        </div>
        
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="bg-gray-50 rounded-lg p-3">
            <div class="text-xs text-gray-600 mb-1">Trading Mode</div>
            <div class="font-medium text-sm">AUTO</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-3">
            <div class="text-xs text-gray-600 mb-1">Leverage</div>
            <div class="font-medium text-sm">${bot.leverageValue || 1}x</div>
          </div>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-3">Select Action</label>
          <div class="grid grid-cols-2 gap-3">
            <button onclick="executeTrade(${bot.id}, 'buy')" 
              class="px-6 py-4 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold text-lg transition shadow-lg hover:shadow-xl">
              🟢 BUY
            </button>
            <button onclick="executeTrade(${bot.id}, 'sell')" 
              class="px-6 py-4 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold text-lg transition shadow-lg hover:shadow-xl">
              🔴 SELL
            </button>
          </div>
        </div>
        
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          <div class="flex items-start gap-2">
            <span class="text-lg">⚠️</span>
            <div>
              <div class="font-medium">คำเตือน</div>
              <div class="text-xs mt-1">คำสั่งจะถูกส่งไปยัง Exchange ทันที และไม่สามารถยกเลิกได้</div>
            </div>
          </div>
        </div>
      </div>
      <div class="p-4 md:p-6 border-t flex gap-3 flex-shrink-0 sticky bottom-0 md:static bg-white">
        <button onclick="document.getElementById('modal').remove()" 
          class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 md:px-6 py-3 rounded-lg font-medium transition text-sm md:text-base mobile-tap">
          Cancel
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Close Position at Market Price
async function closePosition(botId) {
  const bot = bots.find(b => b.id === botId);
  
  if (!bot) {
    alert('❌ ไม่พบบอท');
    return;
  }
  
  if (!bot.token) {
    alert('❌ บอทนี้ไม่มี Token\nกรุณาลบแล้วสร้างบอทใหม่');
    return;
  }
  
  if (!bot.openPositions || bot.openPositions === 0) {
    alert('⚠️ ไม่มี Position ที่เปิดอยู่');
    return;
  }
  
  // แสดง confirmation modal
  const currentPrice = bot.currentPrice ? `$${bot.currentPrice.toFixed(4)}` : 'Market';
  const unrealizedPnL = bot.unrealizedPnL || 0;
  const pnlText = unrealizedPnL >= 0 ? `+$${unrealizedPnL.toFixed(2)}` : `-$${Math.abs(unrealizedPnL).toFixed(2)}`;
  const pnlColor = unrealizedPnL >= 0 ? 'green' : 'red';
  
  const confirmed = confirm(
    `🔴 ปิด Position ที่ราคาตลาด?\n\n` +
    `Bot: ${bot.name}\n` +
    `Pair: ${bot.pair}\n` +
    `Position: ${bot.position.toUpperCase()}\n` +
    `Current Price: ${currentPrice}\n` +
    `Unrealized P&L: ${pnlText}\n\n` +
    `⚠️ จะปิด position ทันทีด้วยราคาตลาด (Market Order)`
  );
  
  if (!confirmed) return;
  
  try {
    // แสดง loading
    const modal = document.createElement('div');
    modal.id = 'closeModal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-12 text-center">
        <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-yellow-500 mx-auto mb-4"></div>
        <div class="text-xl font-bold text-gray-800 mb-2">กำลังปิด Position...</div>
        <div class="text-sm text-gray-600">CLOSE ${bot.position.toUpperCase()} @ Market Price</div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // ส่งคำสั่ง CLOSE ไปยัง webhook
    const response = await fetch(`${API_URL}/webhook/${botId}?token=${bot.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'close',
        pair: bot.pair.split('/')[0],
        price: 'market',
        time: new Date().toISOString(),
        token: bot.token
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // ปิด loading modal
      modal.remove();
      
      // รีโหลดข้อมูล
      await loadData();
      
      // แสดงผลสำเร็จ
      const successModal = document.createElement('div');
      successModal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
      successModal.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
          <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-5xl">✅</span>
          </div>
          <h2 class="text-2xl font-bold text-gray-800 mb-2">Position ปิดสำเร็จ!</h2>
          <div class="text-gray-600 mb-6">
            <div class="mb-2"><span class="font-medium">Bot:</span> ${bot.name}</div>
            <div class="mb-2"><span class="font-medium">Closed:</span> ${bot.position.toUpperCase()}</div>
            <div class="mb-2"><span class="font-medium">Price:</span> $${result.price ? result.price.toFixed(4) : 'Market'}</div>
            <div class="mb-2"><span class="font-medium">Order ID:</span> ${result.orderId || 'N/A'}</div>
          </div>
          <button onclick="this.closest('.fixed').remove()" 
            class="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-lg font-medium transition">
            OK
          </button>
        </div>
      `;
      document.body.appendChild(successModal);
      
      // ปิดอัตโนมัติหลัง 5 วินาที
      setTimeout(() => successModal.remove(), 5000);
      
    } else {
      throw new Error(result.message || 'Failed to close position');
    }
  } catch (error) {
    console.error('Close position error:', error);
    
    // แสดง error
    const errorModal = document.createElement('div');
    errorModal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    errorModal.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
        <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-5xl">❌</span>
        </div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">เกิดข้อผิดพลาด</h2>
        <div class="text-gray-600 mb-6">
          ${error.message || 'ไม่สามารถปิด position ได้'}
        </div>
        <button onclick="this.closest('.fixed').remove()" 
          class="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-lg font-medium transition">
          Close
        </button>
      </div>
    `;
    
    // ปิด loading modal
    const modal = document.getElementById('closeModal');
    if (modal) modal.remove();
    
    document.body.appendChild(errorModal);
  }
}

async function executeTrade(botId, action) {
  const bot = bots.find(b => b.id === botId);
  
  if (!bot) {
    alert('❌ ไม่พบบอท');
    return;
  }
  
  if (!bot.token) {
    alert('❌ บอทนี้ไม่มี Token\nกรุณาลบแล้วสร้างบอทใหม่');
    return;
  }
  
  const actionText = action.toUpperCase();
  const confirmed = confirm(`🔔 ยืนยันการ ${actionText}\n\nBot: ${bot.name}\nPair: ${bot.pair}\nLeverage: ${bot.leverageValue || 1}x\n\n⚠️ คำสั่งจะถูกส่งไปยัง Binance ทันที`);
  
  if (!confirmed) return;
  
  try {
    // แสดง loading
    const modal = document.getElementById('modal');
    if (modal) {
      modal.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-12 text-center">
          <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500 mx-auto mb-4"></div>
          <div class="text-xl font-bold text-gray-800 mb-2">กำลังส่งคำสั่ง...</div>
          <div class="text-sm text-gray-600">${actionText} ${bot.pair}</div>
        </div>
      `;
    }
    
    // ส่งคำสั่งไปยัง webhook พร้อม token
    const response = await fetch(`${API_URL}/webhook/${botId}?token=${bot.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: action,
        pair: bot.pair.split('/')[0],
        price: 'market',
        time: new Date().toISOString(),
        token: bot.token
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // ปิด modal
      if (modal) modal.remove();
      
      // รีโหลดข้อมูล
      await loadData();
      
      // แสดงผลสำเร็จแบบสวยงาม
      const successModal = document.createElement('div');
      successModal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
      successModal.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
          <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-5xl">✅</span>
          </div>
          <h2 class="text-2xl font-bold text-gray-800 mb-2">Order สำเร็จ!</h2>
          <div class="text-gray-600 mb-6">
            <div class="mb-2"><span class="font-medium">Action:</span> ${actionText}</div>
            <div class="mb-2"><span class="font-medium">Pair:</span> ${bot.pair}</div>
            <div class="mb-2"><span class="font-medium">Order ID:</span> ${result.orderId || 'N/A'}</div>
            <div class="mb-2"><span class="font-medium">Quantity:</span> ${result.qty || 'N/A'}</div>
            <div><span class="font-medium">Price:</span> $${result.price ? result.price.toFixed(2) : 'N/A'}</div>
          </div>
          <button onclick="this.closest('.fixed').remove()" 
            class="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-lg font-medium transition">
            OK
          </button>
        </div>
      `;
      document.body.appendChild(successModal);
      
      // ปิดอัตโนมัติหลัง 5 วินาที
      setTimeout(() => successModal.remove(), 5000);
      
    } else {
      throw new Error(result.message || 'Trade failed');
    }
  } catch (error) {
    console.error('Trade error:', error);
    
    // แสดง error แบบสวยงาม
    const errorModal = document.createElement('div');
    errorModal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    errorModal.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
        <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-5xl">❌</span>
        </div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">เกิดข้อผิดพลาด</h2>
        <div class="text-gray-600 mb-6">
          ${error.message || 'ไม่สามารถส่งคำสั่งได้'}
        </div>
        <button onclick="this.closest('.fixed').remove()" 
          class="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-lg font-medium transition">
          Close
        </button>
      </div>
    `;
    
    // ปิด loading modal
    const modal = document.getElementById('modal');
    if (modal) modal.remove();
    
    document.body.appendChild(errorModal);
  }
}

// ================== EDIT BOT FEATURE ==================
function openEditBotModal(botId) {
  const bot = bots.find(b => b.id === botId);
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-start md:items-center justify-center z-50 p-0 md:p-4 overflow-y-auto mobile-scroll';
  modal.innerHTML = `
    <div class="bg-white rounded-none md:rounded-2xl w-full max-w-2xl shadow-2xl min-h-screen md:min-h-0 md:my-8 md:max-h-[95vh] flex flex-col">
      <div class="p-4 md:p-6 border-b bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-none md:rounded-t-2xl flex-shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg md:text-2xl font-bold">✏️ Edit Bot</h2>
            <p class="text-xs md:text-sm text-orange-100 mt-1">${bot.name} • ${bot.pair}</p>
          </div>
          <button onclick="document.getElementById('modal').remove()" class="md:hidden p-2 text-white hover:text-orange-200 mobile-tap">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="p-3 md:p-6 space-y-4 md:space-y-6 flex-1 overflow-y-auto mobile-scroll">
        
        <!-- Main Settings Section -->
        <div class="bg-gray-50 rounded-xl p-3 md:p-5 border border-gray-200">
          <h3 class="font-semibold text-base md:text-lg text-gray-800 mb-4">📋 Bot Settings</h3>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Bot Name</label>
              <input type="text" id="editBotName" value="${bot.name}" 
                class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500">
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Leverage</label>
                <input type="number" id="editLeverage" value="${bot.leverageValue || 1}" min="1" max="125"
                  class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500">
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Leverage Type</label>
                <select id="editLeverageType" class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500">
                  <option value="cross" ${bot.leverageType === 'cross' ? 'selected' : ''}>Cross</option>
                  <option value="isolated" ${bot.leverageType === 'isolated' ? 'selected' : ''}>Isolated</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Order Settings Section -->
        <div class="bg-gray-50 rounded-xl p-3 md:p-5 border border-gray-200">
          <h3 class="font-semibold text-base md:text-lg text-gray-800 mb-4">📊 Order Settings</h3>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Base Order Size</label>
              <select id="editOrderSizeType" class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500 mb-2">
                <option value="usdt" ${bot.orderSizeType === 'usdt' || !bot.orderSizeType ? 'selected' : ''}>💵 USDT (จำนวนคงที่)</option>
                <option value="percent" ${bot.orderSizeType === 'percent' ? 'selected' : ''}>📊 Percent (% ของเงินทุน)</option>
              </select>
              <input type="number" id="editInvestment" value="${bot.orderSizeValue || bot.startBalance}" step="0.01" min="0.1"
                class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500">
              <p class="text-xs text-gray-500 mt-1">
                ระบุเป็น USDT หรือ % ของเงินทุนทั้งหมด
              </p>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Entry Order Type</label>
              <select id="editEntryOrderType" class="w-full px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500">
                <option value="market" ${bot.entryOrderType === 'market' || !bot.entryOrderType ? 'selected' : ''}>🚀 Market - ซื้อ/ขายทันที</option>
                <option value="limit" ${bot.entryOrderType === 'limit' ? 'selected' : ''}>📌 Limit - ตั้งราคา</option>
                <option value="stop_market" ${bot.entryOrderType === 'stop_market' ? 'selected' : ''}>🛑 Stop Market - หยุดที่ราคา</option>
                <option value="stop_limit" ${bot.entryOrderType === 'stop_limit' ? 'selected' : ''}>⚠️ Stop Limit - หยุดแบบตั้งราคา</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">เลือกประเภท order ที่จะใช้เมื่อเปิด position</p>
            </div>
          </div>
        </div>
        
        <!-- Stop Loss Section -->
        <div class="bg-gray-50 rounded-xl p-3 md:p-5 border border-gray-200">
          <h3 class="font-semibold text-base md:text-lg text-gray-800 mb-4">🛡️ Risk Management</h3>
          
          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <input type="checkbox" id="editStopLossEnabled" ${bot.stopLossEnabled ? 'checked' : ''} class="w-4 h-4 text-red-600 rounded" 
                onchange="document.getElementById('editStopLossValue').disabled = !this.checked">
              <label for="editStopLossEnabled" class="text-sm font-medium text-gray-700">Enable Stop Loss</label>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Stop Loss (%)</label>
              <div class="flex items-center gap-2">
                <input type="number" id="editStopLossValue" value="${bot.stopLoss || 2}" min="0.1" max="100" step="0.1" ${bot.stopLossEnabled ? '' : 'disabled'}
                  class="flex-1 px-3 md:px-4 py-3 text-sm md:text-base rounded-lg border border-gray-300 focus:ring-2 focus:ring-red-500 disabled:bg-gray-100">
                <div class="flex items-center gap-2 px-3 py-3 bg-white border border-gray-300 rounded-lg">
                  <span class="text-red-600">📉</span>
                  <span class="text-sm font-medium">%</span>
                </div>
              </div>
              <p class="text-xs text-gray-500 mt-2">
                ตั้งค่าเปอร์เซ็นต์การขาดทุนสูงสุดที่ยอมรับได้
              </p>
            </div>
          </div>
        </div>
        
        <!-- Current Settings Info -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 md:p-4">
          <div class="flex items-start gap-2">
            <span class="text-xl">ℹ️</span>
            <div class="text-xs md:text-sm text-blue-900">
              <div class="font-medium mb-1">Current Settings:</div>
              <div class="grid grid-cols-2 gap-2">
                <div>• Pair: ${bot.pair}</div>
                <div>• Exchange: ${bot.exchange}</div>
                <div>• Status: ${bot.status}</div>
                <div>• Mode: Auto (Long & Short)</div>
              </div>
            </div>
          </div>
        </div>
        
      </div>
      <div class="p-3 md:p-6 border-t bg-gray-50 rounded-none md:rounded-b-2xl flex gap-3 flex-shrink-0 sticky bottom-0 md:static">
        <button onclick="document.getElementById('modal').remove()" 
          class="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-4 md:px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition text-sm md:text-base mobile-tap">
          Cancel
        </button>
        <button onclick="saveEditBot(${bot.id})" 
          class="flex-1 bg-gradient-to-r from-orange-500 to-orange-600 text-white px-4 md:px-6 py-3 rounded-lg font-medium hover:from-orange-600 hover:to-orange-700 transition shadow-lg text-sm md:text-base mobile-tap">
          Save Changes
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ================== BOT EVENTS FEATURE ==================
async function openBotEventsModal(botId) {
  const bot = bots.find(b => b.id === botId);
  
  if (!bot) {
    alert('❌ ไม่พบบอท');
    return;
  }
  
  // แสดง loading modal
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
      <div class="p-4 md:p-6 border-b bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-t-2xl flex-shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg md:text-2xl font-bold">📋 Bot Events</h2>
            <p class="text-xs md:text-sm text-teal-100 mt-1">${bot.name} • ${bot.pair}</p>
          </div>
          <button onclick="document.getElementById('modal').remove()" class="p-2 text-white hover:text-teal-200 mobile-tap">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="p-4 md:p-6 flex-1 overflow-y-auto">
        <div class="flex items-center justify-center h-64">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  try {
    // ดึง events ของบอทนี้จาก API
    const response = await fetch(`${API_URL}/bots/${botId}/events`);
    const data = await response.json();
    
    if (data.success) {
      const botEvents = data.events || [];
      
      // อัพเดต modal content
      const contentHtml = `
        <div class="bg-white rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
          <div class="p-4 md:p-6 border-b bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-t-2xl flex-shrink-0">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-lg md:text-2xl font-bold">📋 Bot Events</h2>
                <p class="text-xs md:text-sm text-teal-100 mt-1">${bot.name} • ${bot.pair}</p>
              </div>
              <button onclick="document.getElementById('modal').remove()" class="p-2 text-white hover:text-teal-200 mobile-tap">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="p-4 md:p-6 flex-1 overflow-y-auto">
            ${botEvents.length === 0 ? `
              <div class="text-center py-12">
                <div class="text-6xl mb-4">📋</div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">ยังไม่มี Event</h3>
                <p class="text-gray-600">เมื่อบอททำงาน จะมีการบันทึก Events ที่นี่</p>
              </div>
            ` : `
              <div class="space-y-3">
                ${botEvents.map((event, index) => {
                  const eventTypeColors = {
                    'order': 'bg-blue-100 border-blue-300 text-blue-700',
                    'trade': 'bg-green-100 border-green-300 text-green-700',
                    'error': 'bg-red-100 border-red-300 text-red-700',
                    'info': 'bg-gray-100 border-gray-300 text-gray-700',
                    'position': 'bg-purple-100 border-purple-300 text-purple-700'
                  };
                  const colorClass = eventTypeColors[event.type] || 'bg-gray-100 border-gray-300 text-gray-700';
                  
                  return `
                    <div class="border rounded-lg p-4 ${colorClass}">
                      <div class="flex items-start justify-between mb-2">
                        <span class="px-3 py-1 rounded-full text-xs font-bold bg-white/50">${event.type?.toUpperCase() || 'INFO'}</span>
                        <span class="text-xs">${new Date(event.timestamp || event.time).toLocaleString('th-TH')}</span>
                      </div>
                      <div class="text-sm font-medium mb-1">${event.message}</div>
                      ${event.price ? `<div class="text-xs">ราคา: $${parseFloat(event.price).toLocaleString()}</div>` : ''}
                      ${event.quantity ? `<div class="text-xs">ปริมาณ: ${event.quantity}</div>` : ''}
                      ${event.orderId ? `<div class="text-xs font-mono">Order ID: ${event.orderId}</div>` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
          <div class="p-4 md:p-6 border-t bg-gray-50 rounded-b-2xl flex justify-end gap-3 flex-shrink-0">
            <button onclick="document.getElementById('modal').remove()" 
              class="bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-lg font-medium transition mobile-tap">
              ปิด
            </button>
          </div>
        </div>
      `;
      
      modal.innerHTML = contentHtml;
    } else {
      throw new Error(data.message || 'Failed to load events');
    }
  } catch (error) {
    console.error('Error loading bot events:', error);
    
    // แสดง error modal
    modal.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8 text-center">
        <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-5xl">❌</span>
        </div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">เกิดข้อผิดพลาด</h2>
        <div class="text-gray-600 mb-6">
          ${error.message || 'ไม่สามารถโหลด Events ได้'}
        </div>
        <button onclick="document.getElementById('modal').remove()" 
          class="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-lg font-medium transition">
          Close
        </button>
      </div>
    `;
  }
}

async function saveEditBot(botId) {
  const bot = bots.find(b => b.id === botId);
  if (!bot) return alert('Bot not found');
  
  const newName = document.getElementById('editBotName').value;
  const newLeverage = parseInt(document.getElementById('editLeverage').value);
  const newLeverageType = document.getElementById('editLeverageType').value;
  const newInvestment = parseFloat(document.getElementById('editInvestment').value);
  const newOrderSizeType = document.getElementById('editOrderSizeType').value;
  const newEntryOrderType = document.getElementById('editEntryOrderType').value;
  const stopLossEnabled = document.getElementById('editStopLossEnabled').checked;
  const stopLoss = parseFloat(document.getElementById('editStopLossValue').value);
  
  if (!newName) return alert('กรุณาใส่ชื่อบอท');
  if (newLeverage < 1 || newLeverage > 125) return alert('Leverage ต้องอยู่ระหว่าง 1-125');
  
  // Validate based on order size type
  if (newOrderSizeType === 'percent') {
    if (newInvestment <= 0 || newInvestment > 100) {
      return alert('กรุณาระบุ % ระหว่าง 0.1% - 100%');
    }
  } else {
    if (newInvestment < 5) {
      return alert('Base order size ต้องมากกว่า 5 USDT');
    }
  }
  
  if (stopLossEnabled && (!stopLoss || stopLoss <= 0 || stopLoss > 100)) {
    return alert('กรุณาตั้งค่า Stop Loss ระหว่าง 0.1% - 100%');
  }
  
  try {
    const res = await fetch(API_URL + '/bots/' + botId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        leverageValue: newLeverage,
        leverageType: newLeverageType,
        startBalance: newInvestment,
        orderSizeType: newOrderSizeType,
        orderSizeValue: newInvestment,
        entryOrderType: newEntryOrderType,
        stopLoss: stopLoss,
        stopLossEnabled: stopLossEnabled
      })
    });
    
    const data = await res.json();
    if (data.success) {
      document.getElementById('modal').remove();
      await loadData();
      alert('✅ บันทึกการแก้ไขเรียบร้อย!' + (stopLossEnabled ? ` (Stop Loss: ${stopLoss}%)` : ''));
    } else {
      alert('❌ ' + data.message);
    }
  } catch (error) {
    console.error('Error updating bot:', error);
    alert('❌ เกิดข้อผิดพลาดในการบันทึก');
  }
}

