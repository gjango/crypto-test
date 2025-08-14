#!/usr/bin/env node

const axios = require('axios');
const WebSocket = require('ws');

const BASE_URL = 'http://localhost:3000/api';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

// Helper function to log with colors
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test 1: Check if server is running
async function testServerHealth() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  TEST 1: Server Health Check', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');
  
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    log('✅ Server is healthy', 'green');
    log(`   Status: ${response.data.status}`, 'green');
    log(`   Database: ${response.data.services.database.status}`, 'green');
    log(`   Uptime: ${Math.floor(response.data.uptime)}s`, 'green');
    return true;
  } catch (error) {
    log('❌ Server health check failed', 'red');
    log(`   Error: ${error.message}`, 'red');
    return false;
  }
}

// Test 2: Fetch Binance live prices
async function testBinancePrices() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  TEST 2: Binance Live Price Feed', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');
  
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT'];
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price');
    
    log('📊 Current Crypto Prices from Binance:', 'yellow');
    log('─────────────────────────────────────', 'yellow');
    
    const prices = response.data.filter(ticker => symbols.includes(ticker.symbol));
    
    prices.forEach(ticker => {
      const symbol = ticker.symbol.replace('USDT', '/USDT');
      const price = parseFloat(ticker.price);
      const formattedPrice = price > 100 ? price.toFixed(2) : price.toFixed(4);
      log(`   ${symbol.padEnd(10)} $${formattedPrice}`, 'green');
    });
    
    return true;
  } catch (error) {
    log('❌ Failed to fetch Binance prices', 'red');
    log(`   Error: ${error.message}`, 'red');
    return false;
  }
}

// Test 3: Fetch 24hr stats from Binance
async function testBinance24hrStats() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  TEST 3: 24hr Trading Statistics', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');
  
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT'];
    
    for (const symbol of symbols) {
      const response = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      const data = response.data;
      
      log(`\n📈 ${symbol.replace('USDT', '/USDT')} 24hr Stats:`, 'yellow');
      log('─────────────────────────────────────', 'yellow');
      log(`   Current Price:  $${parseFloat(data.lastPrice).toFixed(2)}`, 'green');
      log(`   24h Change:     ${parseFloat(data.priceChangePercent).toFixed(2)}%`, 
          parseFloat(data.priceChangePercent) >= 0 ? 'green' : 'red');
      log(`   24h High:       $${parseFloat(data.highPrice).toFixed(2)}`, 'green');
      log(`   24h Low:        $${parseFloat(data.lowPrice).toFixed(2)}`, 'green');
      log(`   24h Volume:     ${parseFloat(data.volume).toFixed(2)} ${symbol.replace('USDT', '')}`, 'green');
      log(`   24h Vol (USDT): $${(parseFloat(data.quoteVolume)/1000000).toFixed(2)}M`, 'green');
    }
    
    return true;
  } catch (error) {
    log('❌ Failed to fetch 24hr stats', 'red');
    log(`   Error: ${error.message}`, 'red');
    return false;
  }
}

// Test 4: Test WebSocket connection to Binance
async function testWebSocketStream() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  TEST 4: WebSocket Real-time Stream', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');
  
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    let messageCount = 0;
    const maxMessages = 5;
    
    log('🔌 Connecting to Binance WebSocket...', 'yellow');
    
    ws.on('open', () => {
      log('✅ WebSocket connected', 'green');
      log('📡 Receiving real-time BTC/USDT trades:', 'yellow');
      log('─────────────────────────────────────', 'yellow');
    });
    
    ws.on('message', (data) => {
      const trade = JSON.parse(data);
      const price = parseFloat(trade.p).toFixed(2);
      const quantity = parseFloat(trade.q).toFixed(4);
      const time = new Date(trade.T).toLocaleTimeString();
      
      log(`   [${time}] Price: $${price} | Qty: ${quantity} BTC`, 'green');
      
      messageCount++;
      if (messageCount >= maxMessages) {
        log('\n✅ WebSocket test completed', 'green');
        ws.close();
        resolve(true);
      }
    });
    
    ws.on('error', (error) => {
      log('❌ WebSocket error:', 'red');
      log(`   ${error.message}`, 'red');
      ws.close();
      resolve(false);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
        resolve(true);
      }
    }, 10000);
  });
}

// Test 5: Order Book Depth
async function testOrderBook() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  TEST 5: Order Book Depth', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');
  
  try {
    const response = await axios.get('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=5');
    const data = response.data;
    
    log('📗 BTC/USDT Order Book (Top 5):', 'yellow');
    log('─────────────────────────────────────', 'yellow');
    
    log('\n   BIDS (Buy Orders):', 'green');
    data.bids.slice(0, 5).forEach(([price, quantity]) => {
      log(`   $${parseFloat(price).toFixed(2).padEnd(10)} | ${parseFloat(quantity).toFixed(4)} BTC`, 'green');
    });
    
    log('\n   ASKS (Sell Orders):', 'red');
    data.asks.slice(0, 5).forEach(([price, quantity]) => {
      log(`   $${parseFloat(price).toFixed(2).padEnd(10)} | ${parseFloat(quantity).toFixed(4)} BTC`, 'red');
    });
    
    const spread = parseFloat(data.asks[0][0]) - parseFloat(data.bids[0][0]);
    log(`\n   Spread: $${spread.toFixed(2)}`, 'yellow');
    
    return true;
  } catch (error) {
    log('❌ Failed to fetch order book', 'red');
    log(`   Error: ${error.message}`, 'red');
    return false;
  }
}

// Test 6: Recent Trades
async function testRecentTrades() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  TEST 6: Recent Market Trades', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');
  
  try {
    const response = await axios.get('https://api.binance.com/api/v3/trades?symbol=BTCUSDT&limit=5');
    const trades = response.data;
    
    log('💹 Recent BTC/USDT Trades:', 'yellow');
    log('─────────────────────────────────────', 'yellow');
    
    trades.forEach(trade => {
      const price = parseFloat(trade.price).toFixed(2);
      const qty = parseFloat(trade.qty).toFixed(4);
      const time = new Date(trade.time).toLocaleTimeString();
      const side = trade.isBuyerMaker ? 'SELL' : 'BUY';
      const sideColor = trade.isBuyerMaker ? 'red' : 'green';
      
      log(`   [${time}] ${side.padEnd(4)} | $${price} | ${qty} BTC`, sideColor);
    });
    
    return true;
  } catch (error) {
    log('❌ Failed to fetch recent trades', 'red');
    log(`   Error: ${error.message}`, 'red');
    return false;
  }
}

// Test 7: Multiple Exchange Prices Comparison
async function testMultipleExchanges() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  TEST 7: Multi-Exchange Price Comparison', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');
  
  const prices = {};
  
  // Binance
  try {
    const binanceResponse = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    prices.Binance = parseFloat(binanceResponse.data.price);
  } catch (error) {
    prices.Binance = 'N/A';
  }
  
  // Coinbase
  try {
    const coinbaseResponse = await axios.get('https://api.coinbase.com/v2/exchange-rates?currency=BTC');
    prices.Coinbase = parseFloat(coinbaseResponse.data.data.rates.USD);
  } catch (error) {
    prices.Coinbase = 'N/A';
  }
  
  // Kraken
  try {
    const krakenResponse = await axios.get('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
    prices.Kraken = parseFloat(krakenResponse.data.result.XXBTZUSD.c[0]);
  } catch (error) {
    prices.Kraken = 'N/A';
  }
  
  log('💱 BTC/USD Price Across Exchanges:', 'yellow');
  log('─────────────────────────────────────', 'yellow');
  
  Object.entries(prices).forEach(([exchange, price]) => {
    const formattedPrice = price === 'N/A' ? 'N/A' : `$${price.toFixed(2)}`;
    log(`   ${exchange.padEnd(10)} ${formattedPrice}`, 'green');
  });
  
  // Calculate arbitrage opportunity
  const validPrices = Object.values(prices).filter(p => p !== 'N/A');
  if (validPrices.length >= 2) {
    const maxPrice = Math.max(...validPrices);
    const minPrice = Math.min(...validPrices);
    const spread = maxPrice - minPrice;
    const spreadPercent = ((spread / minPrice) * 100).toFixed(3);
    
    log(`\n   Price Spread: $${spread.toFixed(2)} (${spreadPercent}%)`, 'magenta');
    
    if (parseFloat(spreadPercent) > 0.1) {
      log('   💰 Potential arbitrage opportunity detected!', 'bright');
    }
  }
  
  return true;
}

// Main test runner
async function runAllTests() {
  log('\n╔════════════════════════════════════════════════════════╗', 'bright');
  log('║     CRYPTO TRADING BACKEND - LIVE DATA TEST SUITE     ║', 'bright');
  log('╚════════════════════════════════════════════════════════╝', 'bright');
  
  const startTime = Date.now();
  const results = [];
  
  // Run all tests
  results.push(await testServerHealth());
  results.push(await testBinancePrices());
  results.push(await testBinance24hrStats());
  results.push(await testWebSocketStream());
  results.push(await testOrderBook());
  results.push(await testRecentTrades());
  results.push(await testMultipleExchanges());
  
  // Summary
  const endTime = Date.now();
  const totalTime = ((endTime - startTime) / 1000).toFixed(2);
  const passedTests = results.filter(r => r).length;
  const failedTests = results.filter(r => !r).length;
  
  log('\n╔════════════════════════════════════════════════════════╗', 'bright');
  log('║                    TEST SUMMARY                        ║', 'bright');
  log('╚════════════════════════════════════════════════════════╝', 'bright');
  
  log(`\n📊 Test Results:`, 'yellow');
  log(`   ✅ Passed: ${passedTests}/${results.length}`, 'green');
  if (failedTests > 0) {
    log(`   ❌ Failed: ${failedTests}/${results.length}`, 'red');
  }
  log(`   ⏱️  Time: ${totalTime}s`, 'cyan');
  
  if (passedTests === results.length) {
    log('\n🎉 All tests passed! Live crypto data fetching is working perfectly!', 'green');
  } else {
    log('\n⚠️  Some tests failed. Check the errors above.', 'yellow');
  }
  
  log('\n════════════════════════════════════════════════════════\n', 'cyan');
}

// Run the tests
runAllTests().catch(error => {
  log('Fatal error running tests:', 'red');
  log(error.message, 'red');
  process.exit(1);
});